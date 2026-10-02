import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createJiti } from 'jiti';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai';
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from '@earendil-works/pi-coding-agent';
import lockExtension from '../tests/fixtures/lock-runtime/extensions/pi-web-enhancement-lock.ts';
import { createLockHandoffDispatcher } from './lock-handoff-dispatcher.ts';
import { hasActiveSessionLivenessProvider } from './session-liveness.ts';
const require = createRequire(import.meta.url);
const locks = require('../tests/fixtures/lock-runtime/scripts/pi-web-enhancement-locks.cjs');
const runtime = require('../tests/fixtures/lock-runtime/scripts/pi-web-lock-runtime.cjs');
const stateStore = require('./enhancement-state-store.cjs');
const wait = async (predicate, timeout = 7000, details = () => ({})) => {
  const start = performance.now();
  while (!predicate() && performance.now() - start < timeout) await new Promise(r => setTimeout(r, 10));
  assert.ok(predicate(), 'bounded SDK acceptance condition not reached: ' + JSON.stringify(details()));
};

test('real SDK + wrapper: pending work survives idle eviction and continues without a browser, exactly once', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lock-sdk-'));
  fs.writeFileSync(path.join(dir, 'models.json'), JSON.stringify({ sessionTagsDefinitions: [], sessionTagMappings: {} }));
  const prior = process.env.PI_WEB_IDLE_TIMEOUT_MS;
  process.env.PI_WEB_IDLE_TIMEOUT_MS = '60';
  const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
  const { AgentSessionWrapper } = await jiti.import('./rpc-manager.ts');
  if (prior === undefined) delete process.env.PI_WEB_IDLE_TIMEOUT_MS; else process.env.PI_WEB_IDLE_TIMEOUT_MS = prior;
  const stateFile = path.join(dir, 'state', 'pi-web-enhancement-locks.json');
  const modulesDir = path.join(dir, 'modules');
  fs.mkdirSync(modulesDir, { recursive: true });
  fs.writeFileSync(path.join(modulesDir, '07-kernel-scheduler-and-observers.js'), '// fixture');
  stateStore.createStateStore({ agentDir: dir }).initializeFromLegacy();
  const opts = { stateFile, modulesDir };
  let wrapper, sdk, dispatcher, turns = 0, errors = [];
  t.after(async () => {
    await dispatcher?.stop();
    await wrapper?.shutdown();
    sdk?.dispose();
    await stateStore.createStateStore({ agentDir: dir }).commit([]);
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const model = { id: 'fixture', name: 'fixture', api: 'openai-completions', provider: 'lock-fixture', baseUrl: 'http://127.0.0.1:1', reasoning: false, input: ['text'], contextWindow: 10000, maxTokens: 100, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
  const modelRuntime = await ModelRuntime.create({ authPath: path.join(dir, 'auth.json'), modelsPath: path.join(dir, 'models.json'), allowNetwork: false });
  modelRuntime.registerProvider('lock-fixture', { api: 'openai-completions', baseUrl: model.baseUrl, apiKey: 'isolated-fixture-only', models: [model] });
  modelRuntime.streamSimple = () => {
    turns++;
    const stream = createAssistantMessageEventStream();
    queueMicrotask(() => stream.push({ type: 'done', reason: 'stop', message: {
      role: 'assistant', content: [{ type: 'text', text: 'continued existing task' }], api: model.api,
      provider: model.provider, model: model.id, timestamp: Date.now(), stopReason: 'stop',
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    } }));
    return stream;
  };
  const loader = new DefaultResourceLoader({ cwd: dir, agentDir: dir, noExtensions: true, noSkills: true,
    noPromptTemplates: true, noThemes: true, noContextFiles: true,
    extensionFactories: [pi => lockExtension(pi, opts)] });
  await loader.reload();
  const manager = SessionManager.create(dir, path.join(dir, 'sessions'));
  manager.appendMessage({ role: 'user', content: 'continue my existing pending task after grant', timestamp: Date.now() });
  ({ session: sdk } = await createAgentSession({ cwd: dir, agentDir: dir, model, modelRuntime,
    tools: [], sessionManager: manager, resourceLoader: loader,
    settingsManager: SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } }) }));
  wrapper = new AgentSessionWrapper(sdk, { suppressCompletionNotifications: true });
  wrapper.onEvent(e => { if (e.type === 'extension_error') errors.push(e); });
  wrapper.start(); wrapper.beginExtensionBinding(); await wrapper.waitUntilReady();
  const id = sdk.sessionId;
  locks.acquireModuleLock({ ...opts, module: 'module:07', sessionId: 'fixture-owner', pid: process.pid });
  locks.acquireModuleLock({ ...opts, module: 'module:07', sessionId: id, pid: process.pid, autoRequest: true });
  assert.ok(hasActiveSessionLivenessProvider({ sessionId: id }));
  // Observe three actual idle callbacks, not just a simulated liveness predicate.
  await new Promise(r => setTimeout(r, 200));
  assert.ok(wrapper.isAlive(), 'waiting SDK wrapper must survive idle timeout without SSE');
  assert.equal(turns, 0);
  dispatcher = createLockHandoffDispatcher({ stateFile, readCandidates: runtime.readWakeCandidates,
    getConsumers: runtime.getSessionConsumers, cancelPending: runtime.cancelSessionWakeups,
    startSession: async () => { throw new Error('resident session must not be duplicated'); } });
  dispatcher.start();
  const start = performance.now();
  locks.releaseModuleLock({ ...opts, module: 'module:07', sessionId: 'fixture-owner' });
  await wait(() => turns === 1 && !sdk.isStreaming);
  await wait(() => locks.peekSessionMessages({ ...opts, sessionId: id }).length === 0);
  for (let i = 0; i < 5; i++) await dispatcher.triggerScan();
  assert.equal(turns, 1, 'repeated watch/poll must not start duplicate model turns');
  assert.deepEqual(errors, []);
  const grantEntries = manager.getBranch().filter(e => e.type === 'custom_message' && e.details?.type === 'lock_granted');
  assert.equal(grantEntries.length, 1, 'grant persisted by actual SDK exactly once');
  console.log(JSON.stringify({ kind: 'sdk-no-browser', autoResumeMs: Math.round(performance.now() - start), turns, idleEvictionSurvived: true, persistedGrantCount: grantEntries.length }));

  // A genuine cold SDK session: only its pre-existing JSONL exists, no watcher/consumer/wrapper.
  await dispatcher.stop(); await wrapper.shutdown(); sdk.dispose();
  const coldManager = SessionManager.create(dir, path.join(dir, 'sessions'));
  coldManager.appendMessage({ role: 'user', content: 'existing task waiting for lock', timestamp: Date.now() });
  fs.mkdirSync(path.dirname(coldManager.getSessionFile()), { recursive: true });
  fs.writeFileSync(coldManager.getSessionFile(), [coldManager.getHeader(), ...coldManager.getEntries()].map(x => JSON.stringify(x)).join('\n') + '\n');
  const coldId = coldManager.getSessionId();
  let restored = 0;
  const watchFailures = [];
  assert.equal(runtime.getSessionConsumers(stateFile).has(coldId), false);
  locks.acquireModuleLock({ ...opts, module: 'module:07', sessionId: 'fixture-owner', pid: process.pid });
  locks.acquireModuleLock({ ...opts, module: 'module:07', sessionId: coldId, pid: process.pid, autoRequest: true });
  dispatcher = createLockHandoffDispatcher({ stateFile, readCandidates: runtime.readWakeCandidates,
    getConsumers: runtime.getSessionConsumers, cancelPending: runtime.cancelSessionWakeups,
    watch: () => { throw Object.assign(new Error('injected ENOSPC'), { code: 'ENOSPC' }); },
    logger: { warn: text => watchFailures.push(text) },
    resolveSessionPath: async target => target === coldId ? coldManager.getSessionFile() : undefined,
    startSession: async (target, file) => {
      assert.equal(target, coldId); restored++;
      const coldLoader = new DefaultResourceLoader({ cwd: dir, agentDir: dir, noExtensions: true, noSkills: true,
        noPromptTemplates: true, noThemes: true, noContextFiles: true,
        extensionFactories: [pi => lockExtension(pi, opts)] });
      await coldLoader.reload();
      ({ session: sdk } = await createAgentSession({ cwd: dir, agentDir: dir, model, modelRuntime,
        tools: [], sessionManager: SessionManager.open(file), resourceLoader: coldLoader,
        settingsManager: SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } }) }));
      wrapper = new AgentSessionWrapper(sdk, { suppressCompletionNotifications: true });
      wrapper.onEvent(e => { if (e.type === 'extension_error') errors.push(e); });
      wrapper.start(); wrapper.beginExtensionBinding();
      return { session: wrapper };
    } });
  dispatcher.start();
  const coldStart = performance.now();
  locks.releaseModuleLock({ ...opts, module: 'module:07', sessionId: 'fixture-owner' });
  await wait(() => turns === 2 && !sdk.isStreaming, 7000, () => ({ turns, restored, errors, streaming: sdk.isStreaming, grants: locks.peekSessionMessages({ ...opts, sessionId: coldId }), branch: sdk.sessionManager.getBranch().map(e => ({ type: e.type, role: e.message?.role, text: e.message?.errorMessage, details: e.details })) }));
  await wait(() => locks.peekSessionMessages({ ...opts, sessionId: coldId }).length === 0);
  for (let i = 0; i < 5; i++) await dispatcher.triggerScan();
  assert.equal(restored, 1); assert.equal(turns, 2);
  assert.equal(watchFailures.length, 1, 'forced watcher failure must use default polling without retry errors');
  assert.match(watchFailures[0], /文件监听不可用/);
  assert.equal(sdk.sessionId, coldId, 'restore original session, never create replacement');
  console.log(JSON.stringify({ kind: 'sdk-cold-no-browser-default-poll-fallback', autoResumeMs: Math.round(performance.now() - coldStart), restored, turnsForColdSession: 1 }));
});

