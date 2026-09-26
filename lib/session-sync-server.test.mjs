import test from "node:test";
import assert from "node:assert/strict";
import {
  negotiateSessionSync,
  computeTailDelta,
  canonicalMessageEquals,
  computeSyncScopeKey,
  getBaselineCache,
  clearBaselineCache,
  evictBaselineCache,
  pruneExpiredBaselines,
  estimateBaselineEntryBytes,
  BASELINE_CACHE_LIMITS,
} from "./session-sync-server.ts";

function createMockSnapshot(overrides = {}) {
  const sessionId = overrides.sessionId ?? "sess_test";
  const defaultMessages = [
    { role: "user", content: "hello" },
    { role: "assistant", content: "hi there" },
  ];
  const defaultEntryIds = ["entry_1", "entry_2"];
  return {
    sessionId,
    snapshotRevision: "mock_rev",
    leafId: "entry_2",
    context: {
      messages: overrides.messages ?? defaultMessages,
      entryIds: overrides.entryIds ?? defaultEntryIds,
      oldestEntryId: "entry_1",
      hasMore: false,
    },
    stats: { totalMessages: 2 },
    ...overrides,
  };
}

function createMockScope(sessionId = "sess_test", overrides = {}) {
  return {
    sessionId,
    summaryTree: false,
    tail: 50,
    deferThinking: false,
    deferMedia: false,
    ...overrides,
  };
}

test("canonicalMessageEquals handles string, block arrays, and property order", () => {
  const msg1 = { role: "user", content: "test", timestamp: 1234 };
  const msg2 = { timestamp: 1234, content: "test", role: "user" };
  const msgDiffRole = { role: "assistant", content: "test", timestamp: 1234 };
  const msgDiffContent = { role: "user", content: "test 2", timestamp: 1234 };

  // Key order does not affect canonical equality
  assert.equal(canonicalMessageEquals(msg1, msg2), true);
  assert.equal(canonicalMessageEquals(msg1, msgDiffRole), false);
  assert.equal(canonicalMessageEquals(msg1, msgDiffContent), false);

  const blockMsgA = { role: "assistant", content: [{ type: "text", text: "abc" }] };
  const blockMsgB = { role: "assistant", content: [{ type: "text", text: "abc" }] };
  const blockMsgC = { role: "assistant", content: [{ type: "text", text: "xyz" }] };
  assert.equal(canonicalMessageEquals(blockMsgA, blockMsgB), true);
  assert.equal(canonicalMessageEquals(blockMsgA, blockMsgC), false);
});

test("canonicalMessageEquals detects stopReason, usage, and tool metadata changes despite identical content", () => {
  // 1. stopReason difference
  const ast1 = { role: "assistant", content: "same content", stopReason: "stop" };
  const ast2 = { role: "assistant", content: "same content", stopReason: "length" };
  assert.equal(canonicalMessageEquals(ast1, ast2), false);

  // 2. usage difference
  const ast3 = { role: "assistant", content: "same", usage: { input: 10, output: 20 } };
  const ast4 = { role: "assistant", content: "same", usage: { input: 15, output: 20 } };
  assert.equal(canonicalMessageEquals(ast3, ast4), false);

  // 3. toolResult metadata differences (isError, toolCallId)
  const tool1 = { role: "toolResult", toolCallId: "call_1", content: [{ type: "text", text: "out" }], isError: false };
  const tool2 = { role: "toolResult", toolCallId: "call_1", content: [{ type: "text", text: "out" }], isError: true };
  const tool3 = { role: "toolResult", toolCallId: "call_2", content: [{ type: "text", text: "out" }], isError: false };
  assert.equal(canonicalMessageEquals(tool1, tool2), false);
  assert.equal(canonicalMessageEquals(tool1, tool3), false);
});

