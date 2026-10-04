export interface PendingPromptSubmission {
  requestId: string;
  sessionId: string;
  message: string;
  images?: Array<{ data: string; mimeType: string }>;
  status: "sending" | "uncertain";
  streamingBehavior?: "steer" | "followUp";
  createdAt: number;
}

export interface PromptSubmissionPreviewIdentity {
  requestId: string;
  sessionId: string;
  draftKey: string | undefined;
}

/** Presentation-only deduplication; never modifies durable submissions. */
export function visiblePromptSubmissions(
  rows: PendingPromptSubmission[],
  preview: PromptSubmissionPreviewIdentity | null,
  sessionId: string | null,
  draftKey: string | undefined,
): PendingPromptSubmission[] {
  return rows.filter((row) => !(row.status === "sending" && row.streamingBehavior
    && preview?.requestId === row.requestId && preview.sessionId === row.sessionId
    && preview.sessionId === sessionId && preview.draftKey === draftKey));
}

const STORAGE_KEY = "pi-web:unconfirmed-prompts-v1";
const listeners = new Set<() => void>();
const EMPTY: PendingPromptSubmission[] = [];
let submissions: PendingPromptSubmission[] = EMPTY;
let restored = false;

function storage(): Storage | null {
  // Tab-scoped: refreshing preserves submissions without another tab claiming them.
  return typeof window === "undefined" ? null : window.sessionStorage;
}
function restore(): void {
  if (restored) return;
  restored = true;
  try {
    const raw = storage()?.getItem(STORAGE_KEY);
    if (!raw) return;
    const rows: unknown = JSON.parse(raw);
    if (!Array.isArray(rows)) return;
    submissions = rows.filter((r): r is PendingPromptSubmission => Boolean(r
      && typeof r.requestId === "string" && typeof r.sessionId === "string"
      && typeof r.message === "string" && typeof r.createdAt === "number"
      && (r.status === "sending" || r.status === "uncertain")
      && (r.images === undefined || (Array.isArray(r.images) && r.images.every((i: { data?: unknown; mimeType?: unknown }) => i && typeof i.data === "string" && typeof i.mimeType === "string")))))
      .map((row) => ({ ...row, status: "uncertain" }));
  } catch { /* Keep the original stored bytes; do not silently overwrite them. */ }
}
function commit(next: PendingPromptSubmission[]): void {
  const store = storage();
  if (store) {
    if (next.length) store.setItem(STORAGE_KEY, JSON.stringify(next));
    else store.removeItem(STORAGE_KEY);
  }
  submissions = next;
  for (const listener of listeners) listener();
}
export function getPendingPromptSubmissions(): PendingPromptSubmission[] {
  restore();
  return submissions;
}
export const getServerPendingPromptSubmissions = () => EMPTY;
export function subscribePendingPromptSubmissions(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function retainPromptSubmission(row: PendingPromptSubmission): void {
  restore();
  if (submissions.length >= 20) throw new Error("未确认消息过多，请先确认已保留的消息。");
  commit([...submissions, row]);
}
export function markPromptSubmissionUncertain(requestId: string): void {
  restore();
  const next = submissions.map((row) => row.requestId === requestId ? { ...row, status: "uncertain" as const } : row);
  // The original durable copy was saved before dispatch. Never discard it if a later write fails.
  try { commit(next); } catch { submissions = next; for (const listener of listeners) listener(); }
}
export function releasePromptSubmission(requestId: string): void {
  restore();
  commit(submissions.filter((row) => row.requestId !== requestId));
}
