import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  buildSessionContext,
} = await jiti.import("./session-reader.ts");

const T0 = Date.parse("2026-01-01T00:00:00.000Z");

test("32-second fixture: assistant preserves message.timestamp start and carries 32s completedAt end in context and JSON", () => {
  const userEntry = {
    type: "message",
    id: "u1",
    parentId: null,
    timestamp: new Date(T0).toISOString(),
    message: {
      role: "user",
      content: "start working",
      timestamp: T0,
    },
  };

  const assistantMessageOriginal = {
    role: "assistant",
    provider: "test-provider",
    model: "test-model",
    content: [{ type: "text", text: "done in 32s" }],
    timestamp: T0 + 30_000, // started at t0 + 30s
    usage: {
      input: 10,
      output: 20,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 30,
      cost: { input: 0.001, output: 0.002, cacheRead: 0, cacheWrite: 0, total: 0.003 },
    },
  };

  const assistantEntry = {
    type: "message",
    id: "a1",
    parentId: "u1",
    timestamp: new Date(T0 + 32_000).toISOString(), // completed at t0 + 32s
    message: assistantMessageOriginal,
  };

  const context = buildSessionContext([userEntry, assistantEntry]);

  // Assert user message has no completedAt
  assert.equal(context.messages[0].role, "user");
  assert.equal(context.messages[0].completedAt, undefined);

  // Assert assistant message has request start timestamp and completedAt endpoint
  const assistantMsg = context.messages[1];
  assert.equal(assistantMsg.role, "assistant");
  assert.equal(assistantMsg.timestamp, T0 + 30_000);
  assert.equal(assistantMsg.completedAt, T0 + 32_000);

  // Assert SDK original message is not mutated
  assert.equal(assistantMessageOriginal.completedAt, undefined);
  assert.notStrictEqual(assistantMsg, assistantMessageOriginal);

  // Assert JSON serialization roundtrip carries the 32s endpoint
  const serialized = JSON.stringify(context);
  const parsed = JSON.parse(serialized);
  assert.equal(parsed.messages[1].timestamp, T0 + 30_000);
  assert.equal(parsed.messages[1].completedAt, T0 + 32_000);
});

test("completedAt is dropped if entry.timestamp is earlier than parsed message.timestamp", () => {
  const userEntry = {
    type: "message",
    id: "u1",
    parentId: null,
    timestamp: new Date(T0).toISOString(),
    message: { role: "user", content: "hello", timestamp: T0 },
  };

  const assistantEntry = {
    type: "message",
    id: "a1",
    parentId: "u1",
    timestamp: new Date(T0 + 20_000).toISOString(), // 20s (earlier than 30s start!)
    message: {
      role: "assistant",
      provider: "test",
      model: "test",
      content: [{ type: "text", text: "impossible timing" }],
      timestamp: T0 + 30_000, // 30s
    },
  };

  const context = buildSessionContext([userEntry, assistantEntry]);
  assert.equal(context.messages[1].completedAt, undefined);
  assert.equal(context.messages[1].timestamp, T0 + 30_000);
});

test("missing or invalid entry.timestamp does not populate completedAt (no Date.now fallback)", () => {
  const testCases = ["", "invalid-date", null, undefined];
  for (const invalidTimestamp of testCases) {
    const entry = {
      type: "message",
      id: "a1",
      parentId: null,
      timestamp: invalidTimestamp,
      message: {
        role: "assistant",
        provider: "test",
        model: "test",
        content: [{ type: "text", text: "no ts" }],
        timestamp: T0,
      },
    };
    const context = buildSessionContext([entry]);
    assert.equal(context.messages[0].completedAt, undefined);
  }
});

test("preserves completedAt with deferThinking and legacy string content", () => {
  const legacyEntry = {
    type: "message",
    id: "a1",
    parentId: null,
    timestamp: new Date(T0 + 32_000).toISOString(),
    message: {
      role: "assistant",
      provider: "test",
      model: "test",
      content: "legacy string content",
      timestamp: T0 + 30_000,
    },
  };

  const thinkingEntry = {
    type: "message",
    id: "a2",
    parentId: "a1",
    timestamp: new Date(T0 + 35_000).toISOString(),
    message: {
      role: "assistant",
      provider: "test",
      model: "test",
      content: [
        { type: "thinking", thinking: "long thought process..." },
        { type: "text", text: "final answer" },
      ],
      timestamp: T0 + 33_000,
    },
  };

  const context = buildSessionContext([legacyEntry, thinkingEntry], "a2", {
    deferThinking: true,
  });

  assert.equal(context.messages[0].completedAt, T0 + 32_000);
  assert.deepEqual(context.messages[0].content, [{ type: "text", text: "legacy string content" }]);

  assert.equal(context.messages[1].completedAt, T0 + 35_000);
  assert.equal(context.messages[1].content[0].deferred, true);
});

