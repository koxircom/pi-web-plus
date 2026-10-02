import type { SessionInfo } from "./types";
import { getSessionViewSnapshot, getSessionWireBaseline, setSessionViewSnapshot, setSessionWireBaseline, deleteSessionViewSnapshot, deleteSessionWireBaseline, clearSessionViewCache, getSessionViewCacheOrder, setSessionViewCachePriority, setSessionViewCacheActiveSession } from "./session-view-cache.ts";
import { buildSessionSyncUrl, getSessionEpoch, isEpochFresh, isSessionMemoryCacheEnabled, reconcileSyncResponse, viewMatchesBaseline } from "./session-sync-client.ts";
import { planSessionPreloads } from "./session-preload-plan.ts";

// One data owner for native switching and notification preloads. Background
// reads mount no hidden chats and fetch only the tail. Idle cache misses
// reconcile external disk edits; running wrappers retain ownership of writes.
type Candidate = { sessionId: string; isActive?: boolean; hasAttention?: boolean; isRunning?: boolean; isCompleted?: boolean; isUnread?: boolean; refresh?: boolean; priority?: string };
const catalog = new Map<string, string>();
const status = new Map<string, Candidate>();
const confirmed = new Map<string, { epoch: number; fingerprint: string; at: number }>();
const flights = new Map<string, Promise<void>>();
const failures = new Map<string, number>();
let queue: string[] = [];
let selected: string | null = null;
let workers = 0;
let generation = 0;
const fingerprint = (sid: string) => catalog.get(sid) ?? "";
export function markSessionResidentFresh(sid: string): void {
  confirmed.delete(sid);
  confirmed.set(sid, { epoch: getSessionEpoch(sid), fingerprint: fingerprint(sid), at: Date.now() });
  while (confirmed.size > 64) confirmed.delete(confirmed.keys().next().value!);
  failures.delete(sid);
}
export function isSessionResidentFresh(sid: string): boolean {
  const record = confirmed.get(sid);
  return Boolean(record && record.epoch === getSessionEpoch(sid) && record.fingerprint === fingerprint(sid)
    && getSessionViewSnapshot(sid, false)
    && (getSessionViewSnapshot(sid, false)?.livePreview || getSessionWireBaseline(sid, false)?.data));
}
export async function waitForSessionPreload(sid: string): Promise<void> { await flights.get(sid); }

