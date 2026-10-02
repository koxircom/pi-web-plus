import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const {
  handleSessionContextRequest,
  HISTORY_CACHE_PROTOCOL_HEADER,
  HISTORY_FINGERPRINT_HEADER,
  HISTORY_CACHE_PROTOCOL_VERSION,
} = await jiti.import("@/lib/session-context-service");

function buildChainEntries(count) {
  const entries = [];
  for (let i = 0; i < count; i++) {
    entries.push({
      id: `e${i}`,
      parentId: i === 0 ? null : `e${i - 1}`,
      type: "message",
      timestamp: new Date(1000 + i * 1000).toISOString(),
      message: { role: i % 2 === 0 ? "user" : "assistant", content: `msg_${i}` },
    });
  }
  return entries;
}

test("context service: a missing live cursor is 404, never a certified empty terminal page", async () => {
  const deps = { getRpc: () => ({ isAlive: () => true, inner: { sessionManager: {
    getEntries: () => buildChainEntries(3), getLeafId: () => "e2",
  } } }) };
  for (const method of ["GET", "HEAD"]) {
    const res = await handleSessionContextRequest(new Request("http://localhost/api/sessions/s/context?before=missing", {method}), {id:"s"}, deps);
    assert.equal(res.status, 404);
    assert.equal(res.headers.get(HISTORY_FINGERPRINT_HEADER), null);
    if (method === "HEAD") assert.equal(await res.text(), "");
  }
});

test("context service: HEAD has zero body and identical fingerprint to GET", async () => {
  const entries = buildChainEntries(20);
  const mockDeps = {
    getRpc: () => ({
      isAlive: () => true,
      inner: {
        sessionManager: {
          getEntries: () => entries,
          getLeafId: () => "e19",
        },
      },
    }),
    resolvePath: async () => {
      throw new Error("Live context must not access disk");
    },
  };

  const getReq = new Request("http://localhost/api/sessions/s1/context?before=e15&tail=5", {
    method: "GET",
  });
  const headReq = new Request("http://localhost/api/sessions/s1/context?before=e15&tail=5", {
    method: "HEAD",
  });

  const getRes = await handleSessionContextRequest(getReq, { id: "s1" }, mockDeps);
  const headRes = await handleSessionContextRequest(headReq, { id: "s1" }, mockDeps);

  assert.equal(getRes.status, 200);
  assert.equal(headRes.status, 200);

  // Protocols and fingerprints match
  assert.equal(getRes.headers.get(HISTORY_CACHE_PROTOCOL_HEADER), HISTORY_CACHE_PROTOCOL_VERSION);
  assert.equal(headRes.headers.get(HISTORY_CACHE_PROTOCOL_HEADER), HISTORY_CACHE_PROTOCOL_VERSION);

  const getFp = getRes.headers.get(HISTORY_FINGERPRINT_HEADER);
  const headFp = headRes.headers.get(HISTORY_FINGERPRINT_HEADER);
  assert.ok(getFp && getFp.length === 64, "SHA-256 hex string expected");
  assert.equal(getFp, headFp, "HEAD and GET fingerprints must be strictly identical");

  // Zero body on HEAD vs full JSON on GET
  const headBody = await headRes.text();
  assert.equal(headBody, "", "HEAD must have zero body");

  const getBody = await getRes.json();
  assert.ok(Array.isArray(getBody.context.messages));
  assert.equal(getBody.context.messages.length, 5);
  assert.deepEqual(getBody.context.entryIds, ["e10", "e11", "e12", "e13", "e14"]);
});

test("context service: appending tail messages preserves stable ancestor page fingerprint", async () => {
  let entries = buildChainEntries(10); // e0 .. e9
  const mockDeps = {
    getRpc: () => ({
      isAlive: () => true,
      inner: {
        sessionManager: {
          getEntries: () => entries,
          getLeafId: () => entries[entries.length - 1].id,
        },
      },
    }),
  };

  // Request page before e8
  const req1 = new Request("http://localhost/api/sessions/s1/context?before=e8&tail=4", { method: "HEAD" });
  const res1 = await handleSessionContextRequest(req1, { id: "s1" }, mockDeps);
  const fp1 = res1.headers.get(HISTORY_FINGERPRINT_HEADER);

  // Append new tail messages: e10 .. e15 to the active branch
  entries = buildChainEntries(16);

  // Re-request same ancestor page before e8
  const req2 = new Request("http://localhost/api/sessions/s1/context?before=e8&tail=4", { method: "HEAD" });
  const res2 = await handleSessionContextRequest(req2, { id: "s1" }, mockDeps);
  const fp2 = res2.headers.get(HISTORY_FINGERPRINT_HEADER);

  assert.equal(fp1, fp2, "Fingerprint of stable ancestor page must remain unchanged after appending new tail");
});

