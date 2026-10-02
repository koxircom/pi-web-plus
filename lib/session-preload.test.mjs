import assert from 'node:assert/strict';
import test from 'node:test';
import { registerSessionPreloadBridge, updateSessionPreloadCatalog, waitForSessionPreload, isSessionResidentFresh, resetSessionPreloadStateForTests } from './session-preload.ts';
import { resetSessionViewCacheForTests, getSessionViewSnapshot } from './session-view-cache.ts';
import { bumpSessionEpoch, resetSyncClientStateForTests } from './session-sync-client.ts';
const pause = () => new Promise(resolve => setImmediate(resolve));
const data = sid => ({ sessionId:sid, filePath:'/owned/'+sid, totalActiveMs:0, tree:[],leafId:'e1',toolNames:['read'],treeFormat:'summary',snapshotRevision:'rev-'+sid,context:{messages:[{role:'user',content:sid}],entryIds:['e1'],oldestEntryId:'e1',hasMore:false,thinkingLevel:'off',model:null} });
const catalog = ids => ids.map(id => ({id,path:'/owned/'+id,cwd:'/owned',created:'x',modified:'x',messageCount:1,firstMessage:id}));
function setup() {
  resetSessionViewCacheForTests(); resetSyncClientStateForTests(); resetSessionPreloadStateForTests();
  globalThis.window = {__PI_ENH_IS_PLUGIN_ENABLED__:()=>true,addEventListener(){},removeEventListener(){}};
  return registerSessionPreloadBridge();
}
test('notification preloads warm the native cache, share flights and preserve a changed session epoch', async()=>{
  const close=setup(), old=globalThis.fetch, calls=[], releases=[];
  globalThis.fetch=async url=>{ const sid=decodeURIComponent(url.split('/')[3].split('?')[0]); calls.push(sid); await new Promise(r=>releases.push(r)); return {ok:true,status:200,json:async()=>data(sid)}; };
  try {
    updateSessionPreloadCatalog(catalog(['active','ask','run','done']), new Set(['run']), new Set(['done']), 'active');
    window.__PI_WEB_SESSION_PRELOAD__.scheduleCandidates([{sessionId:'ask',hasAttention:true},{sessionId:'run',isRunning:true},{sessionId:'done',isCompleted:true,isUnread:true}],{activeSessionId:'active'});
    assert.equal(calls.length,2,'at most two background requests');
    window.__PI_WEB_SESSION_PRELOAD__.scheduleCandidates([{sessionId:'ask',hasAttention:true}],{activeSessionId:'active'});
    assert.equal(calls.length,2,'no duplicate flights');
    while (releases.length) releases.shift()(); await pause();
    while (releases.length) releases.shift()(); await pause();
    await Promise.all(['ask','run','done'].map(waitForSessionPreload));
    for(const sid of ['ask','run','done']) { assert(getSessionViewSnapshot(sid)); assert(isSessionResidentFresh(sid)); }
    const count=calls.length;
    updateSessionPreloadCatalog(catalog(['active','ask','run','done']), new Set(['run']), new Set(['done']), 'done');
    assert.equal(calls.length,count,'fresh resident opens without a second history read');
    bumpSessionEpoch('ask'); assert.equal(isSessionResidentFresh('ask'),false,'mutations invalidate resident reuse');
  } finally {close();globalThis.fetch=old;delete globalThis.window;}
});
test('old background responses cannot resurrect authenticated history after reset',async()=>{
  const close=setup(),old=globalThis.fetch;let release;
  globalThis.fetch=async()=>{await new Promise(r=>release=r);return {ok:true,status:200,json:async()=>data('ask')};};
  try {
    updateSessionPreloadCatalog(catalog(['ask']),new Set(),new Set(),null);
    window.__PI_WEB_SESSION_PRELOAD__.scheduleCandidates([{sessionId:'ask',hasAttention:true}]);
    resetSessionPreloadStateForTests();release();await waitForSessionPreload('ask');
    assert.equal(getSessionViewSnapshot('ask'),null);
  }finally {close();globalThis.fetch=old;delete globalThis.window;}
});

test('running unversioned previews preload into the same view cache without becoming delta baselines',async()=>{
 const close=setup(), old=globalThis.fetch;
 globalThis.fetch=async()=>({ok:true,status:200,json:async()=>({...data('run'),snapshotRevision:null})});
 try {
  updateSessionPreloadCatalog(catalog(['run']),new Set(['run']),new Set(),null);
  await waitForSessionPreload('run');
  assert.equal(getSessionViewSnapshot('run')?.livePreview,true);
  assert.equal(getSessionViewSnapshot('run')?.revision,null);
  assert(isSessionResidentFresh('run'));
 }finally {close();globalThis.fetch=old;delete globalThis.window;}
});

test('list detail hydration preserves resident freshness while file changes invalidate it',async()=>{
 const close=setup(),old=globalThis.fetch;let calls=0;
 globalThis.fetch=async()=>{calls++;return {ok:true,status:200,json:async()=>data('ask')};};
 try {
  const index={...catalog(['ask'])[0],detailsPending:true,messageCount:0};
  updateSessionPreloadCatalog([index],new Set(),new Set(),null);
  window.__PI_WEB_SESSION_PRELOAD__.scheduleCandidates([{sessionId:'ask',hasAttention:true}]);
  await waitForSessionPreload('ask');assert(isSessionResidentFresh('ask'));
  updateSessionPreloadCatalog(catalog(['ask']),new Set(),new Set(),'ask');
  assert(isSessionResidentFresh('ask'));assert.equal(calls,1);
  updateSessionPreloadCatalog([{...catalog(['ask'])[0],modified:'changed'}],new Set(),new Set(),'ask');
  assert.equal(isSessionResidentFresh('ask'),false);
 }finally{close();globalThis.fetch=old;delete globalThis.window;}
});
