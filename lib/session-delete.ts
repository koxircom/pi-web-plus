import { lstatSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join, resolve as resolvePath } from "path";
import { listAllSessions, mergeSessionLists, resolveSessionPath, readSessionHeader,
  invalidateSessionPathCache, invalidateSessionManagerCache, invalidateSessionListCache } from "./session-reader";
import { sessionPathKey } from "./session-path";
import { abortSubagent, getRpcSession, getRpcSessionInfos } from "./rpc-manager";
import { readSubagentRun, SUBAGENT_META_TYPE } from "./subagents";
import type { SessionEntry, SessionInfo } from "./types";
import { deletedPaths as tombstones, ensureSessionWriteGuardInstalled, sealAndDeleteSync } from "./usage-delete-guard";

type DeleteContext = { sessions: SessionInfo[]; knownPaths: Set<string>; directoryFiles: (dir: string) => string[] };
export type SessionDeleteResult = { id: string; ok: boolean; missing?: boolean; error?: string };

async function prepareSessionDelete(id: string, context: DeleteContext) {
  const filePath = await resolveSessionPath(id);
  if (!filePath) {
    return null;
  }

  // Read only the bounded header before deleting.
  let parentSessionPath: string | undefined;
  try {
    parentSessionPath = readSessionHeader(filePath)?.parentSession;
  } catch (error) {
    // Empty runtime sessions have a cached path before their first disk write.
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  let parentSessionId: string | undefined;
  if (parentSessionPath) {
    try {
      // The parent may have been deleted or moved already; treat it as absent.
      parentSessionId = readSessionHeader(parentSessionPath)?.id;
    } catch {
      parentSessionId = undefined;
    }
  }

  const targetPathKey = sessionPathKey(filePath);
  const dir = dirname(filePath);
  // Deleting a session also deletes every persisted or live subagent below it.
  const { sessions, knownPaths, directoryFiles } = context;
  const childrenByParent = new Map<string, string[]>();
  for (const session of sessions) {
    if (session.relation?.kind !== "subagent") continue;
    const children = childrenByParent.get(session.relation.parentSessionId) ?? [];
    children.push(session.id);
    childrenByParent.set(session.relation.parentSessionId, children);
  }
  const sessionPaths = new Map(sessions.map((session) => [session.id, session.path]));
  // Include local files even when the global catalogue is stale or incomplete.
  try {
    for (const file of directoryFiles(dir)) {
      const childPath = join(dir, file);
      if (sessionPathKey(childPath) === targetPathKey) continue;
      try {
        if (knownPaths.has(sessionPathKey(childPath))) continue; // Fresh catalogue already contains its relation metadata.
        const lines = readFileSync(childPath, "utf8").split("\n");
        const header = JSON.parse(lines[0]) as { type?: string; id?: string };
        if (header.type !== "session" || typeof header.id !== "string") continue;
        const entries = lines.slice(1).flatMap((line) => {
          try { return [JSON.parse(line) as SessionEntry]; } catch { return []; }
        });
        const subagent = readSubagentRun(entries, header.id, childPath);
        if (!subagent) continue;
        const children = childrenByParent.get(subagent.parentSessionId) ?? [];
        children.push(header.id);
        childrenByParent.set(subagent.parentSessionId, children);
        sessionPaths.set(header.id, childPath);
      } catch { /* skip malformed or concurrently removed sessions */ }
    }
  } catch { /* skip if dir unreadable */ }
  const deletedSessionIds = new Set<string>([id]);
  const pending = [id];
  while (pending.length > 0) {
    const parentId = pending.pop()!;
    for (const childId of childrenByParent.get(parentId) ?? []) {
      if (deletedSessionIds.has(childId)) continue;
      deletedSessionIds.add(childId);
      pending.push(childId);
    }
  }
  const deletedPaths = new Map<string, string>([[id, filePath]]);
  for (const deletedId of deletedSessionIds) {
    const sessionPath = sessionPaths.get(deletedId);
    if (sessionPath) deletedPaths.set(deletedId, sessionPath);
  }
  for (const deletedId of deletedSessionIds) {
    if (deletedPaths.has(deletedId)) continue;
    const runtimePath = getRpcSession(deletedId)?.sessionFile;
    if (runtimePath) deletedPaths.set(deletedId, runtimePath);
    else {
      const resolvedPath = await resolveSessionPath(deletedId);
      if (resolvedPath) deletedPaths.set(deletedId, resolvedPath);
    }
  }
  const deletedPathKeys = new Set([...deletedPaths.values()].map((path) => sessionPathKey(path)));

  // Re-attach all direct children to this session's parent (cascade re-parent)
  // Scan sibling files in the same directory
  try {
    const files = directoryFiles(dir).filter(
      (file) => file.endsWith(".jsonl") && sessionPathKey(join(dir, file)) !== targetPathKey,
    );
    for (const file of files) {
      const childPath = join(dir, file);
      if (deletedPathKeys.has(sessionPathKey(childPath))) continue;
      try {
        const header = readSessionHeader(childPath);
        if (
          header?.type === "session" &&
          header.parentSession &&
          sessionPathKey(header.parentSession) === targetPathKey
        ) {
          const lines = readFileSync(childPath, "utf8").split("\n");
          // Rewrite header with new parentSession
          header.parentSession = parentSessionPath;
          lines[0] = JSON.stringify(header);
          if (parentSessionPath && parentSessionId) {
            for (let index = 1; index < lines.length; index += 1) {
              let entry: { type?: string; customType?: string; data?: unknown };
              try {
                entry = JSON.parse(lines[index]);
              } catch {
                continue;
              }
              if (
                entry.type !== "custom"
                || entry.customType !== SUBAGENT_META_TYPE
                || typeof entry.data !== "object"
                || entry.data === null
                || Array.isArray(entry.data)
              ) continue;
              entry.data = {
                ...entry.data,
                parentSessionId,
                parentSessionPath,
              };
              lines[index] = JSON.stringify(entry);
              break;
            }
          }
          writeFileSync(childPath, lines.join("\n"));
        }
      } catch { /* skip malformed */ }
    }
  } catch { /* skip if dir unreadable */ }

  for (const deletedId of [...deletedSessionIds].reverse()) {
    if (deletedId === id) continue;
    try { await abortSubagent(deletedId); } catch { /* idle or completed */ }
    await getRpcSession(deletedId)?.shutdown();
  }
  try { await abortSubagent(id); } catch { /* ordinary session */ }
  await getRpcSession(id)?.shutdown();
  return deletedPaths;
}

// Serialize destructive requests so overlapping batches cannot race reparenting or sealing.
declare global { var __piSessionDeleteQueue: Promise<unknown> | undefined; }
export function deleteSessions(ids: string[]) {
  const pending = (globalThis.__piSessionDeleteQueue ?? Promise.resolve())
    .catch(() => undefined).then(() => executeDeleteSessions([...new Set(ids)]));
  globalThis.__piSessionDeleteQueue = pending;
  void pending.finally(() => {
    if (globalThis.__piSessionDeleteQueue === pending) globalThis.__piSessionDeleteQueue = undefined;
  }).catch(() => undefined);
  return pending;
}

async function executeDeleteSessions(ids: string[]) {
  ensureSessionWriteGuardInstalled();
  const files = new Map<string, string[]>();
  const sessions = mergeSessionLists(await listAllSessions({ force: true }), getRpcSessionInfos({ includeTransient: true }));
  const context: DeleteContext = {
    sessions, knownPaths: new Set(sessions.map((session) => sessionPathKey(session.path))),
    directoryFiles(dir) {
      if (!files.has(dir)) files.set(dir, readdirSync(dir).filter((name) => name.endsWith(".jsonl")));
      return files.get(dir)!;
    },
  };
  const planned = new Map<string, Map<string, string>>();
  const targets = new Map<string, string>();
  const results = new Map<string, SessionDeleteResult>();
  for (const id of ids) {
    if (targets.has(id)) { planned.set(id, new Map([[id, targets.get(id)!]])); continue; }
    try {
      const paths = await prepareSessionDelete(id, context);
      if (!paths) { results.set(id, { id, ok: true, missing: true }); continue; }
      planned.set(id, paths);
      for (const entry of paths) targets.set(...entry);
    } catch (error) { results.set(id, { id, ok: false, error: String(error) }); }
  }
  const persisted = new Map<string, string>();
  const unpersisted = new Map<string, string>();
  const deleted = new Set<string>();
  let deleteError: string | undefined;
  const confirm = (id: string, path: string) => {
    deleted.add(id);
    invalidateSessionPathCache(id);
    invalidateSessionManagerCache(path);
  };
  try {
    for (const [id, path] of targets) {
      try { lstatSync(path); persisted.set(id, path); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        unpersisted.set(id, path);
      }
    }
    // One ledger lock/worker for the entire batch; retain fingerprint verification and tombstones.
    sealAndDeleteSync(persisted, confirm);
    for (const [id, path] of unpersisted) { tombstones.add(resolvePath(path)); confirm(id, path); }
  } catch (error) { deleteError = String(error); }
  if (targets.size > 0) invalidateSessionListCache();
  for (const [id, paths] of planned) {
    const ok = [...paths.keys()].every((deletedId) => deleted.has(deletedId));
    results.set(id, { id, ok, ...(ok ? {} : { error: deleteError ?? "会话未能完全删除" }) });
  }
  return { results: ids.map((id) => results.get(id)!), deletedSessionIds: [...deleted] };
}
