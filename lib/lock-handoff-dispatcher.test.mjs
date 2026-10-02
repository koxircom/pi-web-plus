import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
import {
  createLockHandoffDispatcher,
  startLockHandoffDispatcher,
  stopLockHandoffDispatcher,
  sanitizeSessionId,
  sanitizeError,
} from "./lock-handoff-dispatcher.ts";

test("sanitizeSessionId & sanitizeError properly mask identifiers and UUIDs", () => {
  assert.equal(sanitizeSessionId(""), "未命名会话（标题尚未生成）");
  assert.equal(sanitizeSessionId("short"), "未命名会话（标题尚未生成）");
  assert.equal(sanitizeSessionId("01a0dd3f-2200-716c-bb0f-cd27f4f4ba53"), "未命名会话（标题尚未生成）");

  const errorWithUuid = new Error(
    "Session 01a0dd3f-2200-716c-bb0f-cd27f4f4ba53 failed at 12345678-1234-1234-1234-123456789abc",
  );
  const sanitized = sanitizeError(errorWithUuid);
  assert.ok(!sanitized.includes("01a0dd3f-2200-716c-bb0f-cd27f4f4ba53"));
  assert.ok(!sanitized.includes("01a0dd3f"));
  assert.ok(sanitized.includes("[会话标识]"));
});

test("inactive / no browser cold session is started once and drained", async () => {
  const testPid = 12345;
  const targetSessionId = "01a0dd3f-2200-716c-bb0f-cd27f4f4ba53";
  const fakeSessionPath = "/fake/path/session.jsonl";

  let startSessionCalled = 0;
  let waitUntilReadyCalled = 0;
  let consumerDrained = 0;

  const consumers = new Map();

  const dispatcher = createLockHandoffDispatcher({
    pid: testPid,
    readCandidates: () => [
      {
        sessionId: targetSessionId,
        moduleKey: "module:05",
        messageId: "msg-1",
        ownerPid: testPid,
      },
    ],
    getConsumers: () => consumers,
    resolveSessionPath: async (sid) => {
      assert.equal(sid, targetSessionId);
      return fakeSessionPath;
    },
    startSession: async (sid, sPath, cwd) => {
      startSessionCalled += 1;
      assert.equal(sid, targetSessionId);
      assert.equal(sPath, fakeSessionPath);
      assert.equal(cwd, undefined);

      // Simulate extension registering consumer during session start
      consumers.set(sid, {
        drain: () => {
          consumerDrained += 1;
        },
      });

      return {
        session: {
          waitUntilReady: async () => {
            waitUntilReadyCalled += 1;
          },
        },
      };
    },
  });

  await dispatcher.triggerScan();

  assert.equal(startSessionCalled, 1, "startSession should be called exactly once");
  assert.equal(waitUntilReadyCalled, 1, "waitUntilReady should be called exactly once");
  assert.equal(consumerDrained, 1, "consumer drain should be called");

  await dispatcher.stop();
});

test("multiple modules for the same session are deduplicated to a single startup", async () => {
  const testPid = 12345;
  const targetSessionId = "01a0dd3f-2200-716c-bb0f-cd27f4f4ba53";

  let startSessionCalled = 0;
  let consumerDrained = 0;
  const consumers = new Map();

  const dispatcher = createLockHandoffDispatcher({
    pid: testPid,
    readCandidates: () => [
      {
        sessionId: targetSessionId,
        moduleKey: "module:01",
        messageId: "msg-1",
        ownerPid: testPid,
      },
      {
        sessionId: targetSessionId,
        moduleKey: "module:02",
        messageId: "msg-2",
        ownerPid: testPid,
      },
      {
        sessionId: targetSessionId,
        moduleKey: "module:03",
        messageId: "msg-3",
        ownerPid: testPid,
      },
    ],
    getConsumers: () => consumers,
    resolveSessionPath: async () => "/fake/session.jsonl",
    startSession: async (sid) => {
      startSessionCalled += 1;
      consumers.set(sid, {
        drain: () => {
          consumerDrained += 1;
        },
      });
      return {
        session: {
          waitUntilReady: async () => {},
        },
      };
    },
  });

  await dispatcher.triggerScan();

  assert.equal(startSessionCalled, 1, "Should deduplicate and start session only once");
  assert.equal(consumerDrained, 1, "Consumer should be drained once");

  await dispatcher.stop();
});