test("preserves completedAt across tail pagination and excludeLeaf", () => {
  const entries = [
    {
      type: "message",
      id: "u1",
      parentId: null,
      timestamp: new Date(T0).toISOString(),
      message: { role: "user", content: "msg1" },
    },
    {
      type: "message",
      id: "a1",
      parentId: "u1",
      timestamp: new Date(T0 + 32_000).toISOString(),
      message: {
        role: "assistant",
        provider: "test",
        model: "test",
        content: [{ type: "text", text: "reply1" }],
        timestamp: T0 + 30_000,
      },
    },
    {
      type: "message",
      id: "u2",
      parentId: "a1",
      timestamp: new Date(T0 + 40_000).toISOString(),
      message: { role: "user", content: "msg2" },
    },
    {
      type: "message",
      id: "a2",
      parentId: "u2",
      timestamp: new Date(T0 + 50_000).toISOString(),
      message: {
        role: "assistant",
        provider: "test",
        model: "test",
        content: [{ type: "text", text: "reply2" }],
        timestamp: T0 + 45_000,
      },
    },
  ];

  // Tail pagination
  const tailContext = buildSessionContext(entries, "a2", { tail: 2 });
  assert.equal(tailContext.messages.length, 2);
  assert.equal(tailContext.messages[1].completedAt, T0 + 50_000);

  // Exclude leaf
  const pageUpContext = buildSessionContext(entries, "a2", { tail: 2, excludeLeaf: true });
  assert.equal(pageUpContext.messages.length, 2);
  assert.equal(pageUpContext.messages[0].role, "assistant");
  assert.equal(pageUpContext.messages[0].completedAt, T0 + 32_000);
  assert.equal(pageUpContext.messages[1].role, "user");
  assert.equal(pageUpContext.messages[1].completedAt, undefined);
});

test("non-finite timestamps (NaN, Infinity, -Infinity) do not populate completedAt or corrupt message timing", () => {
  const invalidCases = [
    NaN,
    Infinity,
    -Infinity,
    "NaN",
    "Infinity",
    "-Infinity",
  ];

  for (const invalidValue of invalidCases) {
    const entry = {
      type: "message",
      id: "a_inv",
      parentId: null,
      timestamp: invalidValue,
      message: {
        role: "assistant",
        provider: "test-provider",
        model: "test-model",
        content: [{ type: "text", text: "sample text" }],
        timestamp: T0,
      },
    };
    const context = buildSessionContext([entry]);
    assert.equal(
      context.messages[0].completedAt,
      undefined,
      `expected undefined completedAt for non-finite value: ${String(invalidValue)}`
    );
    assert.equal(context.messages[0].timestamp, T0);
    assert.equal(context.messages[0].model, "test-model");
  }

  // When message.timestamp is non-finite, completedAt uses valid entry.timestamp while original timestamp is preserved
  for (const nonFiniteStart of [NaN, Infinity, -Infinity]) {
    const entry = {
      type: "message",
      id: "a_non_finite_start",
      parentId: null,
      timestamp: new Date(T0 + 10_000).toISOString(),
      message: {
        role: "assistant",
        provider: "test-provider",
        model: "test-model",
        content: [{ type: "text", text: "sample text" }],
        timestamp: nonFiniteStart,
      },
    };
    const context = buildSessionContext([entry]);
    assert.equal(context.messages[0].completedAt, T0 + 10_000);
    assert.equal(context.messages[0].timestamp, nonFiniteStart);
  }
});

