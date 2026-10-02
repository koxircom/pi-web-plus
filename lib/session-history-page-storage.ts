/** Persistent backing store (IndexedDB) for paged history context, never live run/queue/SSE state.
 * Fully isolated from wire snapshots and legacy caches.
 */
import type { CachedHistoryPage, HistoryPageExpectedParams, HistoryPageContext } from "./session-history-page-cache.ts";
import {
  MAX_PAGE_BYTES,
  MAX_TOTAL_BYTES,
  MAX_PAGES,
  MAX_SESSIONS,
  MAX_AGE_MS,
  HISTORY_CACHE_PROTOCOL_VERSION,
  computeLocalChecksum,
  validateHistoryPageContext,
  validateCachedHistoryPageEnvelope,
} from "./session-history-page-cache.ts";

const DB_NAME = "pi-enh-history-page-v1";
let generation = 0;
let writes: Promise<unknown> = Promise.resolve();

function open(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === "undefined") return resolve(null);
    let done = false;
    const finish = (db: IDBDatabase | null) => {
      if (done) {
        db?.close();
        return;
      }
      done = true;
      clearTimeout(timer);
      resolve(db);
    };
    const timer = setTimeout(() => finish(null), 500);
    try {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("pages")) {
          const store = db.createObjectStore("pages", { keyPath: "key" });
          store.createIndex("sessionId", "sessionId", { unique: false });
        }
      };
      request.onsuccess = () => finish(request.result);
      request.onerror = request.onblocked = () => finish(null);
    } catch {
      finish(null);
    }
  });
}

function touchDiskLastAccessed(key: string, expectedGen: number): void {
  // Fire-and-forget short bounded transaction to update lastAccessed without touching savedAt
  enqueue(async (db) => {
    if (expectedGen !== generation) return;
    return new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        try {
          tx.abort();
        } catch {}
        finish();
      }, 500);

      const tx = db.transaction("pages", "readwrite");
      const store = tx.objectStore("pages");
      tx.oncomplete = tx.onerror = tx.onabort = () => finish();

      const req = store.get(key);
      req.onsuccess = () => {
        const row = req.result as CachedHistoryPage | undefined;
        if (row && typeof row === "object" && row.key === key) {
          row.lastAccessed = Date.now();
          store.put(row);
        }
      };
    });
  });
}

export async function readHistoryPageDisk(
  key: string,
  expected?: HistoryPageExpectedParams,
): Promise<CachedHistoryPage | null> {
  const epoch = generation;
  const db = await open();
  if (!db) return null;

  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: CachedHistoryPage | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        db.close();
      } catch {}
      resolve(epoch === generation ? value : null);
    };
    const timer = setTimeout(() => {
      try {
        tx.abort();
      } catch {}
      finish(null);
    }, 500);

    let tx: IDBTransaction;
    try {
      tx = db.transaction("pages", "readonly");
      tx.onerror = tx.onabort = () => finish(null);
      const request = tx.objectStore("pages").get(key);
      request.onsuccess = () => {
        const rawRow = request.result;
        if (!rawRow || typeof rawRow !== "object") return finish(null);

        const validated = validateCachedHistoryPageEnvelope(rawRow, { ...expected, key });
        if (!validated) {
          return finish(null);
        }

        // Bounded disk LRU update (updates lastAccessed without modifying validated savedAt)
        touchDiskLastAccessed(key, epoch);

        finish(validated);
      };
      request.onerror = () => finish(null);
    } catch {
      finish(null);
    }
  });
}

function enqueue(work: (db: IDBDatabase) => Promise<void>): void {
  writes = writes
    .catch(() => {})
    .then(async () => {
      const db = await open();
      if (!db) return;
      let dbClosed = false;
      const safeClose = () => {
        if (!dbClosed) {
          dbClosed = true;
          try {
            db.close();
          } catch {}
        }
      };

      let taskTimer: ReturnType<typeof setTimeout> | undefined;
      try {
        // Transactions also abort on their own shorter deadlines.
        await Promise.race([
          work(db),
          new Promise<void>((_, reject) => {
            taskTimer = setTimeout(() => reject(new Error("Queued disk write task timed out")), 3000);
          }),
        ]);
      } catch {
        // Error or timeout: swallow safely so write queue continues to advance
      } finally {
        if (taskTimer !== undefined) clearTimeout(taskTimer);
        safeClose();
      }
    })
    .catch(() => {});
}

