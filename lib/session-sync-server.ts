import { performance } from "node:perf_hooks";
import { Buffer } from "node:buffer";
import {
  SESSION_SYNC_PROTOCOL,
  type SessionSyncResponse,
  type SessionSyncSnapshot,
  type SessionSyncMetadata,
} from "./session-sync-protocol.ts";
import { computeSessionRevision } from "./session-revision.ts";
import type { AgentMessage } from "./types.ts";

/** Process-level generation identifier to invalidate stale revisions across server restarts. */
export const SERVER_PROCESS_GENERATION = `gen_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

export interface SessionSyncScope {
  sessionId: string;
  summaryTree: boolean;
  tail: number;
  deferThinking: boolean;
  deferMedia: boolean;
  deferToolResults?: boolean;
}

export function computeSyncScopeKey(scope: SessionSyncScope): string {
  return [
    `protocol:${SESSION_SYNC_PROTOCOL}`, `generation:${SERVER_PROCESS_GENERATION}`,
    `id:${scope.sessionId}`,
    `tree:${scope.summaryTree ? "summary" : "full"}`,
    `tail:${scope.tail}`,
    `dt:${scope.deferThinking ? 1 : 0}`,
    `dm:${scope.deferMedia ? 1 : 0}`,
    `dtr:${scope.deferToolResults ? 1 : 0}`,
  ].join(";");
}

export const BASELINE_CACHE_LIMITS = {
  maxEntries: 16,
  maxTotalBytes: 32 * 1024 * 1024, // 32 MiB
  ttlMs: 10 * 60 * 1000, // 10 minutes
};

export interface BaselineCacheEntry {
  revision: string;
  sessionId: string;
  scopeKey: string;
  filePath: string;
  fingerprint: string;
  entryCount: number;
  latestEntryId: string | null;
  leafId: string | null;
  messages: AgentMessage[];
  entryIds: string[];
  createdAtMonotonic: number;
  bytes: number;
}

declare global {
  var __piSessionBaselineCache: Map<string, BaselineCacheEntry> | undefined;
}

export function getBaselineCache(): Map<string, BaselineCacheEntry> {
  if (!globalThis.__piSessionBaselineCache) {
    globalThis.__piSessionBaselineCache = new Map();
  }
  return globalThis.__piSessionBaselineCache;
}

export function clearBaselineCache(): void {
  getBaselineCache().clear();
}

export function pruneExpiredBaselines(
  cache: Map<string, BaselineCacheEntry>,
  nowMonotonic = performance.now(),
): void {
  for (const [key, entry] of cache.entries()) {
    if (nowMonotonic - entry.createdAtMonotonic > BASELINE_CACHE_LIMITS.ttlMs) {
      cache.delete(key);
    }
  }
}

export function evictBaselineCache(cache: Map<string, BaselineCacheEntry>): void {
  let totalBytes = 0;
  for (const entry of cache.values()) {
    totalBytes += entry.bytes;
  }
  while (
    cache.size > BASELINE_CACHE_LIMITS.maxEntries ||
    totalBytes > BASELINE_CACHE_LIMITS.maxTotalBytes
  ) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey === undefined) break;
    const entry = cache.get(oldestKey);
    if (entry) totalBytes -= entry.bytes;
    cache.delete(oldestKey);
  }
}

export function estimateBaselineEntryBytes(entry: Omit<BaselineCacheEntry, "bytes">): number {
  try {
    const serialized = JSON.stringify({
      r: entry.revision,
      s: entry.sessionId,
      sk: entry.scopeKey,
      fp: entry.fingerprint,
      m: entry.messages,
      e: entry.entryIds,
    });
    return Buffer.byteLength(serialized, "utf8");
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function getDefinedKeys(obj: Record<string, unknown>): string[] {
  return Object.keys(obj).filter((key) => obj[key] !== undefined);
}

/** Recursive canonical deep equality comparison. */
export function canonicalDeepEquals(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") {
    return false;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
      return false;
    }
    for (let i = 0; i < a.length; i++) {
      if (!canonicalDeepEquals(a[i], b[i])) return false;
    }
    return true;
  }
  const recA = a as Record<string, unknown>;
  const recB = b as Record<string, unknown>;
  const keysA = getDefinedKeys(recA);
  const keysB = getDefinedKeys(recB);
  if (keysA.length !== keysB.length) return false;
  for (const key of keysA) {
    if (!(key in recB)) return false;
    if (!canonicalDeepEquals(recA[key], recB[key])) return false;
  }
  return true;
}

/** Canonical equality comparison between two AgentMessage bodies (full structural comparison). */
export function canonicalMessageEquals(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) || Array.isArray(b)) return false;
  return canonicalDeepEquals(a, b);
}

export type DeltaComputationResult =
  | {
      compatible: true;
      dropCount: number;
      keepCount: number;
      tailMessages: unknown[];
    }
  | {
      compatible: false;
      reason: string;
    };

export function hasDuplicateIds(ids: string[]): boolean {
  return new Set(ids).size !== ids.length;
}

export function isCompactionOrBranchMessage(msg: unknown): boolean {
  if (!msg || typeof msg !== "object") return false;
  const m = msg as Record<string, unknown>;
  if (m.customType === "compaction" || ["compaction", "compactionSummary", "branchSummary"].includes(String(m.role))) return true;
  if ("compactionSummary" in m && Boolean(m.compactionSummary)) return true;
  if ("branchSummary" in m && Boolean(m.branchSummary)) return true;
  if (
    m.role === "user" &&
    typeof m.content === "string" &&
    m.content.startsWith("*The conversation briefly explored another branch and returned with this summary:*")
  ) {
    return true;
  }
  return false;
}

/**
 * Computes tail delta between base and current messages, supporting moving prefix windows.
 * Retained entries require identical entry IDs and canonical full-message content.
 * When aligned entry IDs share a trusted non-empty prefix, tail messages with modified content
 * or new appends are returned for replacement.
 * True branch forks, truncations, duplicate IDs, or compaction summaries safely reset.
 */
export function computeTailDelta(
  baseMessages: unknown[],
  baseEntryIds: string[],
  curMessages: unknown[],
  curEntryIds: string[],
): DeltaComputationResult {
  if (baseMessages.length !== baseEntryIds.length || curMessages.length !== curEntryIds.length) {
    return { compatible: false, reason: "length-mismatch" };
  }
  if (curEntryIds.length === 0 || baseEntryIds.length === 0) {
    return { compatible: false, reason: "empty-window" };
  }

  // Reject unaligned duplicate entry IDs
  if (hasDuplicateIds(baseEntryIds) || hasDuplicateIds(curEntryIds)) {
    return { compatible: false, reason: "duplicate-entry-ids" };
  }

  // Locate the index in base that matches the start of current window
  const dropIndex = baseEntryIds.indexOf(curEntryIds[0]);
  if (dropIndex === -1) {
    return { compatible: false, reason: "disjoint-window" };
  }

  const dropCount = dropIndex;
  const overlapLen = baseEntryIds.length - dropCount;

  // If current window is shorter than the remaining base entries, tail entries were truncated
  if (curEntryIds.length < overlapLen) {
    return { compatible: false, reason: "branch-truncated" };
  }

  // Verify that all remaining base entry IDs match curEntryIds prefix exactly
  for (let i = 0; i < overlapLen; i++) {
    if (baseEntryIds[dropCount + i] !== curEntryIds[i]) {
      return { compatible: false, reason: "branch-id-mismatch" };
    }
  }

  // Find longest trusted retained prefix
  let keepCount = 0;
  while (keepCount < overlapLen) {
    const baseMsg = baseMessages[dropCount + keepCount];
    const curMsg = curMessages[keepCount];
    if (!canonicalMessageEquals(baseMsg, curMsg)) {
      break;
    }
    keepCount++;
  }

  if (keepCount === 0) {
    return { compatible: false, reason: "zero-retained" };
  }

  const tailMessages = curMessages.slice(keepCount);

  // Incompatible branch/compaction in tail safely resets
  for (const msg of tailMessages) {
    if (isCompactionOrBranchMessage(msg)) {
      return { compatible: false, reason: "compaction-or-branch-summary" };
    }
  }

  return {
    compatible: true,
    dropCount,
    keepCount,
    tailMessages,
  };
}

export interface SessionSyncNegotiationDeps<T extends SessionSyncSnapshot> {
  sessionId: string;
  filePath: string;
  baseRevision: string | null;
  scope: SessionSyncScope;
  isLive: boolean;
  isRunning: boolean;
  getFileFingerprint: (filePath: string) => string | null;
  buildSnapshot: () => Promise<T>;
  nowMonotonic?: () => number;
  /** Optional verification that the read source remained stable without new live wrappers or runs. */
  isStableRead?: () => boolean;
}

/**
 * Performs server-side session sync negotiation.
 * 1. Live wrappers always return reset with revision: null and are not cached.
 * 2. Warm unchanged short-circuit requires exact cached baseline and identical filePath.
 * 3. Fingerprint before/after and isStableRead verify read stability.
 * 4. Delta is only returned when exact base exists and delta payload is smaller than reset; otherwise resets safely.
 */
export async function negotiateSessionSync<T extends SessionSyncSnapshot>(
  deps: SessionSyncNegotiationDeps<T>,
): Promise<SessionSyncResponse<T>> {
  const {
    sessionId,
    filePath,
    baseRevision,
    scope,
    isLive,
    isRunning,
    getFileFingerprint,
    buildSnapshot,
  } = deps;

  const now = deps.nowMonotonic ? deps.nowMonotonic() : performance.now();
  const cache = getBaselineCache();
  pruneExpiredBaselines(cache, now);

  const scopeKey = computeSyncScopeKey(scope);

  // --- 1. Live wrapper safety: no unverified runtime revision commitments ---
  if (isLive || isRunning) {
    const snapshot = await buildSnapshot();
    snapshot.snapshotRevision = null;
    return {
      protocol: SESSION_SYNC_PROTOCOL,
      mode: "reset",
      revision: null,
      data: snapshot,
    };
  }

  // --- 2. Warm Unchanged Fast Path (requires exact cached baseline and matching filePath) ---
  if (baseRevision) {
    const cached = cache.get(baseRevision);
    if (
      cached &&
      cached.sessionId === sessionId &&
      cached.scopeKey === scopeKey &&
      cached.filePath === filePath &&
      now - cached.createdAtMonotonic <= BASELINE_CACHE_LIMITS.ttlMs
    ) {
      const currentFp = getFileFingerprint(filePath);
      if (currentFp !== null && currentFp === cached.fingerprint && (deps.isStableRead?.() ?? true)) {
        // LRU touch
        cache.delete(baseRevision);
        cache.set(baseRevision, cached);
        return {
          protocol: SESSION_SYNC_PROTOCOL,
          mode: "unchanged",
          revision: baseRevision,
        };
      }
    }
  }

  // --- 3. Build Authoritative Snapshot with Read-Before/After Verification ---
  const fpBefore = getFileFingerprint(filePath);
  const snapshot = await buildSnapshot();
  if (snapshot.sessionId !== sessionId || scope.sessionId !== sessionId || snapshot.context.messages.length !== snapshot.context.entryIds.length
    || snapshot.context.entryIds.some(id => typeof id !== "string" || !id) || hasDuplicateIds(snapshot.context.entryIds)) {
    throw new Error("Invalid session sync snapshot identity or entry IDs");
  }
  const fpAfter = getFileFingerprint(filePath);

  // Check stability: concurrent disk append, missing file, or unstable read state
  const isUnstable =
    fpBefore === null ||
    fpAfter === null ||
    fpBefore !== fpAfter ||
    (deps.isStableRead !== undefined && !deps.isStableRead());

  if (isUnstable) {
    snapshot.snapshotRevision = null;
    return {
      protocol: SESSION_SYNC_PROTOCOL,
      mode: "reset",
      revision: null,
      data: snapshot,
    };
  }

  // --- 4. Compute Stable Snapshot Revision ---
  const latestEntryId =
    snapshot.context.entryIds.length > 0
      ? snapshot.context.entryIds[snapshot.context.entryIds.length - 1]
      : null;

  const currentRevision = computeSessionRevision({
    filePath,
    sourceId: "disk",
    entryCount: snapshot.context.entryIds.length,
    latestEntryId,
    leafId: (snapshot as { leafId?: string | null }).leafId ?? null,
    fingerprint: fpAfter ?? undefined,
    generation: SERVER_PROCESS_GENERATION,
    scopeKey,
  });

  if (!currentRevision) {
    snapshot.snapshotRevision = null;
    return {
      protocol: SESSION_SYNC_PROTOCOL,
      mode: "reset",
      revision: null,
      data: snapshot,
    };
  }

  // Helper to store in baseline cache with deep JSON snapshot
  const storeBaseline = () => {
    let clonedMessages: AgentMessage[];
    let clonedEntryIds: string[];
    try {
      clonedMessages = JSON.parse(JSON.stringify(snapshot.context.messages)) as AgentMessage[];
      clonedEntryIds = JSON.parse(JSON.stringify(snapshot.context.entryIds)) as string[];
    } catch {
      return;
    }

    const entryWithoutMeta = {
      revision: currentRevision,
      sessionId,
      scopeKey,
      filePath,
      fingerprint: fpAfter ?? "",
      entryCount: snapshot.context.entryIds.length,
      latestEntryId,
      leafId: (snapshot as { leafId?: string | null }).leafId ?? null,
      messages: clonedMessages,
      entryIds: clonedEntryIds,
    };
    const bytes = estimateBaselineEntryBytes({
      ...entryWithoutMeta,
      createdAtMonotonic: now,
    });
    if (Number.isFinite(bytes) && bytes <= BASELINE_CACHE_LIMITS.maxTotalBytes) {
      cache.delete(currentRevision);
      cache.set(currentRevision, {
        ...entryWithoutMeta,
        createdAtMonotonic: now,
        bytes,
      });
      evictBaselineCache(cache);
    }
  };

  // Exact cached baseline verification: unknown bases never return unchanged
  const cachedBase = baseRevision ? cache.get(baseRevision) : undefined;
  const hasExactCachedBase = Boolean(
    cachedBase &&
      cachedBase.sessionId === sessionId &&
      cachedBase.scopeKey === scopeKey &&
      cachedBase.filePath === filePath &&
      now - cachedBase.createdAtMonotonic <= BASELINE_CACHE_LIMITS.ttlMs,
  );

  // If revision is identical to client's baseRevision AND exact baseline is cached, return unchanged
  if (baseRevision && baseRevision === currentRevision && hasExactCachedBase) {
    storeBaseline();
    return {
      protocol: SESSION_SYNC_PROTOCOL,
      mode: "unchanged",
      revision: currentRevision,
    };
  }

  // --- 5. Delta Negotiation ---
  if (baseRevision && hasExactCachedBase && cachedBase
    && cachedBase.fingerprint.split(":").slice(0, 2).join(":") === fpAfter.split(":").slice(0, 2).join(":")) {
    const deltaResult = computeTailDelta(
      cachedBase.messages,
      cachedBase.entryIds,
      snapshot.context.messages,
      snapshot.context.entryIds,
    );

    if (deltaResult.compatible) {
      const { messages: _dropped, ...contextRest } = snapshot.context;
      const metadataData = {
        ...snapshot,
        snapshotRevision: currentRevision,
        context: {
          ...contextRest,
          entryIds: snapshot.context.entryIds,
        },
      } as SessionSyncMetadata<T>;

      const deltaResponse: SessionSyncResponse<T> = {
        protocol: SESSION_SYNC_PROTOCOL,
        mode: "delta",
        baseRevision,
        revision: currentRevision,
        dropCount: deltaResult.dropCount,
        keepCount: deltaResult.keepCount,
        tailMessages: deltaResult.tailMessages as T["context"]["messages"],
        data: metadataData,
      };

      const resetResponse: SessionSyncResponse<T> = {
        protocol: SESSION_SYNC_PROTOCOL,
        mode: "reset",
        revision: currentRevision,
        data: {
          ...snapshot,
          snapshotRevision: currentRevision,
        },
      };

      const deltaBytes = Buffer.byteLength(JSON.stringify(deltaResponse), "utf8");
      const resetBytes = Buffer.byteLength(JSON.stringify(resetResponse), "utf8");

      // Prefer delta only when it is strictly smaller than full reset payload
      if (deltaBytes < resetBytes) {
        storeBaseline();
        return deltaResponse;
      }
    }
  }

  // --- 6. Reset Fallback (unknown base, incompatible branch/compaction, larger delta, or first fetch) ---
  storeBaseline();
  snapshot.snapshotRevision = currentRevision;
  return {
    protocol: SESSION_SYNC_PROTOCOL,
    mode: "reset",
    revision: currentRevision,
    data: snapshot,
  };
}