test("branch tree with two leaves preserves distinct completedAt endpoints, usage, model, and content on each leaf path", () => {
  const commonUser = {
    type: "message",
    id: "u1",
    parentId: null,
    timestamp: new Date(T0).toISOString(),
    message: { role: "user", content: "root question", timestamp: T0 },
  };

  const commonAssistantMsg = {
    role: "assistant",
    provider: "provider-common",
    model: "model-common",
    content: [{ type: "text", text: "common assistant reply" }],
    timestamp: T0 + 10_000,
    usage: { input: 10, output: 20, totalTokens: 30 },
  };

  const commonAssistant = {
    type: "message",
    id: "a1",
    parentId: "u1",
    timestamp: new Date(T0 + 15_000).toISOString(),
    message: commonAssistantMsg,
  };

  // Branch A (leaf: a2_a)
  const branchAUser = {
    type: "message",
    id: "u2_a",
    parentId: "a1",
    timestamp: new Date(T0 + 20_000).toISOString(),
    message: { role: "user", content: "question on branch A", timestamp: T0 + 20_000 },
  };

  const branchAAssistantMsg = {
    role: "assistant",
    provider: "provider-a",
    model: "model-a",
    content: [{ type: "text", text: "branch A answer" }],
    timestamp: T0 + 30_000,
    usage: { input: 100, output: 200, totalTokens: 300 },
  };

  const branchAAssistant = {
    type: "message",
    id: "a2_a",
    parentId: "u2_a",
    timestamp: new Date(T0 + 35_000).toISOString(),
    message: branchAAssistantMsg,
  };

  // Branch B (leaf: a2_b, diverging from a1)
  const branchBUser = {
    type: "message",
    id: "u2_b",
    parentId: "a1",
    timestamp: new Date(T0 + 40_000).toISOString(),
    message: { role: "user", content: "question on branch B", timestamp: T0 + 40_000 },
  };

  const branchBAssistantMsg = {
    role: "assistant",
    provider: "provider-b",
    model: "model-b",
    content: [{ type: "text", text: "branch B answer" }],
    timestamp: T0 + 50_000,
    usage: { input: 400, output: 500, totalTokens: 900 },
  };

  const branchBAssistant = {
    type: "message",
    id: "a2_b",
    parentId: "u2_b",
    timestamp: new Date(T0 + 60_000).toISOString(),
    message: branchBAssistantMsg,
  };

  const allEntries = [
    commonUser,
    commonAssistant,
    branchAUser,
    branchAAssistant,
    branchBUser,
    branchBAssistant,
  ];

  // 1. Resolve Branch A leaf ("a2_a")
  const contextA = buildSessionContext(allEntries, "a2_a");
  assert.deepEqual(contextA.entryIds, ["u1", "a1", "u2_a", "a2_a"]);
  assert.equal(contextA.messages.length, 4);

  // Common ancestor assistant on branch A path
  assert.equal(contextA.messages[1].role, "assistant");
  assert.equal(contextA.messages[1].timestamp, T0 + 10_000);
  assert.equal(contextA.messages[1].completedAt, T0 + 15_000);
  assert.equal(contextA.messages[1].model, "model-common");
  assert.deepEqual(contextA.messages[1].usage, { input: 10, output: 20, totalTokens: 30 });
  assert.deepEqual(contextA.messages[1].content, [{ type: "text", text: "common assistant reply" }]);

  // Leaf A assistant
  const leafAMsg = contextA.messages[3];
  assert.equal(leafAMsg.role, "assistant");
  assert.equal(leafAMsg.timestamp, T0 + 30_000);
  assert.equal(leafAMsg.completedAt, T0 + 35_000);
  assert.equal(leafAMsg.model, "model-a");
  assert.equal(leafAMsg.provider, "provider-a");
  assert.deepEqual(leafAMsg.usage, { input: 100, output: 200, totalTokens: 300 });
  assert.deepEqual(leafAMsg.content, [{ type: "text", text: "branch A answer" }]);

  // 2. Resolve Branch B leaf ("a2_b")
  const contextB = buildSessionContext(allEntries, "a2_b");
  assert.deepEqual(contextB.entryIds, ["u1", "a1", "u2_b", "a2_b"]);
  assert.equal(contextB.messages.length, 4);

  // Common ancestor assistant on branch B path
  assert.equal(contextB.messages[1].role, "assistant");
  assert.equal(contextB.messages[1].timestamp, T0 + 10_000);
  assert.equal(contextB.messages[1].completedAt, T0 + 15_000);
  assert.equal(contextB.messages[1].model, "model-common");
  assert.deepEqual(contextB.messages[1].usage, { input: 10, output: 20, totalTokens: 30 });
  assert.deepEqual(contextB.messages[1].content, [{ type: "text", text: "common assistant reply" }]);

  // Leaf B assistant
  const leafBMsg = contextB.messages[3];
  assert.equal(leafBMsg.role, "assistant");
  assert.equal(leafBMsg.timestamp, T0 + 50_000);
  assert.equal(leafBMsg.completedAt, T0 + 60_000);
  assert.equal(leafBMsg.model, "model-b");
  assert.equal(leafBMsg.provider, "provider-b");
  assert.deepEqual(leafBMsg.usage, { input: 400, output: 500, totalTokens: 900 });
  assert.deepEqual(leafBMsg.content, [{ type: "text", text: "branch B answer" }]);

  // Invariants: original raw message objects must not be mutated
  assert.equal(commonAssistantMsg.completedAt, undefined);
  assert.equal(branchAAssistantMsg.completedAt, undefined);
  assert.equal(branchBAssistantMsg.completedAt, undefined);
});
