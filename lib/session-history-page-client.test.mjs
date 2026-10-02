import assert from "node:assert/strict";
import test from "node:test";
import {
  fetchHistoryPageContext,
  deleteSessionHistoryPages,
  clearAllSessionHistoryPages,
} from "./session-history-page-client.ts";
import {
  HISTORY_CACHE_PROTOCOL_HEADER,
  HISTORY_FINGERPRINT_HEADER,
  HISTORY_CACHE_PROTOCOL_VERSION,
} from "./session-history-page-cache.ts";

test("versioned responses require exact tail and boundary binding", async () => {
  for (const fields of [{tail: 80, before: "b"}, {tail: 50, before: null}, {before: "b"}]) {
    clearAllSessionHistoryPages();
    await assert.rejects(fetchHistoryPageContext({sessionId: "binding", before: "b", fetchFn: async () => new Response(JSON.stringify({context: {messages: [], entryIds: [], oldestEntryId: null, hasMore: false}, ...fields}), {headers: {[HISTORY_CACHE_PROTOCOL_HEADER]: "1", [HISTORY_FINGERPRINT_HEADER]: "fp"}})}), /mismatch/);
  }
});

test("client miss path fetches GET and saves valid page to cache", async () => {
  clearAllSessionHistoryPages();

  const sid = "session_test_miss";
  const before = "entry_100";
  const expectedContext = {
    messages: [{ role: "user", content: "hello world" }],
    entryIds: ["entry_99"],
    oldestEntryId: "entry_99",
    hasMore: true,
  };

  const requests = [];
  const mockFetch = async (url, options = {}) => {
    requests.push({ url, method: options.method || "GET" });
    return new Response(JSON.stringify({ context: expectedContext, tail: 50, before }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        [HISTORY_CACHE_PROTOCOL_HEADER]: HISTORY_CACHE_PROTOCOL_VERSION,
        [HISTORY_FINGERPRINT_HEADER]: "fingerprint_123",
      },
    });
  };

  const result = await fetchHistoryPageContext({
    sessionId: sid,
    before,
    fetchFn: mockFetch,
  });

  assert.ok(result);
  assert.equal(result.fromCache, false);
  assert.deepEqual(result.context, expectedContext);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].method, "GET");

  // Subsequent call: Cache Hit with matching fingerprint triggers HEAD only and ZERO GET
  requests.length = 0;
  const hitMockFetch = async (url, options = {}) => {
    requests.push({ url, method: options.method || "GET" });
    if (options.method === "HEAD") {
      return new Response(null, {
        status: 200,
        headers: {
          [HISTORY_CACHE_PROTOCOL_HEADER]: HISTORY_CACHE_PROTOCOL_VERSION,
          [HISTORY_FINGERPRINT_HEADER]: "fingerprint_123",
        },
      });
    }
    throw new Error("Unexpected GET on fingerprint hit");
  };

  const hitResult = await fetchHistoryPageContext({
    sessionId: sid,
    before,
    fetchFn: hitMockFetch,
  });

  assert.ok(hitResult);
  assert.equal(hitResult.fromCache, true);
  assert.deepEqual(hitResult.context, expectedContext);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].method, "HEAD");
});

test("client detects fingerprint mismatch and falls back to GET to update cache", async () => {
  clearAllSessionHistoryPages();

  const sid = "session_test_mismatch";
  const before = "entry_200";
  const oldContext = {
    messages: [{ role: "user", content: "old message" }],
    entryIds: ["entry_199"],
    oldestEntryId: "entry_199",
    hasMore: true,
  };
  const updatedContext = {
    messages: [{ role: "user", content: "updated message" }],
    entryIds: ["entry_199"],
    oldestEntryId: "entry_199",
    hasMore: true,
  };

  // 1. Prime cache with old fingerprint
  await fetchHistoryPageContext({
    sessionId: sid,
    before,
    fetchFn: async () =>
      new Response(JSON.stringify({ context: oldContext, tail: 50, before }), {
        status: 200,
        headers: {
          [HISTORY_CACHE_PROTOCOL_HEADER]: HISTORY_CACHE_PROTOCOL_VERSION,
          [HISTORY_FINGERPRINT_HEADER]: "fp_old",
        },
      }),
  });

  // 2. Server reports new fingerprint on HEAD -> client must GET new body
  const calls = [];
  const result = await fetchHistoryPageContext({
    sessionId: sid,
    before,
    fetchFn: async (url, options = {}) => {
      const method = options.method || "GET";
      calls.push(method);
      if (method === "HEAD") {
        return new Response(null, {
          status: 200,
          headers: {
            [HISTORY_CACHE_PROTOCOL_HEADER]: HISTORY_CACHE_PROTOCOL_VERSION,
            [HISTORY_FINGERPRINT_HEADER]: "fp_new",
          },
        });
      }
      return new Response(JSON.stringify({ context: updatedContext, tail: 50, before }), {
        status: 200,
        headers: {
          [HISTORY_CACHE_PROTOCOL_HEADER]: HISTORY_CACHE_PROTOCOL_VERSION,
          [HISTORY_FINGERPRINT_HEADER]: "fp_new",
        },
      });
    },
  });

  assert.ok(result);
  assert.equal(result.fromCache, false);
  assert.deepEqual(result.context, updatedContext);
  assert.deepEqual(calls, ["HEAD", "GET"]);
});

