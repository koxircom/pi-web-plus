import type { AgentMessage } from "./types.ts";

export const HISTORY_CACHE_PROTOCOL_HEADER = "X-Pi-History-Cache-Protocol";
export const HISTORY_FINGERPRINT_HEADER = "X-Pi-History-Fingerprint";
export const HISTORY_CACHE_PROTOCOL_VERSION = "1";
export const HISTORY_CACHE_SCOPE = "pi-history-page-cache:v1:";

export const MAX_PAGE_BYTES = 16 * 1024 * 1024; // 16 MiB per page; real long-history pages exceed 2 MiB
export const MAX_TOTAL_BYTES = 32 * 1024 * 1024; // 32 MiB total budget
export const MAX_PAGES = 64; // At most 64 pages
export const MAX_SESSIONS = 8; // At most 8 sessions
export const MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

export interface HistoryPageContext {
  messages: AgentMessage[];
  entryIds: string[];
  oldestEntryId: string | null;
  hasMore: boolean;
  [key: string]: unknown;
}

export interface CachedHistoryPage {
  key: string;
  sessionId: string;
  leafId: string | null;
  before: string;
  tail: number;
  deferThinking: boolean;
  deferMedia: boolean;
  fingerprint: string;
  protocol: string;
  context: HistoryPageContext;
  savedAt: number;
  lastAccessed: number;
  bytes: number;
  localChecksum: string;
}

export interface HistoryPageCacheParams {
  sessionId: string;
  leafId?: string | null;
  before: string;
  tail?: number;
  deferThinking?: boolean;
  deferMedia?: boolean;
}

export function buildHistoryPageCacheKey(params: HistoryPageCacheParams): string {
  const sid = String(params.sessionId ?? "");
  const leaf = params.leafId ? String(params.leafId) : null;
  const before = String(params.before ?? "");
  const rawTail = Number(params.tail);
  const tail = Number.isFinite(rawTail) && rawTail > 0 ? Math.min(rawTail, 1000) : 50;
  const deferThinking = params.deferThinking ? 1 : 0;
  const deferMedia = params.deferMedia ? 1 : 0;
  return JSON.stringify([
    "pi-history-page-cache",
    `v${HISTORY_CACHE_PROTOCOL_VERSION}`,
    sid,
    leaf,
    before,
    tail,
    deferThinking,
    deferMedia,
  ]);
}

export function computeLocalChecksum(str: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0") + ":" + str.length.toString(16);
}

export function validateHistoryPageContext(
  context: unknown,
  before?: string | null,
): context is HistoryPageContext {
  if (!context || typeof context !== "object" || Array.isArray(context)) return false;
  const c = context as Record<string, unknown>;

  // Reject running/queue/SSE state at context top-level
  const forbiddenTopKeys = ["streaming", "inProgress", "running", "isQueued", "queue", "source", "type"];
  for (const k of forbiddenTopKeys) {
    if (k in c && c[k] !== undefined) return false;
  }

  if (!Array.isArray(c.messages) || !Array.isArray(c.entryIds)) return false;
  if (c.messages.length !== c.entryIds.length) return false;

  for (const id of c.entryIds) {
    if (typeof id !== "string" || !id.trim()) return false;
  }
  if (new Set(c.entryIds).size !== c.entryIds.length) return false;

  // Boundary exclusion invariant: before cursor must never be in the returned page
  if (before && typeof before === "string" && before.trim()) {
    const trimmedBefore = before.trim();
    if (c.entryIds.includes(trimmedBefore)) return false;
  }

  if (typeof c.hasMore !== "boolean") return false;

  // Non-empty page or terminal page semantics:
  if (c.hasMore === true) {
    // A bounded raw ancestor page can contain only settings/custom entries.
    // Zero visible messages is valid provided its raw cursor still advances.
    if (typeof c.oldestEntryId !== "string" || !c.oldestEntryId.trim()) return false;
    // Cursor cannot loop back to the boundary cursor
    if (before && c.oldestEntryId.trim() === before.trim()) return false;
  } else {
    // Terminal page (hasMore: false):
    // Empty page with hasMore: false is legal.
    // oldestEntryId can be null or a string.
    if (c.oldestEntryId !== null && typeof c.oldestEntryId !== "string") return false;
    if (before && typeof c.oldestEntryId === "string" && c.oldestEntryId.trim() === before.trim()) {
      return false;
    }
  }

  // Reject running/queue/SSE state in messages
  for (const m of c.messages) {
    if (!m || typeof m !== "object" || Array.isArray(m)) return false;
    const msg = m as Record<string, unknown>;
    if (msg.streaming === true || msg.inProgress === true || msg.running === true) return false;
    if (msg.isQueued === true || msg.queue === true) return false;
    if (msg.source === "sse" || msg.type === "stream") return false;
  }

  return true;
}