test("computeTailDelta computes moving window and tail appends", () => {
  const baseMsgs = [
    { role: "user", content: "m0" },
    { role: "assistant", content: "m1" },
    { role: "user", content: "m2" },
    { role: "assistant", content: "m3" },
  ];
  const baseIds = ["e0", "e1", "e2", "e3"];

  const curMsgs = [
    { role: "user", content: "m2" },
    { role: "assistant", content: "m3" },
    { role: "user", content: "m4" },
    { role: "assistant", content: "m5" },
  ];
  const curIds = ["e2", "e3", "e4", "e5"];

  const deltaResult = computeTailDelta(baseMsgs, baseIds, curMsgs, curIds);
  assert.equal(deltaResult.compatible, true);
  if (deltaResult.compatible) {
    assert.equal(deltaResult.dropCount, 2);
    assert.equal(deltaResult.keepCount, 2);
    assert.deepEqual(deltaResult.tailMessages, [
      { role: "user", content: "m4" },
      { role: "assistant", content: "m5" },
    ]);
  }
});

test("computeTailDelta allows same-ID tail modification when trusted prefix exists", () => {
  // e0 and e1 are identical; e2 has identical ID but its assistant content or usage was updated
  const baseMsgs = [
    { role: "user", content: "m0" },
    { role: "assistant", content: "m1" },
    { role: "assistant", content: "m2 streaming", stopReason: undefined },
  ];
  const baseIds = ["e0", "e1", "e2"];

  const curMsgs = [
    { role: "user", content: "m0" },
    { role: "assistant", content: "m1" },
    { role: "assistant", content: "m2 complete final", stopReason: "stop" },
    { role: "user", content: "m3 new" },
  ];
  const curIds = ["e0", "e1", "e2", "e3"];

  const deltaResult = computeTailDelta(baseMsgs, baseIds, curMsgs, curIds);
  assert.equal(deltaResult.compatible, true);
  if (deltaResult.compatible) {
    assert.equal(deltaResult.dropCount, 0);
    assert.equal(deltaResult.keepCount, 2);
    assert.deepEqual(deltaResult.tailMessages, [
      { role: "assistant", content: "m2 complete final", stopReason: "stop" },
      { role: "user", content: "m3 new" },
    ]);
  }
});

test("computeTailDelta rejects same-ID edit when zero trusted prefix can be retained", () => {
  // e0 modified at the very beginning of the window -> keepCount = 0 -> rejected
  const baseMsgs = [
    { role: "user", content: "m0 original" },
    { role: "assistant", content: "m1" },
  ];
  const baseIds = ["e0", "e1"];

  const curMsgs = [
    { role: "user", content: "m0 MODIFIED" },
    { role: "assistant", content: "m1" },
  ];
  const curIds = ["e0", "e1"];

  const deltaResult = computeTailDelta(baseMsgs, baseIds, curMsgs, curIds);
  assert.equal(deltaResult.compatible, false);
  if (!deltaResult.compatible) {
    assert.equal(deltaResult.reason, "zero-retained");
  }
});

test("computeTailDelta rejects branch fork where tail of base is missing or mismatched", () => {
  const baseMsgs = [
    { role: "user", content: "m0" },
    { role: "assistant", content: "m1" },
    { role: "user", content: "m2" },
  ];
  const baseIds = ["e0", "e1", "e2"];

  // Branched from e1 to e2_alt, dropping e2 -> branch-id-mismatch
  const curMsgs = [
    { role: "user", content: "m0" },
    { role: "assistant", content: "m1" },
    { role: "user", content: "m2_alt" },
  ];
  const curIds = ["e0", "e1", "e2_alt"];

  const deltaResult = computeTailDelta(baseMsgs, baseIds, curMsgs, curIds);
  assert.equal(deltaResult.compatible, false);
  if (!deltaResult.compatible) {
    assert.equal(deltaResult.reason, "branch-id-mismatch");
  }

  // Base truncated (cur is shorter than remaining base) -> branch-truncated
  const truncatedResult = computeTailDelta(baseMsgs, baseIds, curMsgs.slice(0, 2), curIds.slice(0, 2));
  assert.equal(truncatedResult.compatible, false);
  if (!truncatedResult.compatible) {
    assert.equal(truncatedResult.reason, "branch-truncated");
  }
});

