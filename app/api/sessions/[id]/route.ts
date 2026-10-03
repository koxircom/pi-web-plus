import { selectSessionReadRuntime, isSessionReadStable } from "@/lib/session-read-source";
import { NextResponse } from "next/server";
import { existsSync, statSync } from "fs";
import { deleteSessions } from "@/lib/session-delete";
import {
  attachSessionProjectInfo,
  openSessionManager,
  resolveSessionPath,
  resolveSessionIdByPath,
  invalidateSessionListCache,
  invalidateSessionManagerCache,
  buildSessionContext,
  getSessionFileFingerprint,
} from "@/lib/session-reader";
import { getRpcSession } from "@/lib/rpc-manager";
import { projectTreeForResponse, toSummaryTree } from "@/lib/project-tree";
import { computeSessionTotalActiveMs } from "@/lib/session-timing";
import { computeSessionStats } from "@/lib/session-stats";
import { startServerPerf } from "@/lib/perf";
import { computeSessionRevision } from "@/lib/session-revision";
import type { SessionEntry } from "@/lib/types";
import { readSubagentRun, readSubagentSessionResources } from "@/lib/subagents";
import { readSessionToolSelection } from "@/lib/session-tool-selection";
import { jsonResponse } from "@/lib/json-response";
import { negotiateSessionSync, type SessionSyncScope } from "@/lib/session-sync-server";
import {
  GUARD_VERSION,
  ensureSessionWriteGuardInstalled,
} from "@/lib/usage-delete-guard";

