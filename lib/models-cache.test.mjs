import assert from "node:assert/strict";
import test from "node:test";

import {
  invalidateModelsCache,
  loadModelsWithCache,
  withModelRuntimeError,
  withSafeModelLoadFailure,
} from "./models-cache.ts";

function modelsData(id) {
  return {
    models: { [`provider:${id}`]: id },
    modelList: [{ id, name: id, provider: "provider" }],
    defaultModel: null,
    defaultThinkingLevel: null,
    thinkingLevels: {},
    thinkingLevelMaps: {},
  };
}

test("caches model data independently for each cwd", async () => {
  invalidateModelsCache();
  let firstLoads = 0;
  let secondLoads = 0;

  const first = await loadModelsWithCache("/first", async () => {
    firstLoads += 1;
    return modelsData("first");
  });
  await loadModelsWithCache("/second", async () => {
    secondLoads += 1;
    return modelsData("second");
  });
  const firstAgain = await loadModelsWithCache("/first", async () => {
    firstLoads += 1;
    return modelsData("replacement");
  });

  assert.deepEqual(firstAgain, first);
  assert.equal(firstLoads, 1);
  assert.equal(secondLoads, 1);
});

test("shares one loader between concurrent requests for the same cwd", async () => {
  invalidateModelsCache();
  let loads = 0;
  let finishLoad;
  const loader = () => {
    loads += 1;
    return new Promise((resolve) => { finishLoad = resolve; });
  };

  const first = loadModelsWithCache("/shared", loader);
  const second = loadModelsWithCache("/shared", loader);
  await Promise.resolve();

  assert.equal(loads, 1);
  finishLoad(modelsData("shared"));
  assert.deepEqual(await second, await first);
});

test("does not cache a stale load that finishes after invalidation", async () => {
  invalidateModelsCache();
  let finishOldLoad;
  const oldLoad = loadModelsWithCache("/stale", () => new Promise((resolve) => { finishOldLoad = resolve; }));
  await Promise.resolve();

  invalidateModelsCache();
  let freshLoads = 0;
  const fresh = await loadModelsWithCache("/stale", async () => {
    freshLoads += 1;
    return modelsData("fresh");
  });
  finishOldLoad(modelsData("stale"));
  await oldLoad;

  const cached = await loadModelsWithCache("/stale", async () => {
    freshLoads += 1;
    return modelsData("unexpected");
  });
  assert.deepEqual(cached, fresh);
  assert.equal(freshLoads, 1);
});

test("retries after a model load fails", async () => {
  invalidateModelsCache();
  await assert.rejects(
    loadModelsWithCache("/failed", async () => { throw new Error("load failed"); }),
    /load failed/,
  );

  let retries = 0;
  const fresh = await loadModelsWithCache("/failed", async () => {
    retries += 1;
    return modelsData("fresh");
  });
  assert.deepEqual(fresh, modelsData("fresh"));
  assert.equal(retries, 1);
});

test("adds runtime errors without discarding available models", () => {
  const data = modelsData("builtin");
  const result = withModelRuntimeError(data, "Invalid models.json schema");

  assert.deepEqual(result, {
    ...data,
    modelError: "Invalid models.json schema",
  });
});

test("uses a safe error for unexpected model load failures", () => {
  const data = {
    ...modelsData("builtin"),
    modelError: "Failed to load /Users/example/.pi/agent/models.json with token secret",
  };
  const result = withSafeModelLoadFailure(data);

  assert.deepEqual(result, {
    ...data,
    modelError: "暂时无法获取模型，请稍后重试。",
  });
});

 test("does not retain error catalogs for the success TTL", async () => {
  invalidateModelsCache();
  await loadModelsWithCache("/transient", async () => withModelRuntimeError(modelsData("old"), "temporary"));
  const recovered = await loadModelsWithCache("/transient", async () => modelsData("fresh"));
  assert.deepEqual(recovered, modelsData("fresh"));
});

function expire(cwd, milliseconds = 1) {
  globalThis.__piModelsCacheState.entries.get(cwd).expiresAt = Date.now() - milliseconds;
}
function tick() { return new Promise(resolve => setImmediate(resolve)); }

test("expired catalog returns immediately and shares a single background refresh", async () => {
  invalidateModelsCache();
  const old = await loadModelsWithCache('/background', async () => modelsData('old'));
  expire('/background');
  let finish, calls = 0;
  const loader = () => { calls++; return new Promise(resolve => { finish = resolve; }); };
  assert.deepEqual(await loadModelsWithCache('/background', loader), old);
  assert.deepEqual(await loadModelsWithCache('/background', loader), old);
  assert.equal(calls, 1);
  finish(modelsData('new'));
  await tick();
  assert.deepEqual(await loadModelsWithCache('/background', loader), modelsData('new'));
  assert.equal(calls, 1);
});

test("background throws and error catalogs preserve success with retry backoff", async () => {
  for (const outcome of ['throw', 'error']) {
    invalidateModelsCache();
    const old = await loadModelsWithCache('/failure', async () => modelsData('old'));
    expire('/failure');
    let calls = 0;
    const loader = async () => { calls++; if (outcome === 'throw') throw Error('private path/token'); return withModelRuntimeError(modelsData('bad'), 'invalid'); };
    assert.deepEqual(await loadModelsWithCache('/failure', loader), old);
    await tick();
    assert.deepEqual(await loadModelsWithCache('/failure', loader), old);
    assert.equal(calls, 1);
    globalThis.__piModelsCacheState.entries.get('/failure').retryAfter = 0;
    await loadModelsWithCache('/failure', async () => modelsData('recovered'));
    await tick();
    assert.deepEqual(await loadModelsWithCache('/failure', loader), modelsData('recovered'));
  }
});

test("hard stale limit blocks until a fresh load, even during failure backoff", async () => {
  invalidateModelsCache();
  await loadModelsWithCache('/limit', async () => modelsData('old'));
  expire('/limit', 300_001);
  globalThis.__piModelsCacheState.entries.get('/limit').retryAfter = Date.now() + 10_000;
  assert.deepEqual(await loadModelsWithCache('/limit', async () => modelsData('fresh')), modelsData('fresh'));
});

test("explicit invalidation prevents background resurrection after a settings change", async () => {
  invalidateModelsCache();
  await loadModelsWithCache('/generation', async () => modelsData('old'));
  expire('/generation');
  let finish;
  await loadModelsWithCache('/generation', () => new Promise(resolve => { finish = resolve; }));
  invalidateModelsCache();
  const fresh = await loadModelsWithCache('/generation', async () => modelsData('changed'));
  finish(modelsData('obsolete'));
  await tick();
  assert.deepEqual(await loadModelsWithCache('/generation', async () => modelsData('unexpected')), fresh);
});

test("grace-period cache remains bounded and replacing a cwd does not evict another", async () => {
  invalidateModelsCache();
  for (let i=0;i<32;i++) await loadModelsWithCache('/cwd'+i, async () => modelsData(String(i)));
  expire('/cwd5');
  await loadModelsWithCache('/cwd5', async () => modelsData('replacement'));
  await tick();
  assert.equal(globalThis.__piModelsCacheState.entries.size,32);
  assert(globalThis.__piModelsCacheState.entries.has('/cwd0'));
  await loadModelsWithCache('/cwd32', async () => modelsData('32'));
  assert.equal(globalThis.__piModelsCacheState.entries.size,32);
  assert(!globalThis.__piModelsCacheState.entries.has('/cwd0'));
});
