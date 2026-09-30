import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildEnhancementHistoryState,
  clampHistoryLoadTail,
  collectTurnPublicOutput,
  createEarlierHistoryLoader,
  installNativeProcessCollapseFlag,
  isEnhancementPluginEnabled,
  markOptimisticUserMessage,
  NATIVE_PROCESS_COLLAPSE_VERSION,
  PROCESS_COLLAPSE_CHANGE_EVENT,
  reconcileDeliveredUserMessage,
  registerHistoryViewportBridges,
  registerSessionReloadAliases,
  resolveTurnGroupRange,
  splitTurnMessagesForDisplay,
  subscribeProcessCollapseChange,
} from "./enhancement-chat-bridge.ts";

function makeAssistantMessage(content, extra = {}) {
  return {
    role: "assistant",
    content,
    timestamp: 1000,
    usage: { input: 10, output: 20, cacheRead: 0, cacheWrite: 0, total: 30 },
    ...extra,
  };
}

test("task-tool-auto-collapse keeps substantive text, images, and unknown blocks public even before tool calls", () => {
  const messages = [
    { role: "user", content: "分析并执行", timestamp: 900 },
    makeAssistantMessage([
      { type: "thinking", thinking: "先思考步骤" },
      { type: "text", text: "这是工具调用前的公开报告正文" },
      { type: "text", text: "   \n  " },
      { type: "image", source: { type: "base64", media_type: "image/png", data: "abc" } },
      { type: "future_artifact", title: "未知输出块" },
      { type: "toolCall", toolCallId: "tc-1", toolName: "select_quick_action", input: {} },
    ]),
  ];

  const collected = collectTurnPublicOutput(messages, 0, 1);
  assert.equal(collected.visibleBlocks.length, 3);
  assert.deepEqual(
    collected.visibleBlocks.map((b) => b.type),
    ["text", "image", "future_artifact"],
  );
  assert.deepEqual(
    collected.processByIndex.get(1)?.map((b) => b.type),
    ["thinking", "toolCall"],
  );

  const splitEnabled = splitTurnMessagesForDisplay(messages, 0, 2, true);
  assert.equal(splitEnabled.finalAssistantIdx, 1);
  assert.ok(splitEnabled.finalAnswerMessage);
  assert.deepEqual(
    splitEnabled.finalAnswerMessage.content.map((b) => b.type),
    ["text", "image", "future_artifact"],
  );
  const processMsg = splitEnabled.getProcessAssistantMessage(1, messages[1]);
  assert.deepEqual(
    processMsg.content.map((b) => b.type),
    ["thinking", "toolCall"],
  );
  assert.equal(processMsg.usage, undefined);

  // When disabled, native splitting rules apply (text before trailing toolCall stays in process).
  const splitDisabled = splitTurnMessagesForDisplay(messages, 0, 2, false);
  assert.equal(splitDisabled.finalAssistantIdx, 1);
  assert.equal(splitDisabled.finalAnswerMessage, null);
  const nativeProcessMsg = splitDisabled.getProcessAssistantMessage(1, messages[1]);
  assert.equal(nativeProcessMsg.content.length, 6);
  assert.ok(nativeProcessMsg.usage);
});

test("multi-assistant turns merge all public text into the visible output while keeping per-step process blocks", () => {
  const messages = [
    { role: "user", content: "多步任务", timestamp: 100 },
    makeAssistantMessage([
      { type: "thinking", thinking: "step 1 thinking" },
      { type: "text", text: "第一阶段公开说明" },
      { type: "toolCall", toolCallId: "call-1", toolName: "read", input: { path: "a.ts" } },
    ], { usage: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, total: 3 } }),
    { role: "toolResult", toolCallId: "call-1", toolName: "read", content: [{ type: "text", text: "ok" }] },
    makeAssistantMessage([
      { type: "thinking", thinking: "step 2 thinking" },
      { type: "toolCall", toolCallId: "call-2", toolName: "edit", input: { path: "a.ts" } },
      { type: "text", text: "最终完成汇报" },
    ], { usage: { input: 4, output: 5, cacheRead: 0, cacheWrite: 0, total: 9 } }),
  ];

  const split = splitTurnMessagesForDisplay(messages, 0, messages.length, true);
  assert.equal(split.finalAssistantIdx, 3);
  assert.ok(split.finalAnswerMessage);
  assert.deepEqual(
    split.finalAnswerMessage.content.map((b) => b.text),
    ["第一阶段公开说明", "最终完成汇报"],
  );

  const step1Process = split.getProcessAssistantMessage(1, messages[1]);
  assert.deepEqual(step1Process.content.map((b) => b.type), ["thinking", "toolCall"]);
  assert.ok(step1Process.usage);

  const step2Process = split.getProcessAssistantMessage(3, messages[3]);
  assert.deepEqual(step2Process.content.map((b) => b.type), ["thinking", "toolCall"]);
  assert.equal(step2Process.usage, undefined);
});