test('real SDK + wrapper: busy grant waits for settled, followUp queue remains empty during busy, continues exactly once', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lock-sdk-busy-'));
  fs.writeFileSync(path.join(dir, 'models.json'), JSON.stringify({ sessionTagsDefinitions: [], sessionTagMappings: {} }));
  const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
  const { AgentSessionWrapper } = await jiti.import('./rpc-manager.ts');
  const stateFile = path.join(dir, 'state', 'pi-web-enhancement-locks.json');
  const modulesDir = path.join(dir, 'modules');
  fs.mkdirSync(modulesDir, { recursive: true });
  fs.writeFileSync(path.join(modulesDir, '07-kernel-scheduler-and-observers.js'), '// fixture');
  stateStore.createStateStore({ agentDir: dir }).initializeFromLegacy();
  const opts = { stateFile, modulesDir };
  let wrapper, sdk, dispatcher, turns = 0, errors = [];
  t.after(async () => {
    try { releaseFirstTurnStream?.(); } catch {}
    await dispatcher?.stop();
    await wrapper?.shutdown();
    sdk?.dispose();
    await stateStore.createStateStore({ agentDir: dir }).commit([]);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  let releaseFirstTurnStream;
  const firstTurnGate = new Promise(resolve => { releaseFirstTurnStream = resolve; });
  let firstTurnStarted = false;

  const model = { id: 'fixture', name: 'fixture', api: 'openai-completions', provider: 'lock-fixture', baseUrl: 'http://127.0.0.1:1', reasoning: false, input: ['text'], contextWindow: 10000, maxTokens: 100, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
  const modelRuntime = await ModelRuntime.create({ authPath: path.join(dir, 'auth.json'), modelsPath: path.join(dir, 'models.json'), allowNetwork: false });
  modelRuntime.registerProvider('lock-fixture', { api: 'openai-completions', baseUrl: model.baseUrl, apiKey: 'isolated-fixture-only', models: [model] });
  modelRuntime.streamSimple = () => {
    turns++;
    const currentTurn = turns;
    const stream = createAssistantMessageEventStream();
    if (currentTurn === 1) {
      firstTurnStarted = true;
      (async () => {
        await firstTurnGate;
        stream.push({ type: 'done', reason: 'stop', message: {
          role: 'assistant', content: [{ type: 'text', text: 'turn 1 completed' }], api: model.api,
          provider: model.provider, model: model.id, timestamp: Date.now(), stopReason: 'stop',
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        } });
      })();
    } else {
      queueMicrotask(() => stream.push({ type: 'done', reason: 'stop', message: {
        role: 'assistant', content: [{ type: 'text', text: 'turn 2 completed after settled' }], api: model.api,
        provider: model.provider, model: model.id, timestamp: Date.now(), stopReason: 'stop',
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      } }));
    }
    return stream;
  };

  const loader = new DefaultResourceLoader({ cwd: dir, agentDir: dir, noExtensions: true, noSkills: true,
    noPromptTemplates: true, noThemes: true, noContextFiles: true,
    extensionFactories: [pi => lockExtension(pi, opts)] });
  await loader.reload();
  const manager = SessionManager.create(dir, path.join(dir, 'sessions'));
  ({ session: sdk } = await createAgentSession({ cwd: dir, agentDir: dir, model, modelRuntime,
    tools: [], sessionManager: manager, resourceLoader: loader,
    settingsManager: SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } }) }));
  wrapper = new AgentSessionWrapper(sdk, { suppressCompletionNotifications: true });
  wrapper.onEvent(e => { if (e.type === 'extension_error') errors.push(e); });
  wrapper.start(); wrapper.beginExtensionBinding(); await wrapper.waitUntilReady();
  const id = sdk.sessionId;

  // Pre-acquire lock for owner, and enqueue request for sdk session
  locks.acquireModuleLock({ ...opts, module: 'module:07', sessionId: 'fixture-owner', pid: process.pid });
  locks.acquireModuleLock({ ...opts, module: 'module:07', sessionId: id, pid: process.pid, autoRequest: true });

  dispatcher = createLockHandoffDispatcher({ stateFile, readCandidates: runtime.readWakeCandidates,
    getConsumers: runtime.getSessionConsumers, cancelPending: runtime.cancelSessionWakeups,
    startSession: async () => { throw new Error('resident session must not be duplicated'); } });
  dispatcher.start();

  // Prompt SDK to enter real busy (streaming) state
  const promptPromise = sdk.prompt('start busy work');
  await wait(() => firstTurnStarted && sdk.isStreaming, 5000);
  assert.equal(sdk.isStreaming, true, 'SDK must be actively streaming');
  assert.equal(turns, 1, 'currently running turn 1');

  // While genuinely busy, release the lock so it is granted to this session
  locks.releaseModuleLock({ ...opts, module: 'module:07', sessionId: 'fixture-owner' });
  await dispatcher.triggerScan();
  // Allow consumer.drain() to process the grant during busy state
  await new Promise(r => setTimeout(r, 100));

  // Critical Invariant: During busy state, grant message must NOT be pushed to followUpQueue
  assert.equal(sdk.isStreaming, true, 'SDK remains busy during prompt stream');
  assert.equal(sdk.getFollowUpMessages().length, 0, 'SDK followUp queue must be empty while busy');
  assert.equal(sdk.pendingMessageCount, 0, 'SDK pendingMessageCount must be 0 while busy');
  assert.equal(turns, 1, 'turn 2 must not start while still busy');

  // Verify grant message is staged in lock state and not yet acked
  const stagedMessages = locks.peekSessionMessages({ ...opts, sessionId: id });
  assert.equal(stagedMessages.length, 1, 'grant message must remain pending in lock message store while busy');
  const grantMessageId = stagedMessages[0].messageId;

  // Release the streaming turn 1, allowing agent to settle
  releaseFirstTurnStream();
  await promptPromise;

  // Wait for turn 2 to be triggered automatically upon agent_settled and complete
  await wait(() => turns === 2 && !sdk.isStreaming, 7000, () => ({ turns, isStreaming: sdk.isStreaming, errors }));

  // Grant message in lock state should now be acked
  await wait(() => locks.peekSessionMessages({ ...opts, sessionId: id }).length === 0, 3000);

  // Trigger extra scans to prove idempotency
  for (let i = 0; i < 5; i++) await dispatcher.triggerScan();
  assert.equal(turns, 2, 'repeated dispatcher scans must not trigger duplicate turns');

  // Verify extension_error collection is empty
  assert.deepEqual(errors, [], 'no extension errors collected during busy grant and settled turn');

  // Verify transcript: original ID/persisted messages not duplicated
  const grantEntries = manager.getBranch().filter(e => e.type === 'custom_message' && e.details?.type === 'lock_granted');
  assert.equal(grantEntries.length, 1, 'grant entry persisted exactly once in branch');
  assert.equal(grantEntries[0].details?.messageId, grantMessageId, 'persisted grant retains original message ID');

  console.log(JSON.stringify({
    kind: 'sdk-busy-grant-settled-continue',
    turns,
    busyFollowUpQueueEmpty: true,
    persistedGrantCount: grantEntries.length,
    originalMessageIdPreserved: true,
    extensionErrorsCount: errors.length
  }));
});
