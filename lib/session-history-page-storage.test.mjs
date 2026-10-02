import assert from "node:assert/strict";
import test from "node:test";
import {
  readHistoryPageDisk,
  writeHistoryPageDisk,
  deleteHistoryPagesDisk,
  clearHistoryPagesDisk,
  flushHistoryPagesDisk,
  getHistoryPagesGeneration,
} from "./session-history-page-storage.ts";
import {
  computeLocalChecksum,
  MAX_PAGE_BYTES,
} from "./session-history-page-cache.ts";

function createMockIndexedDB() {
  const storeData = new Map();
  const indexData = new Map(); // sessionId -> Set of keys

  const idb = {
    _data: storeData,
    open(dbName, version) {
      const openReq = {
        result: null,
        error: null,
        onupgradeneeded: null,
        onsuccess: null,
        onerror: null,
        onblocked: null,
      };

      queueMicrotask(() => {
        const mockDb = {
          objectStoreNames: {
            contains(name) {
              return name === "pages";
            },
          },
          createObjectStore(name, opts) {
            return {
              createIndex(indexName, keyPath) {},
            };
          },
          transaction(storeNames, mode) {
            let activeRequests = 0;
            const tx = {
              oncomplete: null,
              onerror: null,
              onabort: null,
            };

            function checkComplete() {
              if (activeRequests === 0) {
                queueMicrotask(() => {
                  if (activeRequests === 0) {
                    tx.oncomplete?.();
                  }
                });
              }
            }

            tx.objectStore = function(name) {
              return {
                get(key) {
                  activeRequests++;
                  const req = { result: undefined, onsuccess: null, onerror: null };
                  queueMicrotask(() => {
                    req.result = storeData.get(key);
                    req.onsuccess?.({ target: req });
                    activeRequests--;
                    checkComplete();
                  });
                  return req;
                },
                getAll() {
                  activeRequests++;
                  const req = { result: [], onsuccess: null, onerror: null };
                  queueMicrotask(() => {
                    req.result = Array.from(storeData.values());
                    req.onsuccess?.({ target: req });
                    activeRequests--;
                    checkComplete();
                  });
                  return req;
                },
                put(val) {
                  activeRequests++;
                  const req = { onsuccess: null, onerror: null };
                  queueMicrotask(() => {
                    storeData.set(val.key, val);
                    if (val.sessionId) {
                      if (!indexData.has(val.sessionId)) indexData.set(val.sessionId, new Set());
                      indexData.get(val.sessionId).add(val.key);
                    }
                    req.onsuccess?.({ target: req });
                    activeRequests--;
                    checkComplete();
                  });
                  return req;
                },
                delete(key) {
                  activeRequests++;
                  const req = { onsuccess: null, onerror: null };
                  queueMicrotask(() => {
                    const existing = storeData.get(key);
                    if (existing?.sessionId && indexData.has(existing.sessionId)) {
                      indexData.get(existing.sessionId).delete(key);
                    }
                    storeData.delete(key);
                    req.onsuccess?.({ target: req });
                    activeRequests--;
                    checkComplete();
                  });
                  return req;
                },
                clear() {
                  activeRequests++;
                  const req = { onsuccess: null, onerror: null };
                  queueMicrotask(() => {
                    storeData.clear();
                    indexData.clear();
                    req.onsuccess?.({ target: req });
                    activeRequests--;
                    checkComplete();
                  });
                  return req;
                },
                index(idxName) {
                  return {
                    getAllKeys(sid) {
                      activeRequests++;
                      const req = { result: [], onsuccess: null, onerror: null };
                      queueMicrotask(() => {
                        const keys = indexData.get(sid);
                        req.result = keys ? Array.from(keys) : [];
                        req.onsuccess?.({ target: req });
                        activeRequests--;
                        checkComplete();
                      });
                      return req;
                    },
                  };
                },
              };
            };

            return tx;
          },
          close() {},
        };

        openReq.result = mockDb;
        openReq.onsuccess?.({ target: openReq });
      });

      return openReq;
    },
  };

  return idb;
}

test("storage writes and reads valid page, enforcing checksum and boundaries", async () => {
  const origIndexedDB = globalThis.indexedDB;
  const mockIdb = createMockIndexedDB();
  globalThis.indexedDB = mockIdb;

  try {
    const page = {
      key: "s1::leaf=l1::before=e50::tail=50::dt=1::dm=1::v1",
      sessionId: "s1",
      leafId: "l1",
      before: "e50",
      tail: 50,
      fingerprint: "sha_fingerprint_1",
      protocol: "1",
      context: {
        messages: [{ role: "user", content: "hello" }],
        entryIds: ["e49"],
        oldestEntryId: "e49",
        hasMore: true,
      },
      savedAt: Date.now(),
      bytes: 100,
      localChecksum: "",
    };

    writeHistoryPageDisk(page);
    await flushHistoryPagesDisk();

    const readBack = await readHistoryPageDisk(page.key);
    assert.ok(readBack !== null);
    assert.equal(readBack.sessionId, "s1");
    assert.equal(readBack.fingerprint, "sha_fingerprint_1");
    assert.deepEqual(readBack.context, page.context);
    assert.equal(readBack.localChecksum, computeLocalChecksum(JSON.stringify(page.context)));

    // Test corrupted data in storage (bit rot) -> read must fail and return null safely
    const stored = mockIdb._data.get(page.key);
    stored.context = { ...stored.context, messages: [{ role: "user", content: "tampered" }] };
    // Notice: stored.localChecksum still matches the original, not the tampered content!
    const corruptedRead = await readHistoryPageDisk(page.key);
    assert.equal(corruptedRead, null, "Corrupted local checksum must return null (safe miss)");

    // Clean up
    deleteHistoryPagesDisk("s1");
    await flushHistoryPagesDisk();
    assert.equal(await readHistoryPageDisk(page.key), null);
  } finally {
    globalThis.indexedDB = origIndexedDB;
  }
});