test("preserves provider error and length truncation notices on completed turns without public text", () => {
  const errorMessages = [
    { role: "user", content: "报错测试", timestamp: 100 },
    makeAssistantMessage(
      [{ type: "thinking", thinking: "仅思考后报错" }],
      { stopReason: "error", errorMessage: "Rate limit exceeded" },
    ),
  ];

  const errorSplit = splitTurnMessagesForDisplay(errorMessages, 0, errorMessages.length, true);
  assert.equal(errorSplit.finalAssistantIdx, 1);
  assert.ok(errorSplit.finalAnswerMessage);
  assert.equal(errorSplit.finalAnswerMessage.stopReason, "error");
  assert.equal(errorSplit.finalAnswerMessage.errorMessage, "Rate limit exceeded");
  assert.deepEqual(errorSplit.finalAnswerMessage.content, []);

  const truncatedMessages = [
    { role: "user", content: "截断测试", timestamp: 100 },
    makeAssistantMessage(
      [{ type: "thinking", thinking: "思考耗尽预算" }],
      { stopReason: "length" },
    ),
  ];

  const truncatedSplit = splitTurnMessagesForDisplay(truncatedMessages, 0, truncatedMessages.length, true);
  assert.ok(truncatedSplit.finalAnswerMessage);
  assert.equal(truncatedSplit.finalAnswerMessage.stopReason, "length");
});

test("folds orphan history prefixes at index 0 only when task-tool-auto-collapse is enabled", () => {
  const messages = [
    makeAssistantMessage([
      { type: "thinking", thinking: "孤儿历史思考" },
      { type: "toolCall", toolCallId: "t0", toolName: "bash", input: {} },
    ]),
    { role: "toolResult", toolCallId: "t0", toolName: "bash", content: [] },
    makeAssistantMessage([
      { type: "text", text: "孤儿历史回答" },
    ]),
    { role: "user", content: "下一轮问题", timestamp: 200 },
  ];

  const rangeEnabled = resolveTurnGroupRange(messages, 0, true);
  assert.deepEqual(rangeEnabled, { userIdx: -1, endIdx: 3 });

  const splitEnabled = splitTurnMessagesForDisplay(
    messages,
    rangeEnabled.userIdx,
    rangeEnabled.endIdx,
    true,
  );
  assert.equal(splitEnabled.finalAssistantIdx, 2);
  assert.deepEqual(
    splitEnabled.finalAnswerMessage?.content.map((b) => b.text),
    ["孤儿历史回答"],
  );

  // When disabled, index 0 without an anchor is not grouped as a turn.
  assert.equal(resolveTurnGroupRange(messages, 0, false), null);
});

test("evaluates plugin toggle state and dispatches process-collapse change notifications", () => {
  const listeners = new Map();
  const storage = new Map();
  const win = {
    localStorage: {
      getItem: (key) => (storage.has(key) ? storage.get(key) : null),
    },
    addEventListener: (type, fn) => {
      listeners.set(type, fn);
    },
    removeEventListener: (type, fn) => {
      if (listeners.get(type) === fn) listeners.delete(type);
    },
  };

  installNativeProcessCollapseFlag(win);
  assert.equal(win.__PI_ENH_NATIVE_PROCESS_COLLAPSE__, NATIVE_PROCESS_COLLAPSE_VERSION);

  // Default enabled
  assert.equal(isEnhancementPluginEnabled("task-tool-auto-collapse", win), true);

  // Legacy per-plugin flag
  storage.set("pi-enh-plugin-task-tool-auto-collapse", "false");
  assert.equal(isEnhancementPluginEnabled("task-tool-auto-collapse", win), false);

  // Settings v1 feature override takes precedence over legacy key
  storage.set(
    "pi-enh-settings-v1",
    JSON.stringify({
      modules: { "conversation-navigation": { enabled: true } },
      features: { "task-tool-auto-collapse": { enabled: true } },
    }),
  );
  assert.equal(isEnhancementPluginEnabled("task-tool-auto-collapse", win), true);

  // Disabling parent module disables feature
  storage.set(
    "pi-enh-settings-v1",
    JSON.stringify({
      modules: { "conversation-navigation": { enabled: false } },
      features: { "task-tool-auto-collapse": { enabled: true } },
    }),
  );
  assert.equal(isEnhancementPluginEnabled("task-tool-auto-collapse", win), false);

  // Runtime function takes highest precedence
  win.__PI_ENH_IS_PLUGIN_ENABLED__ = (id) => id === "task-tool-auto-collapse";
  assert.equal(isEnhancementPluginEnabled("task-tool-auto-collapse", win), true);

  let notified = 0;
  const unsubscribe = subscribeProcessCollapseChange(() => {
    notified += 1;
  }, win);
  assert.ok(listeners.has(PROCESS_COLLAPSE_CHANGE_EVENT));
  listeners.get(PROCESS_COLLAPSE_CHANGE_EVENT)();
  assert.equal(notified, 1);
  unsubscribe();
  assert.equal(listeners.has(PROCESS_COLLAPSE_CHANGE_EVENT), false);
});