test("context service: isolates parameters and branches", async () => {
  const entries = buildChainEntries(20);
  const mockDeps = {
    getRpc: () => ({
      isAlive: () => true,
      inner: {
        sessionManager: {
          getEntries: () => entries,
          getLeafId: () => "e19",
        },
      },
    }),
  };

  // Query A
  const resA = await handleSessionContextRequest(
    new Request("http://localhost/api/sessions/s1/context?before=e15&tail=5"),
    { id: "s1" },
    mockDeps,
  );
  // Different tail
  const resDiffTail = await handleSessionContextRequest(
    new Request("http://localhost/api/sessions/s1/context?before=e15&tail=10"),
    { id: "s1" },
    mockDeps,
  );
  // Different before
  const resDiffBefore = await handleSessionContextRequest(
    new Request("http://localhost/api/sessions/s1/context?before=e10&tail=5"),
    { id: "s1" },
    mockDeps,
  );

  const fpA = resA.headers.get(HISTORY_FINGERPRINT_HEADER);
  const fpDiffTail = resDiffTail.headers.get(HISTORY_FINGERPRINT_HEADER);
  const fpDiffBefore = resDiffBefore.headers.get(HISTORY_FINGERPRINT_HEADER);

  assert.notEqual(fpA, fpDiffTail);
  assert.notEqual(fpA, fpDiffBefore);
});

test("context service: retains 404, 499 errors without cache headers", async () => {
  // 404 Session not found
  const notFoundRes = await handleSessionContextRequest(
    new Request("http://localhost/api/sessions/unknown/context"),
    { id: "unknown" },
    {
      getRpc: () => undefined,
      resolvePath: async () => null,
    },
  );
  assert.equal(notFoundRes.status, 404);
  assert.equal(notFoundRes.headers.get(HISTORY_FINGERPRINT_HEADER), null);

  // 499 Aborted
  const controller = new AbortController();
  controller.abort();
  const abortedRes = await handleSessionContextRequest(
    new Request("http://localhost/api/sessions/s1/context", { signal: controller.signal }),
    { id: "s1" },
  );
  assert.equal(abortedRes.status, 499);
  assert.equal(abortedRes.headers.get(HISTORY_FINGERPRINT_HEADER), null);
});

test("context service: oversized pages stay readable but are not hashed/cacheable", async () => {
  const json = JSON.stringify({ context: { messages: [{role: "user", content: "x".repeat(16 * 1024 * 1024)}], entryIds: ["a"], oldestEntryId: "a", hasMore: false }, tail: 50, before: "b" });
  const deps = { getRpc: () => undefined, resolvePath: async () => "/fixture", pool: { queryContext: async () => json } };
  for (const method of ["GET", "HEAD"]) {
    const res = await handleSessionContextRequest(new Request("http://localhost/api/sessions/s/context?before=b", {method}), {id: "s"}, deps);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get(HISTORY_FINGERPRINT_HEADER), null);
    assert.equal(await res.text(), method === "HEAD" ? "" : json);
  }
});

test("context service: abort after projection suppresses cache headers", async () => {
  const controller = new AbortController();
  const res = await handleSessionContextRequest(new Request("http://localhost/api/sessions/s/context?before=b", {method: "HEAD", signal: controller.signal}), {id: "s"}, {
    getRpc: () => undefined, resolvePath: async () => "/fixture",
    pool: {queryContext: async () => {controller.abort(); return "{}";}},
  });
  assert.equal(res.status, 499);
  assert.equal(res.headers.get(HISTORY_FINGERPRINT_HEADER), null);
  assert.equal(await res.text(), "");
});

test("context service: HEAD error (404, 409, 503) has zero body, Cache-Control, and preserves Retry-After", async () => {
  // 1. 404 on HEAD has zero body and Cache-Control: private, no-store
  const headNotFound = await handleSessionContextRequest(
    new Request("http://localhost/api/sessions/unknown/context", { method: "HEAD" }),
    { id: "unknown" },
    {
      getRpc: () => undefined,
      resolvePath: async () => null,
    },
  );
  assert.equal(headNotFound.status, 404);
  assert.equal(await headNotFound.text(), "", "HEAD 404 must have zero body");
  assert.equal(headNotFound.headers.get("Cache-Control"), "private, no-store");

  // 2. 503 error on HEAD has zero body, Retry-After header, and Cache-Control
  const head503 = await handleSessionContextRequest(
    new Request("http://localhost/api/sessions/s1/context", { method: "HEAD" }),
    { id: "s1" },
    {
      getRpc: () => {
        const err = new Error("Service Unavailable");
        err.statusCode = 503;
        throw err;
      },
    },
  );
  assert.equal(head503.status, 503);
  assert.equal(await head503.text(), "", "HEAD 503 must have zero body");
  assert.equal(head503.headers.get("Retry-After"), "1");
  assert.equal(head503.headers.get("Cache-Control"), "private, no-store");

  // 3. 503 on GET has Retry-After and Cache-Control
  const get503 = await handleSessionContextRequest(
    new Request("http://localhost/api/sessions/s1/context", { method: "GET" }),
    { id: "s1" },
    {
      getRpc: () => {
        const err = new Error("Service Unavailable");
        err.statusCode = 503;
        throw err;
      },
    },
  );
  assert.equal(get503.status, 503);
  assert.equal(get503.headers.get("Retry-After"), "1");
  assert.equal(get503.headers.get("Cache-Control"), "private, no-store");
});