test("computeTailDelta rejects duplicate entry IDs", () => {
  const baseMsgs = [
    { role: "user", content: "m0" },
    { role: "assistant", content: "m1" },
    { role: "assistant", content: "m2" },
  ];
  const duplicateBaseIds = ["e0", "e1", "e1"];
  const curIds = ["e0", "e1", "e2"];

  const res1 = computeTailDelta(baseMsgs, duplicateBaseIds, baseMsgs, curIds);
  assert.equal(res1.compatible, false);
  if (!res1.compatible) {
    assert.equal(res1.reason, "duplicate-entry-ids");
  }

  const res2 = computeTailDelta(baseMsgs, curIds, baseMsgs, duplicateBaseIds);
  assert.equal(res2.compatible, false);
  if (!res2.compatible) {
    assert.equal(res2.reason, "duplicate-entry-ids");
  }
});

test("computeTailDelta rejects compaction or branch summaries in tail messages", () => {
  const baseMsgs = [
    { role: "user", content: "m0" },
    { role: "assistant", content: "m1" },
  ];
  const baseIds = ["e0", "e1"];

  const curMsgs = [
    { role: "user", content: "m0" },
    { role: "assistant", content: "m1" },
    { role: "custom", customType: "compaction", content: "compacted summary" },
  ];
  const curIds = ["e0", "e1", "e2_compaction"];

  const deltaResult = computeTailDelta(baseMsgs, baseIds, curMsgs, curIds);
  assert.equal(deltaResult.compatible, false);
  if (!deltaResult.compatible) {
    assert.equal(deltaResult.reason, "compaction-or-branch-summary");
  }
});

test("negotiateSessionSync: warm unchanged short-circuits with 0 buildSnapshot calls", async () => {
  clearBaselineCache();
  const filePath = "/fake/session.jsonl";
  const fingerprint = "1:2:100:1000:1000";
  const scope = createMockScope("sess_test");

  // 1. Initial request to seed the baseline cache
  let buildSnapshotCalls = 0;
  const initialRes = await negotiateSessionSync({
    sessionId: "sess_test",
    filePath,
    baseRevision: null,
    scope,
    isLive: false,
    isRunning: false,
    getFileFingerprint: () => fingerprint,
    buildSnapshot: async () => {
      buildSnapshotCalls++;
      return createMockSnapshot({ sessionId: "sess_test" });
    },
  });

  assert.equal(initialRes.mode, "reset");
  assert.equal(buildSnapshotCalls, 1);
  const establishedRev = initialRes.revision;
  assert.ok(establishedRev);

  // 2. Second request with same baseRevision and unchanged file fingerprint
  let secondBuildCalls = 0;
  const secondRes = await negotiateSessionSync({
    sessionId: "sess_test",
    filePath,
    baseRevision: establishedRev,
    scope,
    isLive: false,
    isRunning: false,
    getFileFingerprint: () => fingerprint,
    buildSnapshot: async () => {
      secondBuildCalls++;
      return createMockSnapshot({ sessionId: "sess_test" });
    },
  });

  assert.equal(secondRes.mode, "unchanged");
  assert.equal(secondRes.revision, establishedRev);
  // Crucial invariant: zero snapshot build calls on warm unchanged
  assert.equal(secondBuildCalls, 0);

  // 3. Warm match must compare filePath: if filePath differs, do not short-circuit
  const diffPathRes = await negotiateSessionSync({
    sessionId: "sess_test",
    filePath: "/different/path.jsonl",
    baseRevision: establishedRev,
    scope,
    isLive: false,
    isRunning: false,
    getFileFingerprint: () => fingerprint,
    buildSnapshot: async () => createMockSnapshot({ sessionId: "sess_test" }),
  });
  // Must not be unchanged because filePath changed
  assert.notEqual(diffPathRes.mode, "unchanged");
});

