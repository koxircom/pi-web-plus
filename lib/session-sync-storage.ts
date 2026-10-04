/** Persistent backing for exact settled wire snapshots. Live run/queue/SSE state
 * stays in its native owner. The on-disk record holds history only once. */
import type { SessionWireBaseline } from './session-view-cache.ts';
const DB_NAME = 'pi-enh-session-wire-v1';
const MAX_BYTES = 32 * 1024 * 1024;
const MAX_ENTRIES = 8;
const MAX_AGE = 24 * 60 * 60 * 1000;
let generation = 0;
let writes: Promise<unknown> = Promise.resolve();
type DiskRecord = { sessionId: string; format: 2; json: string; bytes: number; savedAt: number };
const prepared = new WeakMap<object, DiskRecord>();
const pending = new Map<string, { record: DiskRecord; epoch: number }>();
let queuedDrain: object | null = null;

/** Shared with the resident byte budget: serialize once, without messages and
 * entryIds duplicated alongside data.context. JSON also freezes queued writes. */
export function prepareSessionWireDisk(baseline: SessionWireBaseline): DiskRecord | null {
  const cached = prepared.get(baseline); if (cached) return cached;
  if (!baseline.data || baseline.messages !== baseline.data.context?.messages
      || baseline.entryIds !== baseline.data.context?.entryIds) return null;
  try {
    const json = JSON.stringify({ ...baseline, messages: undefined, entryIds: undefined });
    const record: DiskRecord = { sessionId: baseline.sessionId, format: 2, json,
      bytes: new TextEncoder().encode(json).byteLength, savedAt: baseline.savedAt };
    prepared.set(baseline, record); return record;
  } catch { return null; }
}
function open(): Promise<IDBDatabase | null> {
  return new Promise(resolve => {
    if (typeof indexedDB === 'undefined') return resolve(null);
    let done = false;
    const finish = (db: IDBDatabase | null) => { if (done) { db?.close(); return; } done = true; clearTimeout(timer); resolve(db); };
    const timer = setTimeout(() => finish(null), 200);
    try {
      const request = indexedDB.open(DB_NAME, 2);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('snapshots')) db.createObjectStore('snapshots', { keyPath: 'sessionId' });
        if (!db.objectStoreNames.contains('metadata')) {
          const metadata = db.createObjectStore('metadata', { keyPath: 'sessionId' });
          // One-time v1 migration preserves existing refresh previews. Subsequent
          // eviction reads small metadata, never all transcript payloads.
          const cursor = request.transaction!.objectStore('snapshots').openCursor();
          cursor.onsuccess = () => {
            const row = cursor.result; if (!row) return;
            const value = row.value;
            if (typeof value.sessionId === 'string') metadata.put({ sessionId: value.sessionId,
              bytes: Number.isFinite(value.bytes) && value.bytes > 0 ? value.bytes : MAX_BYTES + 1,
              savedAt: value.baseline?.savedAt ?? value.savedAt ?? 0 });
            row.continue();
          };
        }
      };
      request.onsuccess = () => finish(request.result);
      request.onerror = request.onblocked = () => finish(null);
    } catch { finish(null); }
  });
}
export async function readSessionWireDisk(sid: string): Promise<SessionWireBaseline | null> {
  const epoch = generation, db = await open(); if (!db) return null;
  return new Promise(resolve => {
    let settled = false;
    const finish = (value: SessionWireBaseline | null) => { if (settled) return; settled = true; clearTimeout(timer); db.close(); resolve(epoch === generation ? value : null); };
    const timer = setTimeout(() => finish(null), 200);
    try {
      const request = db.transaction('snapshots', 'readonly').objectStore('snapshots').get(sid);
      request.onsuccess = () => {
        try {
          const row = request.result;
          if (!row || row.sessionId !== sid || !Number.isFinite(row.bytes) || row.bytes <= 0 || row.bytes > MAX_BYTES) return finish(null);
          const packed = row.format === 2 ? JSON.parse(row.json) : null;
          const value: SessionWireBaseline = packed ? { ...packed,
            messages: packed.data?.context?.messages, entryIds: packed.data?.context?.entryIds } : row.baseline;
          if (value?.sessionId !== sid || value?.data?.sessionId !== sid || !value?.data?.context || typeof value.revision !== 'string' || !value.revision
            || !Array.isArray(value.messages) || !Array.isArray(value.entryIds) || value.messages.length !== value.entryIds.length
            || new Set(value.entryIds).size !== value.entryIds.length || value.entryIds.some((id: unknown) => typeof id !== 'string' || !id)
            || !Array.isArray(value.data.context.messages) || value.data.context.messages.length !== value.entryIds.length
            || !Array.isArray(value.data.context.entryIds) || value.data.context.entryIds.length !== value.entryIds.length
            || value.data.snapshotRevision !== value.revision || !Number.isFinite(value.savedAt) || Date.now()-value.savedAt > MAX_AGE
            || value.savedAt > Date.now()+60000) return finish(null);
          // Legacy records duplicated both arrays. Check them on migration only;
          // v2 arrays are reconstructed from the sole authoritative context.
          if (!packed && (JSON.stringify(value.data.context.entryIds) !== JSON.stringify(value.entryIds)
            || JSON.stringify(value.data.context.messages) !== JSON.stringify(value.messages))) return finish(null);
          const normalized = { ...value, messages: value.data.context.messages, entryIds: value.data.context.entryIds };
          if (!packed) writeSessionWireDisk(normalized);
          finish(normalized);
        } catch { finish(null); }
      };
      request.onerror = () => finish(null);
    } catch { finish(null); }
  });
}
function enqueue(work: (db: IDBDatabase) => Promise<void>): Promise<unknown> {
  writes = writes.catch(()=>{}).then(async()=>{const db=await open();if(!db)return;try{await work(db);}finally{db.close();}}).catch(()=>{});
  return writes;
}
function putRecord(db: IDBDatabase, record: DiskRecord): Promise<void> {
  return new Promise(resolve => {
    const tx = db.transaction(['snapshots', 'metadata'], 'readwrite');
    const store = tx.objectStore('snapshots'), metadata = tx.objectStore('metadata');
    tx.oncomplete = tx.onerror = tx.onabort = () => resolve();
    store.put(record); metadata.put({ sessionId: record.sessionId, bytes: record.bytes, savedAt: record.savedAt });
    const all = metadata.getAll();
    all.onsuccess = () => {
      const rows = all.result.sort((a,b) => a.savedAt-b.savedAt);
      let total = rows.reduce((n,r) => n+r.bytes,0), count = rows.length;
      for (const row of rows) {
        if (count <= MAX_ENTRIES && total <= MAX_BYTES) break;
        store.delete(row.sessionId); metadata.delete(row.sessionId); total-=row.bytes; count--;
      }
    };
  });
}
export function writeSessionWireDisk(baseline: SessionWireBaseline): void {
  const record = prepareSessionWireDisk(baseline);
  if (!record || record.bytes > MAX_BYTES) return;
  pending.set(record.sessionId, { record, epoch: generation });
  if (queuedDrain) return;
  const token = {};
  queuedDrain = token;
  enqueue(async db => {
    while (pending.size && queuedDrain === token) {
        const [sid, next] = pending.entries().next().value!;
        pending.delete(sid);
        if (next.epoch === generation) await putRecord(db, next.record);
    }
  }).finally(() => { if (queuedDrain === token) queuedDrain = null; });
}
export function deleteSessionWireDisk(sid?: string): void {
  generation++; // An old read/queued put cannot resurrect invalidated snapshots.
  pending.clear();
  queuedDrain = null; // Subsequent writes queue after deletion, not into its prior drain.
  enqueue(db => new Promise(resolve => {
    const tx = db.transaction(['snapshots', 'metadata'], 'readwrite');
    for (const name of ['snapshots', 'metadata']) {
      const store = tx.objectStore(name); if (sid) store.delete(sid); else store.clear();
    }
    tx.oncomplete = tx.onerror = tx.onabort = () => resolve();
  }));
}
/** Resolves after pending backing-store writes, used by direct acceptance. */
export function flushSessionWireDisk(): Promise<unknown> { return writes; }
