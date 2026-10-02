import assert from "node:assert/strict";
import test from "node:test";
import {
  buildHistoryPageCacheKey,
  computeLocalChecksum,
  validateHistoryPageContext,
  getHistoryPageMemory,
  setHistoryPageMemory,
  deleteHistoryPagesMemory,
  clearHistoryPagesMemory,
  resetHistoryPageMemoryForTests,
  MAX_PAGE_BYTES,
  MAX_PAGES,
  MAX_SESSIONS,
  HISTORY_CACHE_PROTOCOL_VERSION,
} from "./session-history-page-cache.ts";

test("buildHistoryPageCacheKey normalizes and isolates all parameters", () => {
  const baseParams = {
    sessionId: "s1",
    leafId: "leafA",
    before: "entryB",
    tail: 50,
    deferThinking: true,
    deferMedia: true,
  };
  const baseKey = buildHistoryPageCacheKey(baseParams);

  // Parameter isolation checks
  assert.notEqual(baseKey, buildHistoryPageCacheKey({ ...baseParams, sessionId: "s2" }));
  assert.notEqual(baseKey, buildHistoryPageCacheKey({ ...baseParams, leafId: "leafB" }));
  assert.notEqual(baseKey, buildHistoryPageCacheKey({ ...baseParams, before: "entryC" }));
  assert.notEqual(baseKey, buildHistoryPageCacheKey({ ...baseParams, tail: 100 }));
  assert.notEqual(baseKey, buildHistoryPageCacheKey({ ...baseParams, deferThinking: false }));
  assert.notEqual(baseKey, buildHistoryPageCacheKey({ ...baseParams, deferMedia: false }));

  // Normalization checks
  assert.equal(
    buildHistoryPageCacheKey({ ...baseParams, tail: -5 }),
    buildHistoryPageCacheKey({ ...baseParams, tail: 50 }),
  );
  assert.equal(
    buildHistoryPageCacheKey({ ...baseParams, tail: 9999 }),
    buildHistoryPageCacheKey({ ...baseParams, tail: 1000 }),
  );
  assert.ok(baseKey.includes(`v${HISTORY_CACHE_PROTOCOL_VERSION}`));
});

test("buildHistoryPageCacheKey prevents delimiter injection and trimming collisions", () => {
  // Key must not collide even if sessionId contains delimiter substrings
  const key1 = buildHistoryPageCacheKey({
    sessionId: "s1::leaf=evil",
    leafId: "l1",
    before: "b1",
    tail: 50,
  });
  const key2 = buildHistoryPageCacheKey({
    sessionId: "s1",
    leafId: "evil::before=b1",
    before: "b1",
    tail: 50,
  });
  assert.notEqual(key1, key2);

  // Whitespace must not be collapsed via destructive trim causing unintended cross-session hit
  const keySpace1 = buildHistoryPageCacheKey({
    sessionId: "s1 ",
    before: "b1",
  });
  const keySpace2 = buildHistoryPageCacheKey({
    sessionId: "s1",
    before: "b1",
  });
  assert.notEqual(keySpace1, keySpace2);
});

test("computeLocalChecksum produces deterministic results and detects changes", () => {
  const strA = JSON.stringify({ messages: [{ role: "user", content: "hello" }] });
  const strB = JSON.stringify({ messages: [{ role: "user", content: "world" }] });

  const checksumA1 = computeLocalChecksum(strA);
  const checksumA2 = computeLocalChecksum(strA);
  const checksumB = computeLocalChecksum(strB);

  assert.equal(checksumA1, checksumA2);
  assert.notEqual(checksumA1, checksumB);
  assert.ok(typeof checksumA1 === "string" && checksumA1.length > 0);
});

