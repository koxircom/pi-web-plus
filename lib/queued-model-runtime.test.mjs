import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { AgentSession } from "@earendil-works/pi-coding-agent";

// Use the deployed SDK's actual Agent implementation and session boundary hooks.
// Only provider transport/auth, transcript persistence and unrelated tool-loadout
// work are replaced. No API request or user-owned session file is touched.
const require = createRequire(import.meta.url);
const sdkRequire = createRequire(import.meta.resolve("@earendil-works/pi-coding-agent"));
const { Agent } = await import(new URL("./dist/index.js", pathToFileURL(sdkRequire.resolve("@earendil-works/pi-agent-core/package.json"))));
const model = id => ({ id, name: id, provider: "owned", api: "owned", baseUrl: "",
  reasoning: false, input: ["text"], contextWindow: 10000, maxTokens: 100,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

for (const queue of ["steer", "followUp"]) {
  test(`SDK ${queue} queue uses latest model without replacing in-flight request`, { timeout: 5000 }, async () => {
    const entered = deferred(), release = deferred(), calls = [], changes = [];
    const old = model("original"), middle = model("intermediate"), latest = model("latest");
    const agent = new Agent({ initialState: { model: old, tools: [], messages: [] },
      streamFn: (selected, context) => {
        calls.push({ model: selected.id, messages: context.messages });
        const first = calls.length === 1;
        const answer = { role: "assistant", content: [{ type: "text", text: "隔离响应" }],
          model: selected.id, provider: selected.provider, api: selected.api, stopReason: "stop", timestamp: Date.now(),
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
        return { async *[Symbol.asyncIterator]() {
          yield { type: "start", partial: answer };
          if (first) { entered.resolve(); await release.promise; }
          yield { type: "done", reason: "stop", message: answer };
        }, result: async () => answer };
      } });
    const session = Object.assign(Object.create(AgentSession.prototype), {
      agent, _modelRuntime: { checkAuth: async () => true },
      sessionManager: { appendModelChange: (provider, id) => changes.push({ provider, id }) },
      _baseSystemPromptOptions: {},
      _getThinkingLevelForModelSwitch: () => "off",
      setThinkingLevel: level => { agent.state.thinkingLevel = level; },
      _emitModelSelect: async () => {},
      _compactBeforeNextAssistantResponse: async context => context,
      getActiveToolNames: () => [],
      _preparePromptAndToolLoadout: () => undefined,
    });
    session._installAgentNextTurnRefresh();
    const running = agent.prompt("当前请求");
    await entered.promise;
    try {
      agent[queue]({ role: "user", content: [{ type: "text", text: "排队消息" }], timestamp: Date.now() });
      await session.setModel(middle);
      await session.setModel(latest);
      assert.equal(agent.state.isStreaming, true);
      assert.equal(calls.length, 1);
      assert.equal(calls[0].model, "original");
      assert.deepEqual(changes.map(x => x.id), ["intermediate", "latest"]);
    } finally { release.resolve(); }
    await running;
    assert.deepEqual(calls.map(x => x.model), ["original", "latest"]);
    assert(calls[1].messages.some(m => m.role === "user" && m.content.some(c => c.text === "排队消息")));
    assert.equal(agent.hasQueuedMessages(), false);
    assert.equal(agent.state.isStreaming, false);
  });
}
