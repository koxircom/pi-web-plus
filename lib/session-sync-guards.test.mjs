import test from 'node:test';
import assert from 'node:assert/strict';
import {reconcileSyncResponse, isAgentMessageEqual, reuseMessageObjects} from './session-sync-client.ts';
import {computeTailDelta, negotiateSessionSync, clearBaselineCache} from './session-sync-server.ts';
const msg = (text, extra={}) => ({role:'assistant',content:[{type:'text',text}],...extra});
const baseline={sessionId:'s',revision:'r',messages:[msg('a'),msg('b')],entryIds:['a','b'],savedAt:0};
const delta={protocol:1,mode:'delta',baseRevision:'r',revision:'r2',dropCount:0,keepCount:1,tailMessages:[msg('new')],data:{sessionId:'s',context:{entryIds:['a','b']}}};
const run=(payload,base=baseline)=>reconcileSyncResponse({sessionId:'s',status:200,payload,wireBaseline:base});
test('unchanged requires exact revision and session identity',()=>{
  for(const base of [null,{...baseline,sessionId:'other'},{...baseline,revision:'wrong'}]) assert.equal(run({protocol:1,mode:'unchanged',revision:'r'},base).action,'invalid_delta');
});
test('delta rejects fractional/NaN bounds, missing version, duplicates and wrong session',()=>{
  for(const bad of [{keepCount:0.5},{dropCount:NaN},{revision:null},{data:{sessionId:'other',context:{entryIds:['a','b']}}},{data:{sessionId:'s',context:{entryIds:['a','a']}}}]) assert.equal(run({...delta,...bad}).action,'invalid_delta');
});
test('reset rejects cross-session and malformed parallel arrays',()=>{
  assert.equal(run({protocol:1,mode:'reset',revision:'n',data:{sessionId:'other',context:{messages:[],entryIds:[]}}}).action,'error');
  assert.equal(run({protocol:1,mode:'reset',revision:'n',data:{sessionId:'s',context:{messages:[msg('a')],entryIds:[]}}}).action,'error');
});
test('metadata-only message change must replace reference',()=>{
  for(const field of ['stopReason','usage','timestamp','toolCallId','isError']) {
    const a=msg('same',{[field]:'old'}), b=msg('same',{[field]:'new'});
    assert.equal(isAgentMessageEqual(a,b),false,field);
    assert.equal(reuseMessageObjects([b],[a])[0],b,field);
  }
});
test('entry IDs, not same-content positional guesses, control object reuse',()=>{
  const old=msg('same'), replacement=msg('same');
  assert.equal(reuseMessageObjects([replacement],[old],['new-id'],['old-id'])[0],replacement);
});
test('null reset overrides stale payload revision; explicit empty is valid',()=>{
  const r=run({protocol:1,mode:'reset',revision:null,data:{sessionId:'s',snapshotRevision:'old',context:{messages:[],entryIds:[]}}});
  assert.equal(r.action,'reset'); assert.equal(r.data.snapshotRevision,null); assert.equal(r.newWireBaseline,null);
});
test('server and client interoperate with actual typed envelopes and same-ID tail delta',async()=>{
  clearBaselineCache(); let fp='d:i:100:1:1';
  let data={sessionId:'s',leafId:'b',context:{messages:[msg('x'.repeat(1500)),msg('b')],entryIds:['a','b']}};
  const deps={sessionId:'s',filePath:'/fixture/s',baseRevision:null,scope:{sessionId:'s',summaryTree:true,tail:50,deferThinking:true,deferMedia:true},isLive:false,isRunning:false,getFileFingerprint:()=>fp,buildSnapshot:async()=>structuredClone(data)};
  const reset=await negotiateSessionSync(deps); const installed=run(reset,null); assert.equal(installed.action,'reset');
  fp='d:i:110:2:2'; data.context.messages[1]=msg('changed');
  const patch=await negotiateSessionSync({...deps,baseRevision:reset.revision});
  assert.equal(patch.mode,'delta'); const merged=run(patch,installed.newWireBaseline);
  assert.equal(merged.action,'delta'); assert.deepEqual(merged.data.context.messages,data.context.messages);
  assert.equal(merged.data.context.messages[0],installed.newWireBaseline.messages[0]);
});