test("client safely falls back to GET when server has no protocol header", async () => {
  clearAllSessionHistoryPages();

  const sid = "session_test_legacy_server";
  const before = "entry_300";
  const context = {
    messages: [{ role: "user", content: "msg" }],
    entryIds: ["entry_299"],
    oldestEntryId: "entry_299",
    hasMore: false,
  };

  // Prime cache
  await fetchHistoryPageContext({
    sessionId: sid,
    before,
    fetchFn: async () =>
      new Response(JSON.stringify({ context, tail: 50, before }), {
        status: 200,
        headers: {
          [HISTORY_CACHE_PROTOCOL_HEADER]: HISTORY_CACHE_PROTOCOL_VERSION,
          [HISTORY_FINGERPRINT_HEADER]: "fp_initial",
        },
      }),
  });

  // Legacy server responds to HEAD without protocol headers
  const calls = [];
  const result = await fetchHistoryPageContext({
    sessionId: sid,
    before,
    fetchFn: async (url, options = {}) => {
      const method = options.method || "GET";
      calls.push(method);
      if (method === "HEAD") {
        return new Response(null, { status: 200 }); // No X-Pi-History-* headers!
      }
      return new Response(JSON.stringify({ context, tail: 50, before }), { status: 200 });
    },
  });

  assert.ok(result);
  assert.equal(result.fromCache, false);
  assert.deepEqual(calls, ["HEAD", "GET"]);
});

test("auth failure (401/403/404) evicts cache and throws without resurrecting stale data", async () => {
  clearAllSessionHistoryPages();

  const sid = "session_auth_eviction";
  const before = "entry_400";
  const context = {
    messages: [{ role: "user", content: "confidential" }],
    entryIds: ["entry_399"],
    oldestEntryId: "entry_399",
    hasMore: false,
  };

  // Prime cache
  await fetchHistoryPageContext({
    sessionId: sid,
    before,
    fetchFn: async () =>
      new Response(JSON.stringify({ context, tail: 50, before }), {
        status: 200,
        headers: {
          [HISTORY_CACHE_PROTOCOL_HEADER]: HISTORY_CACHE_PROTOCOL_VERSION,
          [HISTORY_FINGERPRINT_HEADER]: "fp_secret",
        },
      }),
  });

  // Next HEAD returns 401
  await assert.rejects(
    async () => {
      await fetchHistoryPageContext({
        sessionId: sid,
        before,
        fetchFn: async (url, options = {}) => {
          if (options.method === "HEAD") {
            return new Response(null, { status: 401 });
          }
          return new Response(null, { status: 401 });
        },
      });
    },
    /HTTP 401/,
  );

  // Subsequent call should have an empty cache (HEAD not attempted first if cache was cleared)
  const nextCalls = [];
  await fetchHistoryPageContext({
    sessionId: sid,
    before,
    fetchFn: async (url, options = {}) => {
      nextCalls.push(options.method || "GET");
      return new Response(JSON.stringify({ context, tail: 50, before }), {
        status: 200,
        headers: {
          [HISTORY_CACHE_PROTOCOL_HEADER]: HISTORY_CACHE_PROTOCOL_VERSION,
          [HISTORY_FINGERPRINT_HEADER]: "fp_new",
        },
      });
    },
  });

  assert.deepEqual(nextCalls, ["GET"], "Evicted cache must execute direct GET without previous HEAD");
});