test("history state and earlier loader enforce tail bounds, concurrency guards, and session-switch isolation", async () => {
  assert.equal(clampHistoryLoadTail(undefined), 250);
  assert.equal(clampHistoryLoadTail(null), 250);
  assert.equal(clampHistoryLoadTail(""), 250);
  assert.equal(clampHistoryLoadTail("invalid"), 250);
  assert.equal(clampHistoryLoadTail(10), 50);
  assert.equal(clampHistoryLoadTail(30), 50);
  assert.equal(clampHistoryLoadTail(180.4), 180);
  assert.equal(clampHistoryLoadTail(999), 500);

  const state = buildEnhancementHistoryState({
    sessionId: "sess-1",
    totalTurns: 12,
    hasEarlierMessages: true,
    entryIds: ["e1", "e2"],
    oldestEntryId: "e1",
  });
  assert.deepEqual(state, {
    sessionId: "sess-1",
    totalTurns: 12,
    hasEarlierMessages: true,
    entryIds: ["e1", "e2"],
    oldestEntryId: "e1",
  });

  let loading = false;
  let hasMore = true;
  let oldestId = "cursor-1";
  let currentSessionId = "sess-1";
  let activeLeafId = "leaf-1";
  let anchorCaptured = 0;
  let anchorCleared = 0;
  const loadedContexts = [];
  const requestedTails = [];

  let resolveFlight;
  const loadEarlier = createEarlierHistoryLoader({
    isLoading: () => loading,
    setLoading: (next) => {
      loading = next;
    },
    hasEarlierMessages: () => hasMore,
    getOldestEntryId: () => oldestId,
    getSessionId: () => currentSessionId,
    getActiveLeafId: () => activeLeafId,
    captureScrollAnchor: () => {
      anchorCaptured += 1;
    },
    clearScrollAnchor: () => {
      anchorCleared += 1;
    },
    loadContext: async (sid, leaf, before, options) => {
      requestedTails.push({ sid, leaf, before, tail: options.tail });
      return await new Promise((resolve) => {
        resolveFlight = resolve;
      });
    },
    onContextLoaded: (ctx) => {
      loadedContexts.push(ctx);
    },
  });

  // Start first request with tail=20 (clamped to 50)
  const firstPromise = loadEarlier(20);
  assert.equal(loading, true);
  assert.equal(anchorCaptured, 1);

  // Concurrent call while loading must return false immediately
  assert.equal(await loadEarlier(100), false);
  assert.equal(requestedTails.length, 1);
  assert.equal(requestedTails[0].tail, 50);

  resolveFlight({ messages: [{ role: "user", content: "older" }], entryIds: ["e0"] });
  assert.equal(await firstPromise, true);
  assert.equal(loading, false);
  assert.equal(loadedContexts.length, 1);
  assert.equal(anchorCleared, 0);

  // Switch session while a request is in flight: must not commit stale context
  const stalePromise = loadEarlier(600);
  assert.equal(requestedTails[1].tail, 500);
  currentSessionId = "sess-2";
  resolveFlight({ messages: [{ role: "user", content: "stale" }], entryIds: ["stale-0"] });
  assert.equal(await stalePromise, false);
  assert.equal(loadedContexts.length, 1);
  assert.equal(anchorCleared, 1);

  // Empty cursor or no earlier messages returns false without calling loadContext
  oldestId = null;
  assert.equal(await loadEarlier(100), false);
  oldestId = "cursor-2";
  hasMore = false;
  assert.equal(await loadEarlier(100), false);
  assert.equal(requestedTails.length, 2);
});

