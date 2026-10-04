import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { buildSessionDetailSnapshot } = await jiti.import("./session-detail-snapshot.ts");

test("detail snapshot keeps full-tree, summary-tree, context, usage and timing projections together", () => {
  const first = {
    type: "message",
    id: "user-1",
    parentId: null,
    timestamp: "2026-01-01T00:00:00.000Z",
    message: { role: "user", content: "first prompt" },
  };
  const second = {
    type: "message",
    id: "assistant-1",
    parentId: "user-1",
    timestamp: "2026-01-01T00:00:00.010Z",
    message: {
      role: "assistant",
      provider: "test",
      model: "fixture",
      content: [{ type: "text", text: "answer" }],
      usage: { input: 3, output: 2, cacheRead: 0, cacheWrite: 0, cost: { total: 0.01 } },
    },
  };
  const subagentMetadata = {
    type: "custom",
    id: "subagent-meta",
    parentId: "assistant-1",
    customType: "pi-web:subagent",
    data: {
      version: 1,
      parentSessionId: "parent-session",
      parentSessionPath: "/tmp/parent-session.jsonl",
      parentToolCallId: "tool-call-1",
      profile: "explore",
      description: "Read-only exploration",
      task: "Inspect the fixture",
      runInBackground: false,
      createdAt: "2026-01-01T00:00:00.000Z",
      resourceSnapshot: {
        version: 1,
        appendSystemPrompt: [],
        tools: ["read"],
        loadSkills: false,
        loadExtensions: false,
      },
    },
  };
  const manager = {
    getEntries: () => [first, second, subagentMetadata],
    getLeafId: () => "assistant-1",
    getTree: () => [{ entry: first, children: [{ entry: second, children: [] }] }],
    getHeader: () => ({ type: "session", version: 3, id: "fixture", cwd: "/tmp", timestamp: first.timestamp }),
    getSessionName: () => "fixture session",
  };
  const options = {
    filePath: "/tmp/fixture.jsonl",
    sessionId: "fixture",
    sourceId: "disk",
    summaryTree: false,
    deferThinking: true,
    deferToolResultImages: true,
    tail: 1,
    fingerprint: "fixture-fingerprint",
  };

  const full = buildSessionDetailSnapshot(manager, options);
  const summary = buildSessionDetailSnapshot(manager, { ...options, summaryTree: true });

  assert.equal(full.leafId, "assistant-1");
  assert.deepEqual(full.context.entryIds, ["assistant-1"]);
  assert.equal(full.stats.totalMessages, 2);
  assert.equal(full.stats.tokens.total, 5);
  assert.equal(full.totalActiveMs, 10);
  assert.equal(full.snapshotRevision, summary.snapshotRevision);
  assert.equal(full.firstMessage, "first prompt");
  assert.equal(full.header.id, "fixture");
  assert.equal(full.sessionName, "fixture session");
  assert.equal(full.subagent.parentSessionId, "parent-session");
  assert.equal(full.subagent.profile, "explore");
  assert.deepEqual(full.toolNames, ["read"]);
  assert.equal(full.tree[0].children[0].entry.message.content[0].text, "answer");
  assert.equal(summary.tree[0].children[0].entry.message, undefined);
});