export interface HistoryPageExpectedParams {
  key?: string;
  sessionId?: string;
  leafId?: string | null;
  before?: string;
  tail?: number;
  deferThinking?: boolean;
  deferMedia?: boolean;
}

export function validateCachedHistoryPageEnvelope(
  page: unknown,
  expected?: HistoryPageExpectedParams,
): CachedHistoryPage | null {
  if (!page || typeof page !== "object" || Array.isArray(page)) return null;
  const p = page as Record<string, unknown>;

  if (typeof p.key !== "string" || !p.key) return null;
  if (expected?.key && p.key !== expected.key) return null;

  if (typeof p.sessionId !== "string" || !p.sessionId) return null;
  if (expected?.sessionId && p.sessionId !== expected.sessionId) return null;

  const pageLeaf = p.leafId === undefined || p.leafId === null ? null : String(p.leafId);
  if (expected && expected.leafId !== undefined) {
    const expLeaf = expected.leafId === null || expected.leafId === undefined ? null : String(expected.leafId);
    if (pageLeaf !== expLeaf) return null;
  }

  if (typeof p.before !== "string" || !p.before) return null;
  if (expected?.before && p.before !== expected.before) return null;

  const rawTail = Number(p.tail);
  if (!Number.isInteger(rawTail) || rawTail <= 0) return null;
  if (expected?.tail && rawTail !== expected.tail) return null;

  const deferThinking = Boolean(p.deferThinking);
  const deferMedia = Boolean(p.deferMedia);
  if (expected?.deferThinking !== undefined && deferThinking !== expected.deferThinking) return null;
  if (expected?.deferMedia !== undefined && deferMedia !== expected.deferMedia) return null;

  if (p.protocol !== HISTORY_CACHE_PROTOCOL_VERSION) return null;
  if (typeof p.fingerprint !== "string" || !p.fingerprint) return null;

  const now = Date.now();
  const savedAt = Number(p.savedAt);
  if (!Number.isFinite(savedAt) || now - savedAt > MAX_AGE_MS || savedAt > now + 60000) {
    return null;
  }

  const rawBytes = Number(p.bytes);
  if (!Number.isInteger(rawBytes) || rawBytes < 0 || rawBytes > MAX_PAGE_BYTES) {
    return null;
  }

  if (!validateHistoryPageContext(p.context, p.before)) {
    return null;
  }

  let serializedContext: string;
  try {
    serializedContext = JSON.stringify(p.context);
  } catch {
    return null;
  }

  const actualBytes = new TextEncoder().encode(serializedContext).byteLength;
  if (actualBytes !== rawBytes) {
    return null;
  }

  const expectedChecksum = computeLocalChecksum(serializedContext);
  if (p.localChecksum !== expectedChecksum) {
    return null;
  }

  const rawLastAccessed = Number(p.lastAccessed);
  const lastAccessed = Number.isFinite(rawLastAccessed) && rawLastAccessed > 0 ? rawLastAccessed : savedAt;

  // Clone isolation (prevent caller from mutating stored reference)
  return {
    key: p.key,
    sessionId: p.sessionId,
    leafId: pageLeaf,
    before: p.before,
    tail: rawTail,
    deferThinking,
    deferMedia,
    fingerprint: p.fingerprint,
    protocol: HISTORY_CACHE_PROTOCOL_VERSION,
    context: JSON.parse(serializedContext) as HistoryPageContext,
    savedAt,
    lastAccessed,
    bytes: rawBytes,
    localChecksum: expectedChecksum,
  };
}

declare global {
  var __piSessionHistoryPageCache: Map<string, CachedHistoryPage> | undefined;
}

function memoryStore(): Map<string, CachedHistoryPage> {
  if (!globalThis.__piSessionHistoryPageCache) {
    globalThis.__piSessionHistoryPageCache = new Map();
  }
  return globalThis.__piSessionHistoryPageCache;
}