test("already live sessions only drain without invoking startSession", async () => {
  const testPid = 12345;
  const targetSessionId = "01a0dd3f-2200-716c-bb0f-cd27f4f4ba53";

  // Case A: Live consumer exists directly
  let startCalled = 0;
  let consumerDrainedA = 0;
  const consumersA = new Map([
    [
      targetSessionId,
      {
        drain: () => {
          consumerDrainedA += 1;
        },
      },
    ],
  ]);

  const dispatcherA = createLockHandoffDispatcher({
    pid: testPid,
    readCandidates: () => [
      {
        sessionId: targetSessionId,
        moduleKey: "module:05",
        ownerPid: testPid,
      },
    ],
    getConsumers: () => consumersA,
    startSession: async () => {
      startCalled += 1;
      return { session: { waitUntilReady: async () => {} } };
    },
  });

  await dispatcherA.triggerScan();
  assert.equal(startCalled, 0, "startSession must not be called when consumer is already active");
  assert.equal(consumerDrainedA, 1, "Active consumer must be drained directly");
  await dispatcherA.stop();

  // Case B: No consumer yet, but RPC session wrapper is alive in memory
  let consumerDrainedB = 0;
  let wrapperReadyCalled = 0;
  const consumersB = new Map();

  const dispatcherB = createLockHandoffDispatcher({
    pid: testPid,
    readCandidates: () => [
      {
        sessionId: targetSessionId,
        moduleKey: "module:05",
        ownerPid: testPid,
      },
    ],
    getConsumers: () => consumersB,
    getRpcSession: (sid) => {
      if (sid === targetSessionId) {
        return {
          isAlive: () => true,
          waitUntilReady: async () => {
            wrapperReadyCalled += 1;
            consumersB.set(sid, {
              drain: () => {
                consumerDrainedB += 1;
              },
            });
          },
        };
      }
      return undefined;
    },
    startSession: async () => {
      startCalled += 1;
      return { session: { waitUntilReady: async () => {} } };
    },
  });

  await dispatcherB.triggerScan();
  assert.equal(startCalled, 0, "startSession must not be called when wrapper is alive");
  assert.equal(wrapperReadyCalled, 1, "waitUntilReady must be awaited on existing wrapper");
  assert.equal(consumerDrainedB, 1, "Consumer must be drained after wrapper is ready");
  await dispatcherB.stop();

  // Case C: Inflight start lock
  let consumerDrainedC = 0;
  let inflightReadyCalled = 0;
  const consumersC = new Map();

  const dispatcherC = createLockHandoffDispatcher({
    pid: testPid,
    readCandidates: () => [
      {
        sessionId: targetSessionId,
        moduleKey: "module:05",
        ownerPid: testPid,
      },
    ],
    getConsumers: () => consumersC,
    getInflightLock: (sid) => {
      if (sid === targetSessionId) {
        return Promise.resolve({
          session: {
            waitUntilReady: async () => {
              inflightReadyCalled += 1;
              consumersC.set(sid, {
                drain: () => {
                  consumerDrainedC += 1;
                },
              });
            },
          },
        });
      }
      return undefined;
    },
    startSession: async () => {
      startCalled += 1;
      return { session: { waitUntilReady: async () => {} } };
    },
  });

  await dispatcherC.triggerScan();
  assert.equal(startCalled, 0, "startSession must not be called when inflight lock exists");
  assert.equal(inflightReadyCalled, 1, "waitUntilReady must be awaited on inflight session");
  assert.equal(consumerDrainedC, 1, "Consumer must be drained after inflight session is ready");
  await dispatcherC.stop();
});

test("candidates with mismatched ownerPid or invalid grant are ignored", async () => {
  const testPid = 12345;
  let startCalled = 0;
  let drained = 0;

  const dispatcher = createLockHandoffDispatcher({
    pid: testPid,
    readCandidates: () => [
      // Different PID
      {
        sessionId: "sid-other-pid",
        moduleKey: "module:01",
        ownerPid: 99999,
      },
      // Empty sessionId
      {
        sessionId: "",
        moduleKey: "module:02",
        ownerPid: testPid,
      },
    ],
    getConsumers: () =>
      new Map([
        [
          "sid-other-pid",
          {
            drain: () => {
              drained += 1;
            },
          },
        ],
      ]),
    startSession: async () => {
      startCalled += 1;
      return { session: { waitUntilReady: async () => {} } };
    },
  });

  await dispatcher.triggerScan();
  assert.equal(startCalled, 0, "Mismatched PID must never be started");
  assert.equal(drained, 0, "Mismatched PID must never be drained");
  await dispatcher.stop();
});

