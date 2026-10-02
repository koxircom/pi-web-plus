import assert from "node:assert/strict";
import test from "node:test";
import {
  clearSessionViewCache,
  deleteSessionViewSnapshot,
  deleteSessionWireBaseline,
  getSessionViewSnapshot,
  getSessionWireBaseline,
  MAX_SESSION_VIEW_CACHE_SESSIONS,
  resetSessionViewCacheForTests,
  setSessionViewCacheActiveSession,
  setSessionViewCachePriority,
  setSessionViewSnapshot,
  setSessionWireBaseline,
  snapshotCoversLoadedEntries,
} from "./session-view-cache.ts";

function snapshot(overrides = {}) {
  return {
    sessionId: "s1",
    revision: "rev-1",
    messages: [{ role: "user", content: "hello" }],
    entryIds: ["e1"],
    leafId: "e1",
    oldestEntryId: "e1",
    hasMore: false,
    thinkingLevel: "off",
    model: null,
    loadedEntryIds: ["e1"],
    ...overrides,
  };
}

test("stores, reads, and deletes one snapshot with LRU touch", () => {
  resetSessionViewCacheForTests();
  assert.equal(setSessionViewSnapshot(snapshot()), true);
  assert.equal(getSessionViewSnapshot("s1")?.revision, "rev-1");
  assert.equal(getSessionViewSnapshot("missing"), null);
  deleteSessionViewSnapshot("s1");
  assert.equal(getSessionViewSnapshot("s1"), null);
});

test("refuses snapshots without a session id or revision", () => {
  resetSessionViewCacheForTests();
  assert.equal(setSessionViewSnapshot(snapshot({ sessionId: "" })), false);
  assert.equal(setSessionViewSnapshot(snapshot({ revision: "" })), false);
  assert.equal(getSessionViewSnapshot("s1"), null);
});

test("evicts least-recently-used sessions beyond the session cap", () => {
  resetSessionViewCacheForTests();
  for (let i = 0; i < MAX_SESSION_VIEW_CACHE_SESSIONS + 1; i++) {
    setSessionViewSnapshot(snapshot({ sessionId: `s${i}`, revision: `rev-${i}` }));
  }
  assert.equal(getSessionViewSnapshot("s0"), null, "oldest session evicted");
  const last = MAX_SESSION_VIEW_CACHE_SESSIONS;
  assert.equal(getSessionViewSnapshot(`s${last}`)?.revision, `rev-${last}`);
});

test("reading a snapshot refreshes its recency", () => {
  resetSessionViewCacheForTests();
  for (let i = 0; i < MAX_SESSION_VIEW_CACHE_SESSIONS; i++) {
    setSessionViewSnapshot(snapshot({ sessionId: `s${i}`, revision: `rev-${i}` }));
  }
  // Touch s0 so it becomes most-recently used.
  assert.ok(getSessionViewSnapshot("s0"));
  const next = MAX_SESSION_VIEW_CACHE_SESSIONS;
  setSessionViewSnapshot(snapshot({ sessionId: `s${next}`, revision: `rev-${next}` }));
  assert.ok(getSessionViewSnapshot("s0"), "touched session survives eviction");
  assert.equal(getSessionViewSnapshot("s1"), null, "untouched oldest is evicted");
});

test("priority retains important history ahead of an older normal session", () => {
  resetSessionViewCacheForTests();
  for (let i = 0; i < MAX_SESSION_VIEW_CACHE_SESSIONS; i++) {
    setSessionViewSnapshot(snapshot({ sessionId: `s${i}`, revision: `rev-${i}` }));
  }
  assert.equal(setSessionViewCachePriority("s0", "attention"), true);
  const next = MAX_SESSION_VIEW_CACHE_SESSIONS;
  setSessionViewSnapshot(snapshot({ sessionId: `s${next}`, revision: `rev-${next}` }));
  assert.ok(getSessionViewSnapshot("s0", false), "attention session remains resident");
  assert.equal(getSessionViewSnapshot("s1", false), null, "oldest normal session is evicted");
});

