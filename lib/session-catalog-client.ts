import type { SessionInfo } from "./types.ts";

/** Keep submitted titles visible until the disk catalogue contains the first message. */
export function mergeLocalSessions(server: SessionInfo[], local: SessionInfo[]): SessionInfo[] {
  const ids = new Set(server.map((session) => session.id));
  const pending = new Map(local.filter((session) => session.submissionPending).map((session) => [session.id, session]));
  return [...local.filter((session) => !ids.has(session.id)), ...server.map((session) => {
    const submission = pending.get(session.id);
    return submission && !session.name && !session.firstMessage
      ? { ...session, ...submission, projectKey: session.projectKey, projectRoot: session.projectRoot }
      : session;
  })];
}

export function pendingSessionInfo(sourceDraftKey: string, cwd: string, id = sourceDraftKey, firstMessage = ""): SessionInfo {
  const now = new Date().toISOString();
  return {
    id, cwd, path: "", name: firstMessage ? undefined : "图片消息",
    created: now, modified: now, messageCount: 0, firstMessage,
    transient: true, submissionPending: true,
  };
}