test("history viewport bridge cleanup only removes its own registered callbacks", () => {
  const win = {};
  const handlersA = {
    getHistoryState: () => buildEnhancementHistoryState({
      sessionId: "a",
      totalTurns: 1,
      hasEarlierMessages: false,
      entryIds: [],
      oldestEntryId: null,
    }),
    loadEarlier: async () => false,
    prepareHistoryCommit: () => {},
  };
  const handlersB = {
    getHistoryState: () => buildEnhancementHistoryState({
      sessionId: "b",
      totalTurns: 2,
      hasEarlierMessages: true,
      entryIds: ["b1"],
      oldestEntryId: "b1",
    }),
    loadEarlier: async () => true,
    prepareHistoryCommit: () => {},
  };

  const cleanupA = registerHistoryViewportBridges(win, handlersA);
  const cleanupB = registerHistoryViewportBridges(win, handlersB);

  // Late cleanup from A must not delete B's active bridges
  cleanupA();
  assert.equal(win.__PI_ENH_GET_HISTORY_STATE__, handlersB.getHistoryState);
  assert.equal(win.__PI_ENH_LOAD_EARLIER__, handlersB.loadEarlier);
  assert.equal(win.__PI_ENH_PREPARE_HISTORY_COMMIT__, handlersB.prepareHistoryCommit);

  cleanupB();
  assert.equal(win.__PI_ENH_GET_HISTORY_STATE__, undefined);
  assert.equal(win.__PI_ENH_LOAD_EARLIER__, undefined);
  assert.equal(win.__PI_ENH_PREPARE_HISTORY_COMMIT__, undefined);
});

test("reload aliases preserve enhancement wrapper, route to active/current pane, and clean up safely", () => {
  const calls = [];
  const win = {
    location: { search: "?session=pane-b" },
  };

  // Simulate enhancement wrapper registered before React mounts
  const enhWrapper = (notify = true) => {
    calls.push({ source: "enh-wrapper", notify });
    return win.__PI_WEB_NATIVE_RELOAD_CURRENT_SESSION__?.(notify);
  };
  win.__PI_ENH_RELOAD_CURRENT_SESSION__ = enhWrapper;

  const cleanupPaneA = registerSessionReloadAliases(win, {
    getSessionId: () => "pane-a",
    isActive: () => false,
    reloadSession: (sid, showLoading, includeState, options) => {
      calls.push({ pane: "A", sid, showLoading, includeState, options });
      return "reloaded-a";
    },
  });

  const cleanupPaneB = registerSessionReloadAliases(win, {
    getSessionId: () => "pane-b",
    isActive: () => true,
    reloadSession: (sid, showLoading, includeState, options) => {
      calls.push({ pane: "B", sid, showLoading, includeState, options });
      return "reloaded-b";
    },
  });

  // Pre-existing enhancement wrapper must never be overwritten
  assert.equal(win.__PI_ENH_RELOAD_CURRENT_SESSION__, enhWrapper);
  assert.equal(typeof win.__PI_WEB_RELOAD_SESSION__, "function");
  assert.equal(typeof win.__PI_WEB_NATIVE_RELOAD_CURRENT_SESSION__, "function");

  // Calling enhancement wrapper delegates to native current session reload -> active pane B
  assert.equal(win.__PI_ENH_RELOAD_CURRENT_SESSION__(false), "reloaded-b");
  assert.deepEqual(calls.slice(-2), [
    { source: "enh-wrapper", notify: false },
    { pane: "B", sid: "pane-b", showLoading: false, includeState: true, options: undefined },
  ]);

  // Specific session reload routes to matching pane A even when pane B is active
  assert.equal(win.__PI_WEB_RELOAD_SESSION__("pane-a", true, true, { force: true }), "reloaded-a");
  assert.deepEqual(calls.at(-1), {
    pane: "A",
    sid: "pane-a",
    showLoading: true,
    includeState: true,
    options: { force: true },
  });

  // Unmounting pane A leaves bridges intact for pane B
  cleanupPaneA();
  assert.equal(win.__PI_WEB_NATIVE_RELOAD_CURRENT_SESSION__(true), "reloaded-b");

  // Unmounting pane B cleans up native bridges but preserves enhancement wrapper
  cleanupPaneB();
  assert.equal(win.__PI_WEB_RELOAD_SESSION__, undefined);
  assert.equal(win.__PI_WEB_NATIVE_RELOAD_CURRENT_SESSION__, undefined);
  assert.equal(win.__PI_ENH_RELOAD_CURRENT_SESSION__, enhWrapper);
});

