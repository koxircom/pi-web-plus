'use strict';
const assert=require('node:assert/strict'),test=require('node:test'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../modules/06-chat-view-and-tool-cards.js'),'utf8');
const boundary=source.slice(source.indexOf('  function hasCompleteTurnStart('),source.indexOf('  let metricsScheduleToken'));
const reader=source.slice(source.indexOf('  let lastNativeMetricsInput ='),source.indexOf('  function fetchCurrentSessionMetrics('));
function fixture(data){
  const requests=[];
  const context={window:{__PI_WEB_GET_RESIDENT_SESSION_DATA__:()=>data},isDisposed:false,
    sessionMemoryCache:new Map(),inFlightSessionDetailRequests:new Map(),
    getCurrentSessionId:()=> 'one',findCompatibleSessionDetail:()=>null,
    fetch:async url=> {requests.push(url);return {ok:true,json:async()=>({context:{messages:[{role:'assistant',stopReason:'stop'},{role:'user'}],entryIds:['end','start'],hasMore:false,oldestEntryId:'end'}})}}};
  vm.createContext(context);vm.runInContext(boundary+reader+'\nthis.read=fetchSessionDataWithTurnStart;',context);
  return {read:context.read,requests};
}
test('ready native history serves metrics without a second session read and repeated input is skipped',async()=>{
  const data={sessionId:'one',tree:[],context:{messages:[{role:'user'},{role:'assistant',stopReason:'stop'}],entryIds:['u','a'],hasMore:false,oldestEntryId:'u'}};
  const f=fixture(data);assert.equal(await f.read('one'),data);assert.equal(await f.read('one'),null);assert.deepEqual(f.requests,[]);
});
test('native owner waits for its authoritative first read instead of racing it',async()=>{
  const f=fixture(null);assert.equal(await f.read('one'),null);assert.deepEqual(f.requests,[]);
});
test('a user at a partial-page edge requires older context and never duplicates the primary session read',async()=>{
  const data={sessionId:'one',context:{messages:[{role:'user'},{role:'assistant',stopReason:'stop'}],entryIds:['u','a'],hasMore:true,oldestEntryId:'u'}};
  const f=fixture(data),result=await f.read('one');assert.equal(f.requests.length,1);assert.match(f.requests[0],/\/context\?.*metricsOnly=1.*before=u/);assert.equal(result.context.messages.length,4);assert.equal(result.context.hasMore,false);assert.equal(await f.read('one'),null);assert.equal(f.requests.length,1);
});