test("negotiateSessionSync: returns delta when delta payload is smaller than full reset", async () => {
  clearBaselineCache();
  const filePath = "/fake/session.jsonl";
  let currentFp = "1:2:100:1000:1000";
  const scope = createMockScope("sess_test");

  // Sufficient content so that dropping 2 messages in delta produces a payload strictly smaller than reset
  const largeContentA = "A".repeat(1500);
  const largeContentB = "B".repeat(1500);

  // Step 1: Establish baseline with m0, m1, m2
  const initialRes = await negotiateSessionSync({
    sessionId: "sess_test",
    filePath,
    baseRevision: null,
    scope,
    isLive: false,
    isRunning: false,
    getFileFingerprint: () => currentFp,
    buildSnapshot: async () => createMockSnapshot({
      sessionId: "sess_test",
      messages: [
        { role: "user", content: "m0" },
        { role: "assistant", content: largeContentA },
        { role: "user", content: largeContentB },
      ],
      entryIds: ["e0", "e1", "e2"],
      leafId: "e2",
    }),
  });

  const baseRev = initialRes.revision;
  assert.ok(baseRev);

  // Step 2: Window shifts to [m1, m2, m3]
  currentFp = "1:2:200:2000:2000"; // File modified
  const deltaRes = await negotiateSessionSync({
    sessionId: "sess_test",
    filePath,
    baseRevision: baseRev,
    scope,
    isLive: false,
    isRunning: false,
    getFileFingerprint: () => currentFp,
    buildSnapshot: async () => createMockSnapshot({
      sessionId: "sess_test",
      messages: [
        { role: "assistant", content: largeContentA },
        { role: "user", content: largeContentB },
        { role: "assistant", content: "m3 append" },
      ],
      entryIds: ["e1", "e2", "e3"],
      leafId: "e3",
    }),
  });

  assert.equal(deltaRes.mode, "delta");
  if (deltaRes.mode === "delta") {
    assert.equal(deltaRes.baseRevision, baseRev);
    assert.equal(deltaRes.dropCount, 1);
    assert.equal(deltaRes.keepCount, 2);
    assert.deepEqual(deltaRes.tailMessages, [{ role: "assistant", content: "m3 append" }]);
    assert.equal("messages" in deltaRes.data.context, false);
    assert.deepEqual(deltaRes.data.context.entryIds, ["e1", "e2", "e3"]);
  }
});

test("negotiateSessionSync: unknown baseRevision resets even if revision matches by chance", async () => {
  clearBaselineCache();
  const scope = createMockScope("sess_test");

  // Unknown baseRevision supplied when baseline cache is completely empty
  const res = await negotiateSessionSync({
    sessionId: "sess_test",
    filePath: "/fake/session.jsonl",
    baseRevision: "rev_unknown_guess",
    scope,
    isLive: false,
    isRunning: false,
    getFileFingerprint: () => "1:2:100:1000:1000",
    buildSnapshot: async () => createMockSnapshot({ sessionId: "sess_test" }),
  });

  assert.equal(res.mode, "reset");
  assert.ok(res.revision !== null && res.revision !== "rev_unknown_guess");
  assert.ok(res.data);
});

test("negotiateSessionSync: scope isolation prevents reusing base from another tail/projection", async () => {
  clearBaselineCache();
  const filePath = "/fake/session.jsonl";
  const fp = "1:2:100:1000:1000";

  // Baseline created with tail: 50
  const scopeA = createMockScope("sess_test", { tail: 50 });
  const initialRes = await negotiateSessionSync({
    sessionId: "sess_test",
    filePath,
    baseRevision: null,
    scope: scopeA,
    isLive: false,
    isRunning: false,
    getFileFingerprint: () => fp,
    buildSnapshot: async () => createMockSnapshot({ sessionId: "sess_test" }),
  });
  const baseRev = initialRes.revision;

  // Client requests with same baseRevision but scopeB (tail: 20)
  const scopeB = createMockScope("sess_test", { tail: 20 });
  const diffScopeRes = await negotiateSessionSync({
    sessionId: "sess_test",
    filePath,
    baseRevision: baseRev,
    scope: scopeB,
    isLive: false,
    isRunning: false,
    getFileFingerprint: () => fp,
    buildSnapshot: async () => createMockSnapshot({
      sessionId: "sess_test",
      context: { messages: [{ role: "user", content: "m2" }], entryIds: ["e2"], oldestEntryId: "e2", hasMore: true },
    }),
  });

  assert.equal(diffScopeRes.mode, "reset");
});

test("negotiateSessionSync: empty session resets cleanly without error", async () => {
  clearBaselineCache();
  const scope = createMockScope("sess_empty");
  const emptyRes = await negotiateSessionSync({
    sessionId: "sess_empty",
    filePath: "/fake/empty.jsonl",
    baseRevision: null,
    scope,
    isLive: false,
    isRunning: false,
    getFileFingerprint: () => "1:2:0:1000:1000",
    buildSnapshot: async () => createMockSnapshot({
      sessionId: "sess_empty",
      messages: [],
      entryIds: [],
      leafId: null,
    }),
  });

  assert.equal(emptyRes.mode, "reset");
  assert.ok(typeof emptyRes.revision === "string");
  assert.deepEqual(emptyRes.data.context.messages, []);
  assert.deepEqual(emptyRes.data.context.entryIds, []);
});