export function writeHistoryPageDisk(page: CachedHistoryPage, expectedGen?: number): void {
  if (expectedGen !== undefined && expectedGen !== generation) return;
  if (!page || typeof page !== "object") return;
  if (!page.key || !page.sessionId || !page.before || !page.fingerprint) return;
  if (!validateHistoryPageContext(page.context, page.before)) return;

  let serializedContext: string;
  let bytes: number;
  let valid: CachedHistoryPage;

  try {
    serializedContext = JSON.stringify(page.context);
    bytes = new TextEncoder().encode(serializedContext).byteLength;
    if (bytes > MAX_PAGE_BYTES) return; // Oversized page refused

    const now = Date.now();
    const savedAt = Number.isFinite(page.savedAt) ? page.savedAt : now;
    if (now - savedAt > MAX_AGE_MS || savedAt > now + 60000) return;

    const rawTail = Number(page.tail);
    const tail = Number.isInteger(rawTail) && rawTail > 0 ? rawTail : 50;

    valid = {
      key: String(page.key),
      sessionId: String(page.sessionId),
      leafId: page.leafId ? String(page.leafId) : null,
      before: String(page.before),
      tail,
      deferThinking: Boolean(page.deferThinking),
      deferMedia: Boolean(page.deferMedia),
      fingerprint: String(page.fingerprint),
      protocol: HISTORY_CACHE_PROTOCOL_VERSION,
      context: JSON.parse(serializedContext) as HistoryPageContext,
      savedAt,
      lastAccessed: now,
      bytes,
      localChecksum: computeLocalChecksum(serializedContext),
    };
  } catch {
    return;
  }

  const targetEpoch = expectedGen ?? generation;

  enqueue(
    (db) =>
      new Promise<void>((resolve) => {
        if (targetEpoch !== generation) return resolve();

        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve();
        };

        let tx: IDBTransaction;
        const timer = setTimeout(() => {
          try {
            tx?.abort();
          } catch {}
          finish();
        }, 2500);

        try {
          tx = db.transaction("pages", "readwrite");
          const store = tx.objectStore("pages");

          tx.oncomplete = () => finish();
          tx.onerror = tx.onabort = () => finish();

          if (targetEpoch !== generation) {
            try {
              tx.abort();
            } catch {}
            return finish();
          }

          store.put(valid);

          // LRU and quota maintenance: clean invalid/expired/negative rows first
          const allReq = store.getAll();
          allReq.onsuccess = () => {
            if (targetEpoch !== generation) {
              try {
                tx.abort();
              } catch {}
              return finish();
            }

            const rawRows = (allReq.result || []) as unknown[];
            const validRows: CachedHistoryPage[] = [];

            // 1. Purge corrupted, expired, or negative byte rows first
            for (const r of rawRows) {
              const row = r as Record<string, unknown> | null;
              if (!row || typeof row !== "object" || typeof row.key !== "string") continue;
              const validated = validateCachedHistoryPageEnvelope(row);
              if (!validated) {
                store.delete(row.key as string);
              } else {
                validRows.push(validated);
              }
            }

            // 2. Session count cap (8 sessions) - purge oldest sessions and exclude them
            const sessionLastAccess = new Map<string, number>();
            for (const r of validRows) {
              const cur = sessionLastAccess.get(r.sessionId) ?? 0;
              const acc = r.lastAccessed || r.savedAt;
              if (acc > cur) sessionLastAccess.set(r.sessionId, acc);
            }
            if (sessionLastAccess.size > MAX_SESSIONS) {
              const sortedSessions = Array.from(sessionLastAccess.entries()).sort(
                (a, b) => a[1] - b[1],
              );
              const victims = new Set<string>();
              while (sortedSessions.length > MAX_SESSIONS) {
                const victim = sortedSessions.shift();
                if (victim) victims.add(victim[0]);
              }
              for (let i = validRows.length - 1; i >= 0; i--) {
                if (victims.has(validRows[i].sessionId)) {
                  store.delete(validRows[i].key);
                  validRows.splice(i, 1);
                }
              }
            }

            // 3. Page count cap (64 pages) & byte budget (32 MiB) after excluding purged rows
            validRows.sort(
              (a, b) => (a.lastAccessed || a.savedAt) - (b.lastAccessed || b.savedAt),
            );
            let totalBytes = validRows.reduce((sum, r) => sum + r.bytes, 0);
            let count = validRows.length;
            for (const row of validRows) {
              if (count <= MAX_PAGES && totalBytes <= MAX_TOTAL_BYTES) break;
              store.delete(row.key);
              totalBytes -= row.bytes;
              count--;
            }
          };
          allReq.onerror = () => finish();
        } catch {
          finish();
        }
      }),
  );
}

export function deleteHistoryPagesDisk(sid?: string): void {
  generation++; // Invalidate pending reads and queued puts
  const currentEpoch = generation;

  enqueue(
    (db) =>
      new Promise<void>((resolve) => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve();
        };

        let tx: IDBTransaction;
        const timer = setTimeout(() => {
          try {
            tx?.abort();
          } catch {}
          finish();
        }, 2000);

        try {
          tx = db.transaction("pages", "readwrite");
          const store = tx.objectStore("pages");
          tx.oncomplete = tx.onerror = tx.onabort = () => finish();

          if (sid) {
            const index = store.index("sessionId");
            const req = index.getAllKeys(sid);
            req.onsuccess = () => {
              if (currentEpoch !== generation) {
                try {
                  tx.abort();
                } catch {}
                return finish();
              }
              for (const key of req.result) {
                store.delete(key);
              }
            };
            req.onerror = () => finish();
          } else {
            store.clear();
          }
        } catch {
          finish();
        }
      }),
  );
}

export function clearHistoryPagesDisk(): void {
  deleteHistoryPagesDisk();
}

/** Test / readiness seam: resolves after pending disk writes. */
export function flushHistoryPagesDisk(): Promise<unknown> {
  return writes;
}

export function getHistoryPagesGeneration(): number {
  return generation;
}