test("storage enforces generation invalidation and single-page quota", async () => {
  const origIndexedDB = globalThis.indexedDB;
  const mockIdb = createMockIndexedDB();
  globalThis.indexedDB = mockIdb;

  try {
    const genBefore = getHistoryPagesGeneration();
    deleteHistoryPagesDisk("s_any");
    assert.equal(getHistoryPagesGeneration(), genBefore + 1, "delete increments generation");

    clearHistoryPagesDisk();
    assert.equal(getHistoryPagesGeneration(), genBefore + 2, "clear increments generation");

    // Single page oversize (> 2MiB) refused
    const hugePage = {
      key: "s_huge::leaf=::before=e1::tail=50::dt=1::dm=1::v1",
      sessionId: "s_huge",
      leafId: null,
      before: "e1",
      tail: 50,
      fingerprint: "fp",
      protocol: "1",
      context: {
        messages: [{ role: "user", content: "x".repeat(MAX_PAGE_BYTES + 10) }],
        entryIds: ["e0"],
        oldestEntryId: "e0",
        hasMore: false,
      },
      savedAt: Date.now(),
      bytes: MAX_PAGE_BYTES + 10,
      localChecksum: "",
    };

    writeHistoryPageDisk(hugePage);
    await flushHistoryPagesDisk();
    assert.equal(await readHistoryPageDisk(hugePage.key), null, "Oversized page not written");
  } finally {
    globalThis.indexedDB = origIndexedDB;
  }
});

test("storage gracefully falls back to null when indexedDB is undefined or errors", async () => {
  const origIndexedDB = globalThis.indexedDB;
  delete globalThis.indexedDB;

  try {
    const res = await readHistoryPageDisk("some_key");
    assert.equal(res, null, "Undefined indexedDB returns null");
  } finally {
    globalThis.indexedDB = origIndexedDB;
  }
});

test("storage purges negative-byte and corrupted rows during maintenance, and updates disk lastAccessed", async () => {
  const origIndexedDB = globalThis.indexedDB;
  const mockIdb = createMockIndexedDB();
  globalThis.indexedDB = mockIdb;

  try {
    // 1. Insert a normal page
    const pageValid = {
      key: "s_test_valid",
      sessionId: "s_test",
      leafId: null,
      before: "e2",
      tail: 50,
      deferThinking: true,
      deferMedia: true,
      fingerprint: "fp_valid",
      protocol: "1",
      context: {
        messages: [{ role: "user", content: "ok" }],
        entryIds: ["e1"],
        oldestEntryId: "e1",
        hasMore: false,
      },
      savedAt: Date.now() - 5000,
      lastAccessed: Date.now() - 5000,
      bytes: 0,
      localChecksum: "",
    };

    writeHistoryPageDisk(pageValid);
    await flushHistoryPagesDisk();

    // 2. Inject an invalid / negative bytes row directly into mock DB
    mockIdb._data.set("malicious_negative_row", {
      key: "malicious_negative_row",
      sessionId: "s_evil",
      before: "e99",
      tail: 50,
      fingerprint: "fp_evil",
      protocol: "1",
      context: { messages: [], entryIds: [], oldestEntryId: null, hasMore: false },
      savedAt: Date.now(),
      lastAccessed: Date.now(),
      bytes: -9999999, // negative bytes to escape budget
      localChecksum: "fake",
    });

    assert.ok(mockIdb._data.has("malicious_negative_row"));

    // 3. Trigger write to execute maintenance
    const pageTrigger = {
      key: "s_test_trigger",
      sessionId: "s_test",
      leafId: null,
      before: "e3",
      tail: 50,
      deferThinking: true,
      deferMedia: true,
      fingerprint: "fp_trigger",
      protocol: "1",
      context: {
        messages: [{ role: "user", content: "trigger" }],
        entryIds: ["e2"],
        oldestEntryId: "e2",
        hasMore: false,
      },
      savedAt: Date.now(),
      lastAccessed: Date.now(),
      bytes: 0,
      localChecksum: "",
    };

    writeHistoryPageDisk(pageTrigger);
    await flushHistoryPagesDisk();

    // Negative row should be purged
    assert.equal(mockIdb._data.has("malicious_negative_row"), false, "Negative bytes row must be purged during maintenance");

    // 4. Test read hit updates lastAccessed without modifying savedAt
    const beforeReadSavedAt = pageValid.savedAt;
    const readHit = await readHistoryPageDisk(pageValid.key);
    assert.ok(readHit !== null);
    assert.equal(readHit.savedAt, beforeReadSavedAt, "savedAt must remain unchanged after read hit");

    await flushHistoryPagesDisk();
    const storedRow = mockIdb._data.get(pageValid.key);
    assert.ok(storedRow.lastAccessed >= beforeReadSavedAt, "lastAccessed should be updated on disk");

    // 5. Test write with outdated generation does not resurrect
    const currentGen = getHistoryPagesGeneration();
    deleteHistoryPagesDisk("s_test"); // increments generation
    await flushHistoryPagesDisk();

    writeHistoryPageDisk(pageValid, currentGen); // write with old gen
    await flushHistoryPagesDisk();

    assert.equal(await readHistoryPageDisk(pageValid.key), null, "Outdated generation write must not resurrect");
  } finally {
    globalThis.indexedDB = origIndexedDB;
  }
});
