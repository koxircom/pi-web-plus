import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  return import("./chat-scroll-position.ts");
}

test("anchors the most recent turn that started before the viewport", async () => {
  const { findChatScrollAnchor } = await loadSubject();
  const anchor = findChatScrollAnchor([
    { entryId: "current-turn", top: 20, bottom: 80 },
    { entryId: "next-turn", top: 420, bottom: 480 },
  ], 200);

  assert.deepEqual(anchor, {
    anchorEntryId: "current-turn",
    anchorOffset: -180,
  });
});

test("falls back to the last message when the viewport is below all candidates", async () => {
  const { findChatScrollAnchor } = await loadSubject();
  assert.deepEqual(findChatScrollAnchor([
    { entryId: "first", top: 0, bottom: 100 },
    { entryId: "last", top: 100, bottom: 200 },
  ], 250), {
    anchorEntryId: "last",
    anchorOffset: -150,
  });
});

test("uses the first turn when the viewport starts above it", async () => {
  const { findChatScrollAnchor } = await loadSubject();
  assert.deepEqual(findChatScrollAnchor([
    { entryId: "first", top: 120, bottom: 180 },
    { entryId: "second", top: 240, bottom: 300 },
  ], 100), {
    anchorEntryId: "first",
    anchorOffset: 20,
  });
});

test("returns null when the conversation has no anchor candidates", async () => {
  const { findChatScrollAnchor } = await loadSubject();
  assert.equal(findChatScrollAnchor([], 100), null);
});


test("preserves the exact public paragraph when one message has multiple runs", async () => {
  const { findChatScrollAnchor } = await loadSubject();
  assert.deepEqual(findChatScrollAnchor([
    { entryId: "same-message", anchorKey: "public-0-same-message", top: 0, bottom: 100 },
    { entryId: "same-message", anchorKey: "public-2-same-message", top: 200, bottom: 300 },
  ], 240), { anchorEntryId: "same-message", anchorKey: "public-2-same-message", anchorOffset: -40 });
});

test("migrates older tab positions and retains the exact public paragraph key", async () => {
  const { readChatScrollPositions, serializeChatScrollPositions } = await loadSubject();
  const legacy = readChatScrollPositions(JSON.stringify([
    { sessionId: "older", isAtBottom: false, anchorEntryId: "entry", anchorOffset: -18, scrollTop: 900 },
    { sessionId: "tail", isAtBottom: true },
  ]));
  assert.deepEqual(legacy.get("older"), { atBottom: false, anchorEntryId: "entry", anchorOffset: -18, oldestEntryId: null });
  legacy.set("exact", { atBottom: false, anchorEntryId: "entry", anchorKey: "public-2-entry", anchorOffset: -18, oldestEntryId: "oldest" });
  assert.deepEqual(readChatScrollPositions(serializeChatScrollPositions(legacy)), legacy);
});

test("ignores malformed positions and bounds tab metadata", async () => {
  const { readChatScrollPositions, serializeChatScrollPositions } = await loadSubject();
  assert.equal(readChatScrollPositions("broken").size, 0);
  assert.equal(readChatScrollPositions(JSON.stringify([{ sessionId: "bad", atBottom: false, anchorEntryId: "e", anchorOffset: null }])).size, 0);
  const many = new Map(Array.from({ length: 90 }, (_, i) => [String(i), { atBottom: true }]));
  const roundtrip = readChatScrollPositions(serializeChatScrollPositions(many));
  assert.equal(roundtrip.size, 80);
  assert.equal(roundtrip.has("0"), false);
  assert.equal(roundtrip.has("89"), true);
});