test("reload aliases install and clean up fallback __PI_ENH_RELOAD_CURRENT_SESSION__ when no wrapper exists", () => {
  const win = {};
  const cleanup = registerSessionReloadAliases(win, {
    getSessionId: () => "solo-session",
    isActive: () => true,
    reloadSession: (sid, showLoading, includeState) => `${sid}:${showLoading}:${includeState}`,
  });

  assert.equal(typeof win.__PI_ENH_RELOAD_CURRENT_SESSION__, "function");
  assert.equal(win.__PI_ENH_RELOAD_CURRENT_SESSION__(true), "solo-session:true:true");

  cleanup();
  assert.equal(win.__PI_ENH_RELOAD_CURRENT_SESSION__, undefined);
});

test("user-message-reconcile marks optimistic messages non-enumerably and falls back safely on errors or disabled state", () => {
  const optimistic = markOptimisticUserMessage({
    role: "user",
    content: "hello",
    timestamp: 123,
  });

  assert.equal(optimistic.__piEnhOptimistic, true);
  assert.equal(Object.keys(optimistic).includes("__piEnhOptimistic"), false);
  assert.equal(JSON.stringify(optimistic).includes("__piEnhOptimistic"), false);

  const serverMsg = { role: "user", content: "hello", timestamp: 124, id: "srv-1" };
  const prev = [optimistic];
  const fallback = () => [...prev.slice(0, -1), serverMsg];

  // 1. Hook active and replaces message
  const winWithHook = {
    __PI_ENH_RECONCILE_USER_MESSAGE__: (list, delivered, opts) => {
      assert.equal(opts.lastFingerprint, "fp-1");
      assert.equal(opts.serverFingerprint, "fp-1");
      assert.equal(list[0].__piEnhOptimistic, true);
      return [delivered];
    },
  };
  assert.deepEqual(
    reconcileDeliveredUserMessage(
      prev,
      serverMsg,
      { lastFingerprint: "fp-1", serverFingerprint: "fp-1", fingerprintFn: () => "fp-1", fallback },
      winWithHook,
    ),
    [serverMsg],
  );

  // 2. Hook throws -> fallback still preserves the message without dropping
  const winThrowing = {
    __PI_ENH_RECONCILE_USER_MESSAGE__: () => {
      throw new Error("boom");
    },
  };
  assert.deepEqual(
    reconcileDeliveredUserMessage(
      prev,
      serverMsg,
      { lastFingerprint: "fp-1", serverFingerprint: "fp-1", fingerprintFn: () => "fp-1", fallback },
      winThrowing,
    ),
    [serverMsg],
  );

  // 3. Hook disabled -> delegates to native fallback
  const winDisabled = {
    __PI_ENH_RECONCILE_USER_MESSAGE__: (_list, _delivered, opts) => opts.fallback(),
  };
  assert.deepEqual(
    reconcileDeliveredUserMessage(
      prev,
      serverMsg,
      { lastFingerprint: "fp-1", serverFingerprint: "fp-1", fingerprintFn: () => "fp-1", fallback },
      winDisabled,
    ),
    [serverMsg],
  );
});

test("ChatWindow and useAgentSession wire the enhancement bridges in source", async () => {
  const chatWindowSource = await readFile(new URL("../components/ChatWindow.tsx", import.meta.url), "utf8");
  const hookSource = await readFile(new URL("../hooks/useAgentSession.ts", import.meta.url), "utf8");

  assert.match(chatWindowSource, /data-pi-enh-native-process="true"/);
  assert.match(chatWindowSource, /registerHistoryViewportBridges/);
  assert.match(chatWindowSource, /subscribeProcessCollapseChange/);
  assert.match(chatWindowSource, /key=\{`process-group-\$\{entryIds\[finalAssistantIdx\] \?\? finalAssistantIdx\}`\}/);
  assert.match(chatWindowSource, /\[messages, messages\.length, scrollContainerRef, visibleCount\]/);

  assert.match(hookSource, /markOptimisticUserMessage\(userMsg\)/);
  assert.match(hookSource, /reconcileDeliveredUserMessage\(prev, delivered,/);
  assert.match(hookSource, /registerSessionReloadAliases\(getEnhancementWindow\(\),/);
  assert.match(hookSource, /before \? \(activeLeafIdRef\.current !== leafId \|\| historyCursorRef\.current !== before\) : false/);
});