async function preload(sid: string): Promise<void> {
  const epoch = getSessionEpoch(sid), owner = generation, sourceFingerprint = fingerprint(sid);
  let baseline = getSessionWireBaseline(sid, false);
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await fetch(buildSessionSyncUrl({ sessionId: sid, baseRevision: baseline?.revision, force: !status.get(sid)?.isRunning && !isSessionResidentFresh(sid), treeFormat: "summary" }), { signal: AbortSignal.timeout(15_000) });
    if (owner !== generation || !isEpochFresh(sid, epoch) || sourceFingerprint !== fingerprint(sid) || !isSessionMemoryCacheEnabled()) return;
    if (response.status === 404) { deleteSessionViewSnapshot(sid); confirmed.delete(sid); return; }
    if (response.status === 401 || response.status === 403) { clearSessionViewCache(); resetSessionPreloads(); return; }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    if (owner !== generation || !isEpochFresh(sid, epoch) || sourceFingerprint !== fingerprint(sid) || !isSessionMemoryCacheEnabled()) return;
    const result = reconcileSyncResponse({ sessionId: sid, status: response.status, payload, wireBaseline: baseline });
    if (result.action === "invalid_delta" && attempt === 0) { baseline = null; continue; }
    const data = result.action === "unchanged" ? baseline?.data
      : result.action === "delta" || result.action === "reset" || result.action === "legacy" ? result.data : null;
    if (!data || data.treeFormat !== "summary") throw new Error("Uncertified preload response");
    if (result.action !== "unchanged" && "newWireBaseline" in result && result.newWireBaseline) setSessionWireBaseline(result.newWireBaseline);
    if (!data.snapshotRevision && baseline) deleteSessionWireBaseline(sid);
    const wider = getSessionViewSnapshot(sid, false);
    // Preserve paged-in history if its suffix still matches the exact new tail.
    const preserve = data.snapshotRevision && wider && viewMatchesBaseline({ sessionId: sid, revision: data.snapshotRevision ?? "", messages: data.context.messages, entryIds: data.context.entryIds, savedAt: Date.now() }, wider.messages, wider.entryIds);
    setSessionViewSnapshot(preserve ? { ...wider, summaryTree: data.tree, stats: data.stats, totalActiveMs: data.totalActiveMs }
      : { sessionId: sid, revision: data.snapshotRevision ?? null, livePreview: !data.snapshotRevision, ...(!data.snapshotRevision ? { data } : {}), messages: data.context.messages, entryIds: data.context.entryIds,
          leafId: data.leafId, oldestEntryId: data.context.oldestEntryId, hasMore: data.context.hasMore,
          summaryTree: data.tree, thinkingLevel: data.context.thinkingLevel, model: data.context.model,
          stats: data.stats, totalActiveMs: data.totalActiveMs, loadedEntryIds: data.context.entryIds });
    const item = status.get(sid);
    setSessionViewCachePriority(sid, item?.hasAttention ? "attention" : item?.isRunning ? "running" : item?.isCompleted && item.isUnread ? "completed-unread" : "normal");
    markSessionResidentFresh(sid);
    return;
  }
}
function needsPreload(sid: string): boolean {
  if (sid === selected || flights.has(sid) || (failures.get(sid) ?? 0) > Date.now()) return false;
  if (!isSessionResidentFresh(sid)) return true;
  const item = status.get(sid), record = confirmed.get(sid)!;
  return Boolean((item?.isRunning || item?.hasAttention || item?.refresh) && Date.now() - record.at >= 10_000);
}
function pump(): void {
  if (!isSessionMemoryCacheEnabled()) { queue = []; return; }
  while (workers < 2 && queue.length) {
    const sid = queue.shift()!;
    if (!needsPreload(sid)) continue;
    workers++;
    const flight = preload(sid).catch(() => { failures.set(sid, Date.now() + 10_000); }).finally(() => {
      workers--; if (flights.get(sid) === flight) flights.delete(sid); pump();
    });
    flights.set(sid, flight);
  }
}
function schedule(): void {
  const order = getSessionViewCacheOrder();
  const ids = new Set([...order, ...status.keys()]);
  const inputs = [...ids].map(sessionId => {
    const item = status.get(sessionId);
    return { sessionId, attentionPending: Boolean(item?.hasAttention), running: Boolean(item?.isRunning),
      completedUnread: Boolean(item?.isCompleted && item?.isUnread), recentlyAccessed: order.includes(sessionId),
      recencyRank: order.indexOf(sessionId) < 0 ? Number.MAX_SAFE_INTEGER : order.indexOf(sessionId) };
  });
  const plan = planSessionPreloads(inputs, { activeSessionId: selected });
  const ranks = new Map(plan.map(item => [item.sessionId, item.priority]));
  for (const item of inputs) setSessionViewCachePriority(item.sessionId, ranks.get(item.sessionId) ?? "normal");
  queue = plan.map(item => item.sessionId).filter(needsPreload);
  pump();
}
export function updateSessionPreloadCatalog(sessions: SessionInfo[], running: Set<string>, unread: Set<string>, activeSessionId: string | null): void {
  selected = activeSessionId;
  setSessionViewCacheActiveSession(selected);
  const live = new Set(sessions.map(item => item.id));
  for (const sid of catalog.keys()) if (!live.has(sid)) { catalog.delete(sid); status.delete(sid); confirmed.delete(sid); deleteSessionViewSnapshot(sid); }
  for (const item of sessions) {
    // Index rows already carry the actual file mtime. Filling in messageCount
    // is metadata hydration, not a history mutation. Use stable source identity
    // from both index and detailed rows to avoid a false cache miss on open.
    catalog.set(item.id, `${item.path}:${item.modified}`);
    const previous = status.get(item.id);
    status.set(item.id, { ...previous, sessionId: item.id, isRunning: running.has(item.id), isUnread: unread.has(item.id),
      isCompleted: running.has(item.id) ? false : Boolean(previous?.isCompleted || previous?.isRunning) });
  }
  schedule();
}
export function registerSessionPreloadBridge(): () => void {
  const target = window as unknown as { __PI_WEB_SESSION_PRELOAD__?: { scheduleCandidates: (items: Candidate[], options?: { activeSessionId?: string | null }) => void } };
  const bridge = { scheduleCandidates(items: Candidate[], options?: { activeSessionId?: string | null }) {
    if (options?.activeSessionId !== undefined) selected = options.activeSessionId;
    for (const item of items) {
      const previous = status.get(item.sessionId);
      status.set(item.sessionId, { ...previous, ...item, isCompleted: item.isCompleted ?? previous?.isCompleted, isUnread: item.isUnread ?? previous?.isUnread });
    }
    schedule();
  } };
  target.__PI_WEB_SESSION_PRELOAD__ = bridge;
  const reset = () => { resetSessionPreloads(); schedule(); };
  window.addEventListener("pi:session-cache-change", reset);
  return () => { if (target.__PI_WEB_SESSION_PRELOAD__ === bridge) delete target.__PI_WEB_SESSION_PRELOAD__; window.removeEventListener("pi:session-cache-change", reset); resetSessionPreloads(); };
}
export function resetSessionPreloads(): void { generation++; queue = []; confirmed.clear(); failures.clear(); }
export function resetSessionPreloadStateForTests(): void { resetSessionPreloads(); catalog.clear(); status.clear(); selected = null; }