test("priority metadata updates do not serialize the cached message payload again", () => {
  resetSessionViewCacheForTests();
  let serializations = 0;
  const message = {
    role: "user",
    toJSON() {
      serializations++;
      return { role: "user", content: "payload" };
    },
  };
  assert.equal(setSessionViewSnapshot(snapshot({ messages: [message] })), true);
  const afterInsert = serializations;
  assert.equal(afterInsert, 1);
  assert.equal(setSessionViewCachePriority("s1", "running"), true);
  assert.equal(serializations, afterInsert);
});

test("active session survives when every resident has the highest status priority", () => {
  resetSessionViewCacheForTests();
  for (let i = 0; i < MAX_SESSION_VIEW_CACHE_SESSIONS; i++) {
    const sessionId = `s${i}`;
    setSessionViewSnapshot(snapshot({ sessionId, revision: `rev-${i}` }));
    setSessionViewCachePriority(sessionId, "attention");
  }
  setSessionViewCacheActiveSession("s0");
  const next = MAX_SESSION_VIEW_CACHE_SESSIONS;
  setSessionViewSnapshot(snapshot({
    sessionId: `s${next}`,
    revision: `rev-${next}`,
    cachePriority: "attention",
  }));
  assert.ok(getSessionViewSnapshot("s0", false), "active session has eviction precedence");
  assert.equal(getSessionViewSnapshot("s1", false), null, "oldest non-active session is evicted");
});

test("clearSessionViewCache drops every entry (logout path)", () => {
  resetSessionViewCacheForTests();
  setSessionViewSnapshot(snapshot({ sessionId: "a" }));
  setSessionViewSnapshot(snapshot({ sessionId: "b" }));
  clearSessionViewCache();
  assert.equal(getSessionViewSnapshot("a"), null);
  assert.equal(getSessionViewSnapshot("b"), null);
});

test("coverage check treats paged-in entries as covered only when recorded", () => {
  const base = snapshot({ entryIds: ["e1", "e2"] });
  assert.equal(snapshotCoversLoadedEntries(base, []), true);
  assert.equal(snapshotCoversLoadedEntries(base, ["e1"]), true);
  assert.equal(snapshotCoversLoadedEntries(base, ["e9"]), false);
  assert.equal(
    snapshotCoversLoadedEntries({ ...base, loadedEntryIds: ["e1", "e2", "e3", "e4"] }, ["e3", "e4"]),
    true,
  );
});

test("stores, reads, and deletes wire baselines independently", () => {
  resetSessionViewCacheForTests();
  assert.equal(
    setSessionWireBaseline({
      sessionId: "s1",
      revision: "wire-rev-1",
      messages: [{ role: "user", content: "wire msg" }],
      entryIds: ["e1"],
    }),
    true,
  );
  assert.equal(getSessionWireBaseline("s1")?.revision, "wire-rev-1");
  assert.equal(getSessionWireBaseline("missing"), null);

  // deleteSessionWireBaseline explicitly drops baseline
  deleteSessionWireBaseline("s1");
  assert.equal(getSessionWireBaseline("s1"), null);

  // deleteSessionViewSnapshot also drops baseline to prevent 404/401 resurrection
  setSessionWireBaseline({
    sessionId: "s2",
    revision: "wire-rev-2",
    messages: [],
    entryIds: [],
  });
  assert.equal(getSessionWireBaseline("s2")?.revision, "wire-rev-2");
  deleteSessionViewSnapshot("s2");
  assert.equal(getSessionWireBaseline("s2"), null);
});

test("live previews share residency without pretending to be certified wire baselines", () => {
  resetSessionViewCacheForTests();
  assert.equal(setSessionViewSnapshot(snapshot({ revision: null, livePreview: true })), true);
  assert.equal(getSessionViewSnapshot("s1").revision, null);
  assert.equal(getSessionWireBaseline("s1"), null);
  assert.equal(setSessionViewSnapshot(snapshot({ sessionId: "s2", revision: null })), false);
});