test("pre-execution verification cancels wakeup if grant was released or cancelled", async () => {
  const testPid = 12345;
  const targetSessionId = "01a0dd3f-2200-716c-bb0f-cd27f4f4ba53";
  let readCount = 0;
  let startCalled = 0;

  const dispatcher = createLockHandoffDispatcher({
    pid: testPid,
    readCandidates: () => {
      readCount += 1;
      if (readCount === 1) {
        // Initial scan sees candidate
        return [
          {
            sessionId: targetSessionId,
            moduleKey: "module:01",
            ownerPid: testPid,
          },
        ];
      }
      // Pre-execution verification check sees empty (e.g. cancelled/released by user)
      return [];
    },
    startSession: async () => {
      startCalled += 1;
      return { session: { waitUntilReady: async () => {} } };
    },
  });

  await dispatcher.triggerScan();
  assert.equal(startCalled, 0, "Cancelled grant must not revive or start session");
  await dispatcher.stop();
});

test("bounded backoff retries up to maxRetries on failure and sanitizes logs", async () => {
  const testPid = 12345;
  const targetSessionId = "01a0dd3f-2200-716c-bb0f-cd27f4f4ba53";
  let startAttempts = 0;
  const loggedWarnings = [];

  const backoffSchedule = [10, 20, 50]; // ms for fast testing

  const dispatcher = createLockHandoffDispatcher({
    pid: testPid,
    debounceMs: 5,
    pollIntervalMs: 1000,
    maxRetries: 3,
    backoffScheduleMs: backoffSchedule,
    logger: {
      warn: (msg) => loggedWarnings.push(msg),
    },
    readCandidates: () => [
      {
        sessionId: targetSessionId,
        moduleKey: "module:01",
        messageId: "msg-fail",
        ownerPid: testPid,
      },
    ],
    resolveSessionPath: async () => "/fake/path.jsonl",
    startSession: async () => {
      startAttempts += 1;
      throw new Error(`Failed to wake ${targetSessionId}`);
    },
  });

  // Attempt 1
  await dispatcher.triggerScan();
  assert.equal(startAttempts, 1, "Attempt 1 ran");

  // Immediate rescan during backoff window should be suppressed
  await dispatcher.triggerScan();
  assert.equal(startAttempts, 1, "Rescan during backoff window must not trigger immediate retry");

  // Wait for 1st backoff (10ms)
  await new Promise((r) => setTimeout(r, 15));
  await dispatcher.triggerScan();
  assert.equal(startAttempts, 2, "Attempt 2 ran after 1st backoff");

  // Wait for 2nd backoff (20ms)
  await new Promise((r) => setTimeout(r, 25));
  await dispatcher.triggerScan();
  assert.equal(startAttempts, 3, "Attempt 3 ran after 2nd backoff");

  // Wait for 3rd backoff (50ms)
  await new Promise((r) => setTimeout(r, 55));
  await dispatcher.triggerScan();
  assert.equal(startAttempts, 3, "After 3 failures (maxRetries=3), no more attempts should run");

  // Verify log sanitization: must not leak full UUID
  assert.ok(loggedWarnings.length >= 3);
  for (const warning of loggedWarnings) {
    assert.ok(
      !warning.includes(targetSessionId),
      `Log must not contain full UUID: ${warning}`,
    );
    assert.ok(
      warning.includes("未命名会话（标题尚未生成）"),
      `Log should use a session title placeholder, not an internal ID: ${warning}`,
    );
  }

  await dispatcher.stop();
});

test("cancelSessionWakeups fences a cancelled grant instead of restarting retries", async () => {
  const testPid = 12345;
  const targetSessionId = "01a0dd3f-2200-716c-bb0f-cd27f4f4ba53";
  let attempts = 0;

  const dispatcher = createLockHandoffDispatcher({
    pid: testPid,
    cancelPending: () => {},
    backoffScheduleMs: [1000],
    readCandidates: () => [
      {
        sessionId: targetSessionId,
        moduleKey: "module:01",
        ownerPid: testPid,
      },
    ],
    resolveSessionPath: async () => "/fake/path.jsonl",
    startSession: async () => {
      attempts += 1;
      throw new Error("Boom");
    },
  });

  await dispatcher.triggerScan();
  assert.equal(attempts, 1);

  // Still in backoff, cancel it
  dispatcher.cancelSessionWakeups(targetSessionId);

  // The same cancelled grant must never be retried, even if its persisted snapshot is stale.
  await dispatcher.triggerScan();
  assert.equal(attempts, 1, "cancelSessionWakeups blocks the old grant");

  await dispatcher.stop();
});