ensureSessionWriteGuardInstalled();

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const perf = startServerPerf("GET /api/sessions/[id]");
  try {
    perf?.span("resolve");
    const rpc = getRpcSession(id);
    const searchParams = new URL(req.url).searchParams;
    const force = searchParams.get("force") === "1";

    // A live wrapper only reflects the appends pi-web itself made. When another
    // pi process (the TUI) writes the same session file, the in-memory index
    // stays stale. Only probe on ?force=1 (session mount / page refresh): two
    // processes writing one JSONL is unsupported, so post-turn reads must not
    // scan disk. Eviction is idle-only; mid-run the wrapper owns the write path.
    let liveWrapper = rpc?.isAlive() ? rpc : undefined;
    let wrapperRebuilt = false;
    if (force && liveWrapper?.evictIfDiskAhead()) {
      wrapperRebuilt = true;
      liveWrapper = undefined;
    }
    // A retained idle wrapper has finished writing. Read disk so its history
    // can receive a stable revision while the runtime remains available.
    const liveRpc = selectSessionReadRuntime(liveWrapper);
    const resolvedPath = liveRpc ? null : await resolveSessionPath(id);
    if (!liveRpc && !resolvedPath) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const filePath = liveRpc?.sessionFile || resolvedPath || "";
    const summaryTree = searchParams.get("tree") === "summary";
    const deferThinking = searchParams.has("deferThinking");
    const deferToolResultImages = searchParams.has("deferMedia");
    const rawTail = Number(searchParams.get("tail"));
    const tail = Number.isFinite(rawTail) && rawTail > 0 ? Math.min(rawTail, 1000) : 50;

    const buildSnapshot = async () => {
      const sm = liveRpc?.inner.sessionManager ?? openSessionManager(resolvedPath!);
      perf?.span("open");
      const actualFilePath = liveRpc?.sessionFile || sm.getSessionFile() || resolvedPath || "";
      const entries = sm.getEntries();
      const leafId = sm.getLeafId();
      const tree = summaryTree
        ? toSummaryTree(projectTreeForResponse(sm.getTree()))
        : projectTreeForResponse(sm.getTree());
      perf?.span("tree");
      const context = buildSessionContext(entries as never, leafId, {
        deferThinking,
        deferToolResultImages,
        tail,
        sessionId: id, // local: lazy URLs for historical tool-result images
      });
      perf?.span("context");
      const totalActiveMs = computeSessionTotalActiveMs(entries);
      // Cumulative usage over ALL entries, including history compacted away —
      // the same aggregation the SDK's getSessionStats() uses. Lets the client
      // keep monotonic token/cost counters across compaction and page reloads.
      const stats = computeSessionStats(entries as unknown as SessionEntry[]);
      perf?.span("stats");
      // Opaque freshness token for the session view cache. Derived from the
      // disk fingerprint and the actual read source; null tells the client the
      // snapshot is unstable and must not be cached as fresh.
      const latestEntry = entries[entries.length - 1] as { id?: string } | undefined;
      const snapshotRevision = computeSessionRevision({
        filePath: actualFilePath,
        sourceId: liveRpc ? `runtime:${String(liveRpc.inner.sessionId)}` : "disk",
        entryCount: entries.length,
        latestEntryId: typeof latestEntry?.id === "string" ? latestEntry.id : null,
        leafId: leafId ?? null,
      });
      const sessionName = sm.getSessionName();
      const firstUserEntry = entries.find((entry) => entry.type === "message" && entry.message.role === "user");
      const firstUserMessage = firstUserEntry?.type === "message" ? firstUserEntry.message : undefined;

      const header = sm.getHeader();
      let modified = header?.timestamp ?? new Date().toISOString();
      try { modified = statSync(actualFilePath).mtime.toISOString(); } catch { /* use header timestamp */ }
      const parentSessionId = header?.parentSession
        ? await resolveSessionIdByPath(header.parentSession)
        : undefined;
      const subagent = header
        ? readSubagentRun(entries as never, header.id, actualFilePath)
        : null;
      const toolNames = readSubagentSessionResources(entries as never)?.tools
        ?? readSessionToolSelection(entries as never);
      const info = header ? (await attachSessionProjectInfo([{
        path: actualFilePath,
        id: header.id,
        cwd: header.cwd ?? "",
        name: sessionName,
        created: header.timestamp,
        modified,
        messageCount: stats.totalMessages,
        firstMessage: firstUserMessage
          ? (() => {
              const c = (firstUserMessage as { content: unknown }).content;
              return typeof c === "string" ? c : (Array.isArray(c) ? (c.find((b: { type: string }) => b.type === "text") as { text: string } | undefined)?.text ?? "" : "") || "(no messages)";
            })()
          : "(no messages)",
        parentSessionId,
        ...(subagent
          ? { relation: { kind: "subagent" as const, parentSessionId: subagent.parentSessionId, profile: subagent.profile, description: subagent.description, status: liveRpc?.isRunning() ? "running" as const : subagent.status } }
          : header.parentSession
            ? { relation: { kind: "fork" as const, ...(parentSessionId ? { originSessionId: parentSessionId } : {}) } }
            : {}),
        transient: !actualFilePath || !existsSync(actualFilePath),
      }]))[0] : null;

      return {
        sessionId: id,
        filePath: actualFilePath,
        info,
        leafId,
        tree,
        usageDeleteGuard: GUARD_VERSION,
        ...(summaryTree ? { treeFormat: "summary" as const } : {}),
        snapshotRevision,
        context,
        stats,
        totalActiveMs,
        ...(toolNames !== undefined ? { toolNames } : {}),
        ...(wrapperRebuilt ? { wrapperRebuilt: true } : {}),
      };
    };

    const isSync = searchParams.get("sync") === "1";
    if (isSync) {
      const baseRevision = searchParams.get("baseRevision");
      const scope: SessionSyncScope = {
        sessionId: id,
        summaryTree,
        tail,
        deferThinking,
        deferMedia: deferToolResultImages,
      };
      const initialRpc = liveWrapper;
      const syncResponse = await negotiateSessionSync({
        sessionId: id,
        filePath,
        baseRevision,
        scope,
        isLive: Boolean(liveRpc),
        isRunning: Boolean(liveRpc?.isRunning()),
        getFileFingerprint: getSessionFileFingerprint,
        buildSnapshot,
        isStableRead: () => {
          const currentRpc = getRpcSession(id);
          return isSessionReadStable(initialRpc, currentRpc);
        },
      });
      const res = jsonResponse(req, syncResponse, {
        headers: {
          "Cache-Control": "private, no-store",
          "X-Pi-Session-Sync": "1",
        },
      });
      return perf?.attach(res) ?? res;
    }

    const responseData = await buildSnapshot();
    return perf?.attach(jsonResponse(req, responseData)) ?? jsonResponse(req, responseData);
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// PATCH /api/sessions/[id]  body: { name: string }
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const { name } = await req.json() as { name?: string };
    if (typeof name !== "string") {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }
    const filePath = await resolveSessionPath(id);
    if (!filePath) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    // PATCH writes via appendSessionInfo — open fresh, bypassing the cache.
    const sm = openSessionManager(filePath, { mutable: true });
    sm.appendSessionInfo(name.trim());
    invalidateSessionManagerCache(filePath);
    invalidateSessionListCache();
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// DELETE /api/sessions/[id] uses the same guarded deletion owner as batch requests.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const { results } = await deleteSessions([id]);
    const result = results[0];
    if (result.missing) return NextResponse.json({ error: "Session not found" }, { status: 404 });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