test("negotiateSessionSync: concurrent modification yields revision null and is not cached", async () => {
  clearBaselineCache();
  let callCount = 0;
  const getFp = () => {
    callCount++;
    return callCount === 1 ? "1:2:100:1000:1000" : "1:2:200:1000:1000";
  };
  const scope = createMockScope("sess_concurrent");

  const res = await negotiateSessionSync({
    sessionId: "sess_concurrent",
    filePath: "/fake/session.jsonl",
    baseRevision: null,
    scope,
    isLive: false,
    isRunning: false,
    getFileFingerprint: getFp,
    buildSnapshot: async () => createMockSnapshot({ sessionId: "sess_concurrent" }),
  });

  assert.equal(res.mode, "reset");
  assert.equal(res.revision, null);
  assert.equal(res.data.snapshotRevision, null);
  assert.equal(getBaselineCache().size, 0);
});

test("negotiateSessionSync: all live wrappers (idle or running) return revision null and are not cached", async () => {
  clearBaselineCache();

  // 1. Live but idle (isRunning = false)
  const idleScope = createMockScope("sess_live_idle");
  const idleRes = await negotiateSessionSync({
    sessionId: "sess_live_idle",
    filePath: "/fake/session.jsonl",
    baseRevision: null,
    scope: idleScope,
    isLive: true,
    isRunning: false,
    getFileFingerprint: () => "1:2:100:1000:1000",
    buildSnapshot: async () => createMockSnapshot({ sessionId: "sess_live_idle" }),
  });

  assert.equal(idleRes.mode, "reset");
  assert.equal(idleRes.revision, null);
  assert.equal(idleRes.data.snapshotRevision, null);
  assert.equal(getBaselineCache().size, 0);

  // 2. Live and running (isRunning = true)
  const runScope = createMockScope("sess_live_running");
  const runRes = await negotiateSessionSync({
    sessionId: "sess_live_running",
    filePath: "/fake/session.jsonl",
    baseRevision: null,
    scope: runScope,
    isLive: true,
    isRunning: true,
    getFileFingerprint: () => "1:2:100:1000:1000",
    buildSnapshot: async () => createMockSnapshot({ sessionId: "sess_live_running" }),
  });

  assert.equal(runRes.mode, "reset");
  assert.equal(runRes.revision, null);
  assert.equal(runRes.data.snapshotRevision, null);
  assert.equal(getBaselineCache().size, 0);
});

test("negotiateSessionSync: unstable read detected by isStableRead returns revision null and is not cached", async () => {
  clearBaselineCache();
  const scope = createMockScope("sess_unstable_read");

  const res = await negotiateSessionSync({
    sessionId: "sess_unstable_read",
    filePath: "/fake/session.jsonl",
    baseRevision: null,
    scope,
    isLive: false,
    isRunning: false,
    getFileFingerprint: () => "1:2:100:1000:1000",
    buildSnapshot: async () => createMockSnapshot({ sessionId: "sess_unstable_read" }),
    isStableRead: () => false, // New live wrapper or run appeared during build
  });

  assert.equal(res.mode, "reset");
  assert.equal(res.revision, null);
  assert.equal(res.data.snapshotRevision, null);
  assert.equal(getBaselineCache().size, 0);
});