test("real temp directory with watch or polling fallback triggers scan and cleans up on stop", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pi-lock-test-"));
  const stateFile = path.join(tmpDir, "pi-web-enhancement-locks.json");

  // Initial state file with empty messages
  await fs.writeFile(
    stateFile,
    JSON.stringify({
      schemaVersion: 1,
      moduleLocks: {},
      messages: [],
    }),
    "utf-8",
  );

  const testPid = process.pid;
  const targetSessionId = "01a0dd3f-2200-716c-bb0f-cd27f4f4ba53";
  let consumerDrained = 0;

  const consumers = new Map([
    [
      targetSessionId,
      {
        drain: () => {
          consumerDrained += 1;
        },
      },
    ],
  ]);

  const dispatcher = createLockHandoffDispatcher({
    stateFile,
    pid: testPid,
    debounceMs: 20,
    pollIntervalMs: 100,
    // Exercise the canonical parser against this fixture, rather than relying
    // on an optional helper under the runner's isolated agent home.
    readCandidates: (opts) => consumerDrained ? [] : createRequire(import.meta.url)(
      "../tests/fixtures/lock-runtime/scripts/pi-web-lock-runtime.cjs"
    ).readWakeCandidates(opts),
    getConsumers: () => consumers,
  });

  dispatcher.start();
  assert.equal(dispatcher.isAlive(), true);

  // Wait brief moment for watcher to bind
  await new Promise((r) => setTimeout(r, 50));

  // Update state file with granted message matching current lock
  await fs.writeFile(
    stateFile,
    JSON.stringify({
      schemaVersion: 1,
      moduleLocks: {
        "module:05": {
          ownerSessionId: targetSessionId,
          ownerPid: testPid,
        },
      },
      messages: [
        {
          messageId: "msg-real-1",
          type: "lock_granted",
          moduleKey: "module:05",
          ownerSessionId: targetSessionId,
          ownerPid: testPid,
          status: "granted",
        },
      ],
    }),
    "utf-8",
  );

  // Wait for debounce (20ms) + dispatch processing
  const startWait = Date.now();
  while (consumerDrained === 0 && Date.now() - startWait < 1500) {
    await new Promise((r) => setTimeout(r, 20));
  }

  assert.equal(consumerDrained, 1, "watch/poll triggered scan and drained the consumer");

  // Clean stop
  await dispatcher.stop();
  assert.equal(dispatcher.isAlive(), false);

  // Idempotent stop
  await dispatcher.stop();
  assert.equal(dispatcher.isAlive(), false);

  // Cleanup temp dir
  await fs.rm(tmpDir, { recursive: true, force: true });
});

test("singleton startLockHandoffDispatcher and stopLockHandoffDispatcher lifecycle", async () => {
  await stopLockHandoffDispatcher();

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "pi-lock-singleton-"));
  const options = { stateFile: path.join(tempDir, "state.json"), readCandidates: () => [], debounceMs: 10 };
  const d1 = startLockHandoffDispatcher(options);
  assert.ok(d1.isAlive());

  // Second call returns existing active instance
  const d2 = startLockHandoffDispatcher(options);
  assert.equal(d1, d2);

  await stopLockHandoffDispatcher();
  assert.equal(d1.isAlive(), false);
  await fs.rm(tempDir, { recursive: true, force: true });
});

for (const phase of ['resolve', 'ready']) {
  test(`cancellation during asynchronous ${phase} prevents late restoration/drain`, async () => {
    const candidate = { sessionId: 'cancelled-cold', moduleKey: 'module:01', messageId: 'grant-race', ownerPid: process.pid };
    let entered = false, release, starts = 0, drains = 0;
    const gate = new Promise(r => { release = r; });
    const consumers = new Map();
    const dispatcher = createLockHandoffDispatcher({
      readCandidates: () => [candidate], getConsumers: () => consumers,
      cancelPending: () => ({ cancelledCount: 1 }),
      resolveSessionPath: async () => {
        if (phase === 'resolve') { entered = true; await gate; }
        return '/isolated-existing-session.jsonl';
      },
      startSession: async () => {
        starts++;
        return { session: { waitUntilReady: async () => {
          entered = true; await gate;
          consumers.set(candidate.sessionId, { drain: () => drains++ });
        } } };
      },
    });
    const scan = dispatcher.triggerScan();
    for (let i = 0; !entered && i < 20; i++) await new Promise(r => setImmediate(r));
    assert.equal(entered, true);
    dispatcher.cancelSessionWakeups(candidate.sessionId);
    release(); await scan;
    await dispatcher.triggerScan(); // stale same grant remains visible: cancellation fence must win.
    assert.equal(starts, phase === 'resolve' ? 0 : 1);
    assert.equal(drains, 0);
    await dispatcher.stop();
  });
}