test("validateHistoryPageContext enforces parallel arrays, unique IDs, boundary exclusion, and rejects transient state", () => {
  const validContext = {
    messages: [
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
    ],
    entryIds: ["e1", "e2"],
    oldestEntryId: "e1",
    hasMore: true,
  };

  // Valid case
  assert.equal(validateHistoryPageContext(validContext, "e3"), true);

  // Boundary exclusion: if 'before' cursor is in entryIds, must be rejected
  assert.equal(validateHistoryPageContext(validContext, "e2"), false);

  // Mismatched length (messages vs entryIds)
  assert.equal(validateHistoryPageContext({ ...validContext, entryIds: ["e1"] }, "e3"), false);

  // Duplicate IDs
  assert.equal(
    validateHistoryPageContext(
      {
        messages: [{ role: "user", content: "1" }, { role: "user", content: "2" }],
        entryIds: ["dup", "dup"],
        oldestEntryId: "dup",
        hasMore: false,
      },
      "e3",
    ),
    false,
  );

  // Empty string in entryIds
  assert.equal(
    validateHistoryPageContext(
      {
        messages: [{ role: "user", content: "1" }],
        entryIds: [""],
        oldestEntryId: null,
        hasMore: false,
      },
      "e3",
    ),
    false,
  );

  // Illegal streaming / running message state rejected
  const streamingContext = {
    messages: [{ role: "assistant", content: "thinking...", streaming: true }],
    entryIds: ["e1"],
    oldestEntryId: "e1",
    hasMore: false,
  };
  assert.equal(validateHistoryPageContext(streamingContext, "e3"), false);

  // Illegal queued state rejected
  const queuedContext = {
    messages: [{ role: "user", content: "queue me", isQueued: true }],
    entryIds: ["e1"],
    oldestEntryId: "e1",
    hasMore: false,
  };
  assert.equal(validateHistoryPageContext(queuedContext, "e3"), false);

  // Legal empty terminal page
  const emptyTerminalContext = {
    messages: [],
    entryIds: [],
    oldestEntryId: null,
    hasMore: false,
  };
  assert.equal(validateHistoryPageContext(emptyTerminalContext, "e3"), true);

  // A raw page of settings/custom records is valid if its cursor advances.
  assert.equal(
    validateHistoryPageContext({ ...emptyTerminalContext, hasMore: true, oldestEntryId: "e1" }, "e3"),
    true,
  );
  assert.equal(
    validateHistoryPageContext({ ...emptyTerminalContext, hasMore: true }, "e3"),
    false,
  );

  // Invariant 3: hasMore: true with null/empty cursor is illegal
  assert.equal(
    validateHistoryPageContext({
      messages: [{ role: "user", content: "hi" }],
      entryIds: ["e1"],
      oldestEntryId: null,
      hasMore: true,
    }, "e3"),
    false,
  );

  // Invariant 3: hasMore: true with cursor equal to before (looping cursor) is illegal
  assert.equal(
    validateHistoryPageContext({
      messages: [{ role: "user", content: "hi" }],
      entryIds: ["e1"],
      oldestEntryId: "e3",
      hasMore: true,
    }, "e3"),
    false,
  );

  // Invariant 3: rawCursor pointing to non-message entry is legal as long as progressible
  assert.equal(
    validateHistoryPageContext({
      messages: [{ role: "user", content: "hi" }],
      entryIds: ["e2"],
      oldestEntryId: "e1_raw_non_message",
      hasMore: true,
    }, "e3"),
    true,
  );

  // Invariant 3: reject context containing running/queue/SSE at top-level
  assert.equal(
    validateHistoryPageContext({
      ...validContext,
      running: true,
    }, "e3"),
    false,
  );
  assert.equal(
    validateHistoryPageContext({
      ...validContext,
      queue: true,
    }, "e3"),
    false,
  );
});