test("negotiateSessionSync: baseline cache takes deep JSON snapshot immune to subsequent source mutation", async () => {
  clearBaselineCache();
  const filePath = "/fake/session.jsonl";
  const fp = "1:2:100:1000:1000";
  const scope = createMockScope("sess_deep_snapshot");

  const mutableMessages = [
    { role: "user", content: "initial user message" },
    { role: "assistant", content: "initial assistant message" },
  ];
  const mutableSnapshot = createMockSnapshot({
    sessionId: "sess_deep_snapshot",
    messages: mutableMessages,
    entryIds: ["e0", "e1"],
    leafId: "e1",
  });

  const res = await negotiateSessionSync({
    sessionId: "sess_deep_snapshot",
    filePath,
    baseRevision: null,
    scope,
    isLive: false,
    isRunning: false,
    getFileFingerprint: () => fp,
    buildSnapshot: async () => mutableSnapshot,
  });

  const establishedRev = res.revision;
  assert.ok(establishedRev);

  // Mutate the original message objects in memory
  mutableMessages[0].content = "MUTATED_CONTENT";
  mutableSnapshot.context.entryIds.push("e_injected");

  const cached = getBaselineCache().get(establishedRev);
  assert.ok(cached);
  // Cached baseline must still retain the original unmutated deep content
  assert.equal(cached.messages[0].content, "initial user message");
  assert.deepEqual(cached.entryIds, ["e0", "e1"]);
});

test("estimateBaselineEntryBytes returns Infinity on serialization error and avoids caching", () => {
  const circularObj = {};
  circularObj.self = circularObj;

  const entry = {
    revision: "rev_circ",
    sessionId: "sess_circ",
    scopeKey: "key",
    filePath: "/f",
    fingerprint: "fp",
    entryCount: 1,
    latestEntryId: "e",
    leafId: "e",
    messages: [circularObj],
    entryIds: ["e"],
    createdAtMonotonic: 1000,
  };

  const bytes = estimateBaselineEntryBytes(entry);
  assert.equal(bytes, Number.POSITIVE_INFINITY);
});

test("baseline cache: TTL expiration with monotonic performance.now()", () => {
  clearBaselineCache();
  const cache = getBaselineCache();

  let virtualNow = 1000;
  const entry = {
    revision: "rev_ttl_1",
    sessionId: "sess_1",
    scopeKey: "key_1",
    filePath: "/f1",
    fingerprint: "fp1",
    entryCount: 1,
    latestEntryId: "e1",
    leafId: "e1",
    messages: [],
    entryIds: [],
    createdAtMonotonic: virtualNow,
    bytes: 100,
  };
  cache.set(entry.revision, entry);
  assert.equal(cache.has("rev_ttl_1"), true);

  // Advance time within 10 min TTL (5 min = 300,000 ms)
  pruneExpiredBaselines(cache, virtualNow + 300_000);
  assert.equal(cache.has("rev_ttl_1"), true);

  // Advance time past 10 min TTL (11 min = 660,000 ms)
  pruneExpiredBaselines(cache, virtualNow + 660_000);
  assert.equal(cache.has("rev_ttl_1"), false);
});

test("baseline cache: LRU count and byte limits eviction", () => {
  clearBaselineCache();
  const cache = getBaselineCache();

  // 1. Count limit (max 16 entries)
  for (let i = 1; i <= 20; i++) {
    const rev = `rev_${i}`;
    cache.set(rev, {
      revision: rev,
      sessionId: "s",
      scopeKey: "k",
      filePath: "/f",
      fingerprint: "fp",
      entryCount: 1,
      latestEntryId: "e",
      leafId: "e",
      messages: [],
      entryIds: [],
      createdAtMonotonic: 1000 + i,
      bytes: 1024,
    });
    evictBaselineCache(cache);
  }
  assert.equal(cache.size, BASELINE_CACHE_LIMITS.maxEntries);
  assert.equal(cache.has("rev_1"), false); // oldest evicted
  assert.equal(cache.has("rev_20"), true); // newest present

  // 2. Byte limit (32 MiB)
  clearBaselineCache();
  const bigBytes = 10 * 1024 * 1024; // 10 MiB
  for (let i = 1; i <= 5; i++) {
    const rev = `big_rev_${i}`;
    cache.set(rev, {
      revision: rev,
      sessionId: "s",
      scopeKey: "k",
      filePath: "/f",
      fingerprint: "fp",
      entryCount: 1,
      latestEntryId: "e",
      leafId: "e",
      messages: [],
      entryIds: [],
      createdAtMonotonic: 1000 + i,
      bytes: bigBytes,
    });
    evictBaselineCache(cache);
  }
  assert.ok(cache.size <= 3);
  let total = 0;
  for (const item of cache.values()) total += item.bytes;
  assert.ok(total <= BASELINE_CACHE_LIMITS.maxTotalBytes);
});
