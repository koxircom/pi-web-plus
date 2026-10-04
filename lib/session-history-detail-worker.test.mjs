import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { SessionHistoryPool } = await jiti.import("./session-history-pool.ts");

test("detail reads share the bounded worker queue and carry no AbortSignal over IPC", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "pi-session-detail-worker-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const script = join(dir, "worker.cjs");
  writeFileSync(script, `
    const { parentPort } = require("node:worker_threads");
    parentPort.on("message", (message) => {
      const jsonString = message.type === "querySessionDetail"
        ? JSON.stringify({ type: message.type, options: message.options })
        : "context-page";
      setTimeout(() => parentPort.postMessage({ id: message.id, success: true, jsonString, fingerprint: message.type === "querySessionDetail" ? "file-fingerprint" : null }), 40);
    });
  `);

  const pool = new SessionHistoryPool({
    workerScriptPath: script,
    maxWorkers: 1,
    maxQueueSize: 1,
    requestTimeoutMs: 1000,
    idleTimeoutMs: 1000,
  });
  t.after(() => pool.closeAll());

  const active = pool.queryContext("/same-session.jsonl");
  const controller = new AbortController();
  const queued = pool.querySessionDetail("/same-session.jsonl", {
    sessionId: "same-session",
    sourceId: "disk",
    summaryTree: true,
    deferThinking: true,
    deferToolResultImages: true,
    tail: 25,
    signal: controller.signal,
  });
  assert.equal(pool.getQueueLength(), 1);
  controller.abort();
  await assert.rejects(queued, (error) => error.statusCode === 499);
  assert.equal(await active, "context-page");

  const detailRead = await pool.querySessionDetailResult("/same-session.jsonl", {
    sessionId: "same-session",
    sourceId: "disk",
    summaryTree: true,
    deferThinking: true,
    deferToolResultImages: true,
    tail: 25,
  });
  assert.equal(detailRead.fingerprint, "file-fingerprint");
  const result = JSON.parse(detailRead.jsonString);
  assert.equal(result.type, "querySessionDetail");
  assert.equal(result.options.sessionId, "same-session");
  assert.equal(result.options.summaryTree, true);
  assert.equal(Object.hasOwn(result.options, "signal"), false);

  const activeController = new AbortController();
  const activeRead = pool.querySessionDetail("/same-session.jsonl", {
    sessionId: "same-session",
    sourceId: "disk",
    summaryTree: false,
    deferThinking: false,
    deferToolResultImages: false,
    tail: 50,
    signal: activeController.signal,
  });
  activeController.abort();
  await assert.rejects(activeRead, (error) => error.statusCode === 499);
  assert.equal(pool.getActiveWorkerCount(), 0);
  assert.equal(pool.getMaxWorkers(), 1);
});
