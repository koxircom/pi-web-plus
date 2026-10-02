import test from 'node:test';
import assert from 'node:assert/strict';
import {clearSessionViewCache,deleteSessionViewSnapshot,deleteSessionWireBaseline} from './session-view-cache.ts';
import {buildHistoryPageCacheKey,computeLocalChecksum,setHistoryPageMemory,getHistoryPageMemory} from './session-history-page-cache.ts';

test('invalid moving-tail certification does not discard independently validated ancestor pages',()=>{
  clearSessionViewCache();
  const p={sessionId:'retention',leafId:'leaf',before:'boundary',tail:50,deferThinking:true,deferMedia:true};
  const context={messages:[{role:'user',content:'settled'}],entryIds:['older'],oldestEntryId:'older',hasMore:false};
  const serialized=JSON.stringify(context),key=buildHistoryPageCacheKey(p);
  const seed=()=>setHistoryPageMemory({...p,key,context,fingerprint:'fingerprint',protocol:'1',savedAt:Date.now(),lastAccessed:Date.now(),bytes:new TextEncoder().encode(serialized).byteLength,localChecksum:computeLocalChecksum(serialized)});
  assert.equal(seed(),true);
  deleteSessionWireBaseline(p.sessionId);
  assert.ok(getHistoryPageMemory(key));
  deleteSessionViewSnapshot(p.sessionId,{preserveHistoryPages:true});
  assert.ok(getHistoryPageMemory(key));
  deleteSessionViewSnapshot(p.sessionId);
  assert.equal(getHistoryPageMemory(key),null);
  seed();clearSessionViewCache();
  assert.equal(getHistoryPageMemory(key),null);
});