test("memory cache enforces limits: single page size, max pages, max sessions, and TTL", () => {
  resetHistoryPageMemoryForTests();

  const createPage = (sid, beforeId, customContext, savedAt = Date.now(), customBytes) => {
    const context = customContext || {
      messages: [{ role: "user", content: "msg" }],
      entryIds: [`entry_${beforeId}`],
      oldestEntryId: `entry_${beforeId}`,
      hasMore: false,
    };
    const serialized = JSON.stringify(context);
    const actualBytes = new TextEncoder().encode(serialized).byteLength;
    const bytes = customBytes !== undefined ? customBytes : actualBytes;
    return {
      key: `key_${sid}_${beforeId}`,
      sessionId: sid,
      leafId: "leaf",
      before: beforeId,
      tail: 50,
      deferThinking: true,
      deferMedia: true,
      fingerprint: `fp_${sid}_${beforeId}`,
      protocol: "1",
      context,
      savedAt,
      lastAccessed: savedAt,
      bytes,
      localChecksum: computeLocalChecksum(serialized),
    };
  };

  // 1. Single page oversize refused (> 2 MiB)
  const hugeText = "a".repeat(MAX_PAGE_BYTES + 10);
  const oversizedPage = createPage("s1", "b1", {
    messages: [{ role: "user", content: hugeText }],
    entryIds: ["entry_b1"],
    oldestEntryId: "entry_b1",
    hasMore: false,
  });
  assert.equal(setHistoryPageMemory(oversizedPage), false);
  assert.equal(getHistoryPageMemory(oversizedPage.key), null);

  // 2. Normal insert & LRU read
  const p1 = createPage("s1", "b1");
  assert.equal(setHistoryPageMemory(p1), true);
  const readP1 = getHistoryPageMemory(p1.key);
  assert.ok(readP1 !== null);
  assert.equal(readP1.sessionId, p1.sessionId);
  assert.equal(readP1.before, p1.before);
  assert.deepEqual(readP1.context, p1.context);

  // 3. Max sessions cap (8 sessions)
  for (let i = 2; i <= MAX_SESSIONS + 2; i++) {
    const p = createPage(`s${i}`, "b1");
    setHistoryPageMemory(p);
  }
  // Earliest session s1 should have been evicted
  assert.equal(getHistoryPageMemory(p1.key), null);

  // 4. Delete by sessionId
  const pNew = createPage("s99", "b1");
  setHistoryPageMemory(pNew);
  assert.ok(getHistoryPageMemory(pNew.key) !== null);
  deleteHistoryPagesMemory("s99");
  assert.equal(getHistoryPageMemory(pNew.key), null);

  // 5. Clear all
  clearHistoryPagesMemory();
  for (let i = 2; i <= MAX_SESSIONS + 2; i++) {
    assert.equal(getHistoryPageMemory(`key_s${i}_b1`), null);
  }

  // 6. Expired page (TTL) returns null
  const expiredPage = createPage("s1", "b_old", null, Date.now() - 25 * 60 * 60 * 1000);
  setHistoryPageMemory(expiredPage);
  assert.equal(getHistoryPageMemory(expiredPage.key), null);

  // 7. Caller mutation isolation: caller modifying returned copy must not pollute memory cache
  const pIso = createPage("sIso", "bIso");
  setHistoryPageMemory(pIso);
  const readIso = getHistoryPageMemory(pIso.key);
  assert.ok(readIso !== null);
  readIso.context.messages.push({ role: "assistant", content: "polluted" });
  readIso.localChecksum = "tampered";
  readIso.bytes = -999;
  const readAgain = getHistoryPageMemory(pIso.key);
  assert.ok(readAgain !== null);
  assert.equal(readAgain.context.messages.length, 1);
  assert.equal(readAgain.bytes, pIso.bytes);
  assert.equal(readAgain.localChecksum, pIso.localChecksum);

  // 8. Parameter mismatch detection
  assert.equal(getHistoryPageMemory(pIso.key, { sessionId: "wrong_sid" }), null);
  assert.equal(getHistoryPageMemory(pIso.key, { tail: 999 }), null);
  assert.equal(getHistoryPageMemory(pIso.key, { deferThinking: false }), null);
});
