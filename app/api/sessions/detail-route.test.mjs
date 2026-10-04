// Static + behavior coverage for the session detail API's tail bound (the #509/#555
// transfer fix). The route delegates disk projection to the bounded history Worker
// and shares the snapshot helper with the active-writer fast path.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createJiti } from "jiti";

const routeSrc = await readFileSync(new URL("./[id]/route.ts", import.meta.url), "utf8");
const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const { buildSessionContext } = await jiti.import("@/lib/session-reader");

test("detail route parses ?tail and delegates projection to the snapshot Worker", () => {
  assert.match(routeSrc, /const rawTail = Number\(searchParams\.get\("tail"\)\)/);
  assert.match(routeSrc, /Math\.min\(rawTail, 1000\)/);
  assert.match(routeSrc, /Number\.isFinite\(rawTail\) && rawTail > 0 \? Math\.min\(rawTail, 1000\) : 50/);
  assert.match(routeSrc, /pool\.querySessionDetailResult\(actualFilePath,\s*\{/);
  assert.match(routeSrc, /buildSessionDetailSnapshot\(liveRpc\.inner\.sessionManager/);
  assert.match(routeSrc, /firstMessage: snapshot\.firstMessage/);
  assert.match(routeSrc, /messageCount: stats\.totalMessages/);
  assert.match(routeSrc, /stats,/);
  assert.match(routeSrc, /totalActiveMs,/);
  assert.doesNotMatch(routeSrc, /computeSessionStats|computeSessionTotalActiveMs|buildSessionContext\(/);
});

test("detail route rechecks its read source after asynchronous project info lookup", () => {
  const attachIndex = routeSrc.indexOf("attachSessionProjectInfo([{");
  const finalCheckIndex = routeSrc.indexOf("const finalRpc = getRpcSession(id)", attachIndex);
  assert.ok(attachIndex >= 0);
  assert.ok(finalCheckIndex > attachIndex);
  const finalCheck = routeSrc.slice(finalCheckIndex);
  assert.match(finalCheck, /finalRpc !== liveRpc/);
  assert.match(finalCheck, /isSessionReadStable\(liveWrapper, finalRpc\)/);
  assert.match(finalCheck, /getSessionFileFingerprint\(actualFilePath\) !== diskFingerprint/);
});

test("detail route bounds history to the tail window (default 50 over 5000 entries)", () => {
  const entries = [];
  for (let i = 0; i < 5000; i++) {
    entries.push({
      id: `e${i}`,
      parentId: i === 0 ? null : `e${i - 1}`,
      type: "message",
      timestamp: new Date(1000 + i * 1000).toISOString(),
      message: { role: i % 2 === 0 ? "user" : "assistant", content: `m${i}` },
    });
  }
  const ctx = buildSessionContext(entries, "e4999", { tail: 50 });
  assert.equal(ctx.messages.length, 50);
  // The transferred window is the tail, not the full 5000-entry forest.
  assert.equal(ctx.entryIds[0], "e4950");
  assert.equal(ctx.entryIds[ctx.entryIds.length - 1], "e4999");
});

test("detail route with an out-of-range tail still caps at 1000", () => {
  const entries = [];
  for (let i = 0; i < 5000; i++) {
    entries.push({ id: `e${i}`, parentId: i === 0 ? null : `e${i - 1}`, type: "message", timestamp: new Date(1000 + i * 1000).toISOString(), message: { role: "user", content: `m${i}` } });
  }
  const ctx = buildSessionContext(entries, "e4999", { tail: 5000 });
  assert.equal(ctx.messages.length, 5000);
});