test("signal abort and isCurrent cancellation discard results without corrupting cache", async () => {
  clearAllSessionHistoryPages();

  const sid = "session_abort";
  const before = "entry_500";
  const controller = new AbortController();
  controller.abort();

  const resultAborted = await fetchHistoryPageContext({
    sessionId: sid,
    before,
    signal: controller.signal,
    fetchFn: async () => {
      throw new Error("Should not be called when already aborted");
    },
  });
  assert.equal(resultAborted, null);

  // isCurrent returns false after async step
  let step = 0;
  const resultNotCurrent = await fetchHistoryPageContext({
    sessionId: sid,
    before,
    isCurrent: () => step === 0, // only true at start
    fetchFn: async () => {
      step = 1; // invalidated during await
      return new Response(
        JSON.stringify({
          context: { messages: [], entryIds: [], oldestEntryId: null, hasMore: false },
          tail: 50,
          before,
        }),
        {
          status: 200,
          headers: {
            [HISTORY_CACHE_PROTOCOL_HEADER]: HISTORY_CACHE_PROTOCOL_VERSION,
            [HISTORY_FINGERPRINT_HEADER]: "fp_discard",
          },
        },
      );
    },
  });
  assert.equal(resultNotCurrent, null, "Late arrival must return null and not apply");
});

test("client mid-flight clear/disable prevents late resurrection and writes", async () => {
  clearAllSessionHistoryPages();

  const sid = "session_mid_flight";
  const before = "entry_600";
  const context = {
    messages: [{ role: "user", content: "test" }],
    entryIds: ["entry_599"],
    oldestEntryId: "entry_599",
    hasMore: false,
  };

  // 1. Late arrival after clear: clearAll occurs during GET
  await fetchHistoryPageContext({
    sessionId: sid,
    before,
    fetchFn: async () => {
      // Clear occurs mid-flight
      clearAllSessionHistoryPages();
      return new Response(JSON.stringify({ context, tail: 50, before }), {
        status: 200,
        headers: {
          [HISTORY_CACHE_PROTOCOL_HEADER]: HISTORY_CACHE_PROTOCOL_VERSION,
          [HISTORY_FINGERPRINT_HEADER]: "fp_late",
        },
      });
    },
  });

  // Since clear occurred mid-flight, late response must NOT resurrect the cache
  const callsAfterClear = [];
  await fetchHistoryPageContext({
    sessionId: sid,
    before,
    fetchFn: async (url, options = {}) => {
      callsAfterClear.push(options.method || "GET");
      return new Response(JSON.stringify({ context, tail: 50, before }), {
        status: 200,
      });
    },
  });
  assert.deepEqual(callsAfterClear, ["GET"], "Mid-flight clear must not resurrect cache");

  // 2. Validate outer before mismatch is rejected
  clearAllSessionHistoryPages();
  await assert.rejects(
    async () => {
      await fetchHistoryPageContext({
        sessionId: sid,
        before,
        fetchFn: async () =>
          new Response(JSON.stringify({ context, tail: 50, before: "corrupted_before_cursor" }), {
            status: 200,
          }),
      });
    },
    /History page response before mismatch/,
  );

  // 3. Validate corrupted context shape is rejected
  await assert.rejects(
    async () => {
      await fetchHistoryPageContext({
        sessionId: sid,
        before,
        fetchFn: async () =>
          new Response(
            JSON.stringify({
              context: {
                messages: [{ role: "user", content: "evil", running: true }],
                entryIds: ["e1"],
                oldestEntryId: "e1",
                hasMore: false,
              },
              tail: 50,
              before,
            }),
            { status: 200 },
          ),
      });
    },
    /Invalid history page context received from server/,
  );

  // 4. HEAD 500 error must throw and never be treated as hit
  // First prime cache
  await fetchHistoryPageContext({
    sessionId: sid,
    before,
    fetchFn: async () =>
      new Response(JSON.stringify({ context, tail: 50, before }), {
        status: 200,
        headers: {
          [HISTORY_CACHE_PROTOCOL_HEADER]: HISTORY_CACHE_PROTOCOL_VERSION,
          [HISTORY_FINGERPRINT_HEADER]: "fp_500_test",
        },
      }),
  });

  await assert.rejects(
    async () => {
      await fetchHistoryPageContext({
        sessionId: sid,
        before,
        fetchFn: async (url, options = {}) => {
          if (options.method === "HEAD") {
            return new Response(null, { status: 500 });
          }
          return new Response(null, { status: 500 });
        },
      });
    },
    /HTTP 500/,
  );
});