function evictMemory(): void {
  const store = memoryStore();

  // 1. Evict expired or corrupted
  const now = Date.now();
  for (const [k, v] of store.entries()) {
    if (
      !v ||
      now - v.savedAt > MAX_AGE_MS ||
      v.savedAt > now + 60000 ||
      !Number.isInteger(v.bytes) ||
      v.bytes < 0
    ) {
      store.delete(k);
    }
  }

  // 2. Enforce max sessions (8 sessions)
  const sessionLastAccess = new Map<string, number>();
  for (const v of store.values()) {
    const cur = sessionLastAccess.get(v.sessionId) ?? 0;
    if (v.lastAccessed > cur) {
      sessionLastAccess.set(v.sessionId, v.lastAccessed);
    }
  }
  if (sessionLastAccess.size > MAX_SESSIONS) {
    const sortedSessions = Array.from(sessionLastAccess.entries()).sort((a, b) => a[1] - b[1]);
    while (sortedSessions.length > MAX_SESSIONS) {
      const victim = sortedSessions.shift();
      if (!victim) break;
      for (const [k, v] of store.entries()) {
        if (v.sessionId === victim[0]) store.delete(k);
      }
    }
  }

  // 3. Enforce max pages (64 pages) & total bytes (32 MiB) based on lastAccessed
  const remaining = Array.from(store.entries()).sort(
    (a, b) => (a[1].lastAccessed || a[1].savedAt) - (b[1].lastAccessed || b[1].savedAt),
  );
  let totalBytes = 0;
  for (const [, v] of remaining) totalBytes += v.bytes;

  let count = remaining.length;
  for (const [k, v] of remaining) {
    if (count <= MAX_PAGES && totalBytes <= MAX_TOTAL_BYTES) break;
    store.delete(k);
    totalBytes -= v.bytes;
    count--;
  }
}

export function getHistoryPageMemory(
  key: string,
  expected?: HistoryPageExpectedParams,
): CachedHistoryPage | null {
  const store = memoryStore();
  const rawPage = store.get(key);
  if (!rawPage) return null;

  const valid = validateCachedHistoryPageEnvelope(rawPage, { ...expected, key });
  if (!valid) {
    store.delete(key);
    return null;
  }

  // True LRU touch: update lastAccessed without changing validated savedAt
  valid.lastAccessed = Date.now();
  store.delete(key);
  store.set(key, valid);

  // Return a cloned instance to prevent caller mutation of stored copy
  return JSON.parse(JSON.stringify(valid)) as CachedHistoryPage;
}

export function setHistoryPageMemory(page: CachedHistoryPage): boolean {
  if (!page || typeof page !== "object") return false;
  if (!page.key || !page.sessionId || !page.before || !page.fingerprint) return false;
  if (!validateHistoryPageContext(page.context, page.before)) return false;

  let serializedContext: string;
  try {
    serializedContext = JSON.stringify(page.context);
  } catch {
    return false;
  }

  const actualBytes = new TextEncoder().encode(serializedContext).byteLength;
  if (actualBytes > MAX_PAGE_BYTES) return false;

  const now = Date.now();
  const savedAt = Number.isFinite(page.savedAt) ? page.savedAt : now;
  if (now - savedAt > MAX_AGE_MS || savedAt > now + 60000) return false;

  const rawTail = Number(page.tail);
  const tail = Number.isInteger(rawTail) && rawTail > 0 ? rawTail : 50;

  const valid: CachedHistoryPage = {
    key: String(page.key),
    sessionId: String(page.sessionId),
    leafId: page.leafId ? String(page.leafId) : null,
    before: String(page.before),
    tail,
    deferThinking: Boolean(page.deferThinking),
    deferMedia: Boolean(page.deferMedia),
    fingerprint: String(page.fingerprint),
    protocol: HISTORY_CACHE_PROTOCOL_VERSION,
    context: JSON.parse(serializedContext) as HistoryPageContext,
    savedAt,
    lastAccessed: now,
    bytes: actualBytes,
    localChecksum: computeLocalChecksum(serializedContext),
  };

  const store = memoryStore();
  store.delete(valid.key);
  store.set(valid.key, valid);
  evictMemory();
  return store.has(valid.key);
}

export function deleteHistoryPagesMemory(sessionId?: string): void {
  const store = memoryStore();
  if (sessionId) {
    for (const [k, v] of store.entries()) {
      if (v.sessionId === sessionId) store.delete(k);
    }
  } else {
    store.clear();
  }
}

export function clearHistoryPagesMemory(): void {
  deleteHistoryPagesMemory();
}

/** Test seam */
export function resetHistoryPageMemoryForTests(): void {
  globalThis.__piSessionHistoryPageCache = undefined;
}
