/** Persistent backing for exact native wire snapshots, never live run/queue/SSE state.
 * Separate format from legacy fetch-cache payloads; same origin and plugin policy.
 */
import type { SessionWireBaseline } from './session-view-cache.ts';
const DB_NAME = 'pi-enh-session-wire-v1';
const MAX_BYTES = 32 * 1024 * 1024;
const MAX_ENTRIES = 8;
const MAX_AGE = 24 * 60 * 60 * 1000;
let generation = 0;
let writes: Promise<unknown> = Promise.resolve();

function open(): Promise<IDBDatabase | null> {
  return new Promise(resolve => {
    if (typeof indexedDB === 'undefined') return resolve(null);
    let done = false;
    const finish = (db: IDBDatabase | null) => { if (done) { db?.close(); return; } done = true; clearTimeout(timer); resolve(db); };
    const timer = setTimeout(() => finish(null), 200);
    try {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore('snapshots', {keyPath:'sessionId'});
      request.onsuccess = () => finish(request.result);
      request.onerror = request.onblocked = () => finish(null);
    } catch { finish(null); }
  });
}
export async function readSessionWireDisk(sid: string): Promise<SessionWireBaseline | null> {
  const epoch = generation;
  const db = await open(); if (!db) return null;
  return new Promise(resolve => {
    let settled = false;
    const finish = (value: SessionWireBaseline | null) => { if (settled) return; settled = true; clearTimeout(timer); db.close(); resolve(epoch === generation ? value : null); };
    const timer = setTimeout(() => finish(null), 200);
    try {
      const tx = db.transaction('snapshots', 'readonly');
      const request = tx.objectStore('snapshots').get(sid);
      request.onsuccess = () => {
        const value = request.result?.baseline;
        if (value?.sessionId !== sid || value?.data?.sessionId !== sid || !value?.data?.context || typeof value.revision !== 'string'
          || !Array.isArray(value.messages) || !Array.isArray(value.entryIds) || value.messages.length !== value.entryIds.length
          || new Set(value.entryIds).size !== value.entryIds.length || value.entryIds.some((id: unknown) => typeof id !== 'string' || !id)
          || !Array.isArray(value.data.context.messages) || value.data.context.messages.length !== value.entryIds.length
          || JSON.stringify(value.data.context.entryIds) !== JSON.stringify(value.entryIds)
          || JSON.stringify(value.data.context.messages) !== JSON.stringify(value.messages)
          || value.data.snapshotRevision !== value.revision || !Number.isFinite(value.savedAt) || Date.now()-value.savedAt > MAX_AGE
          || value.savedAt > Date.now()+60000 || !Number.isFinite(request.result.bytes) || request.result.bytes > MAX_BYTES) return finish(null);
        finish(value);
      };
      request.onerror = () => finish(null);
    } catch { finish(null); }
  });
}
function enqueue(work: (db: IDBDatabase) => Promise<void>): void {
  writes = writes.catch(()=>{}).then(async()=>{const db=await open();if(!db)return;try{await work(db);}finally{db.close();}}).catch(()=>{});
}
export function writeSessionWireDisk(baseline: SessionWireBaseline): void {
  if (!baseline.data) return;
  let bytes: number, frozen: SessionWireBaseline;
  try { const json=JSON.stringify(baseline);bytes=new TextEncoder().encode(json).byteLength;if(bytes>MAX_BYTES)return;frozen=JSON.parse(json); } catch { return; }
  const epoch = generation;
  enqueue(db=>new Promise(resolve=>{
    if(epoch!==generation)return resolve();
    const tx=db.transaction('snapshots','readwrite'), store=tx.objectStore('snapshots');
    tx.oncomplete=tx.onerror=tx.onabort=()=>resolve();
    store.put({sessionId:baseline.sessionId,baseline:frozen,bytes});
    const all=store.getAll();
    all.onsuccess=()=>{
      const rows=all.result.sort((a,b)=>a.baseline.savedAt-b.baseline.savedAt);
      let total=rows.reduce((n,r)=>n+r.bytes,0), count=rows.length;
      for(const row of rows) {
        if(count<=MAX_ENTRIES && total<=MAX_BYTES)break;
        store.delete(row.sessionId); total-=row.bytes; count--;
      }
    };
  }));
}
export function deleteSessionWireDisk(sid?: string): void {
  generation++; // Queued puts/reads from before logout/disable/delete cannot resurrect snapshots.
  enqueue(db=>new Promise(resolve=>{
    const tx=db.transaction('snapshots','readwrite'), store=tx.objectStore('snapshots');
    if(sid)store.delete(sid);else store.clear();
    tx.oncomplete=tx.onerror=tx.onabort=()=>resolve();
  }));
}
/** Test/readiness seam: resolves after pending backing-store writes. */
export function flushSessionWireDisk(): Promise<unknown> { return writes; }
