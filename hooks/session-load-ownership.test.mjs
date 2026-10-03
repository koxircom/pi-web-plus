import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';

// Execute the real load callback with controlled network completion order.
const source=readFileSync(new URL('./useAgentSession.ts',import.meta.url),'utf8');
const callback=source.slice(source.indexOf('  const loadSession = useCallback'),source.indexOf('  const loadContext = useCallback'));
const executable=stripTypeScriptTypes(callback)+'\nloadSession';
const data=(name)=>({sessionId:'s',leafId:name,toolNames:undefined,context:{messages:[name],entryIds:[name],oldestEntryId:name,hasMore:false,thinkingLevel:'off'}});
function harness(){
  let epoch=0;const pending=[],state={loading:false,error:null,history:null};
  const ref=current=>({current});
  const scope={useCallback:f=>f,isSessionMemoryCacheEnabled:()=>false,getSessionEpoch:()=>epoch,bumpSessionEpoch:()=>++epoch,isEpochFresh:(_,e)=>e===epoch,
    sessionHookMountedRef:ref(true),sessionIdRef:ref('s'),latestLoadRequestRef:ref(null),loadFlightsRef:ref(new Map()),
    getSessionWireBaseline:()=>null,dataRef:ref(null),messagesRef:ref([]),entryIdsRef:ref([]),historyCursorRef:ref(null),hasEarlierMessagesRef:ref(false),
    buildSessionSyncUrl:()=>'/history',fetch:()=>new Promise((resolve,reject)=>pending.push({resolve,reject})),reconcileSyncResponse:({payload})=>({action:'legacy',data:payload}),
    preserveLoadedHistoryPrefix:d=>d,deleteSessionViewSnapshot:()=>{},setLoading:v=>state.loading=v,setData:d=>state.history=d,setMessages:()=>{},setEntryIds:()=>{},setActiveLeafId:()=>{},setHistoryCursor:()=>{},setHasEarlierMessages:()=>{},
    sessionToolsPinnedRef:ref(false),CONFIGURED_TOOL_PRESET:'configured',setToolPresetState:()=>{},modelSwitchPendingRef:ref(false),setCurrentModelOverride:()=>{},setCurrentThinkingOverride:()=>{},setError:e=>state.error=e,syncLiveModel:()=>{},
    isAbortError:e=>e?.name==='AbortError',queueMicrotask,console};
  return{load:vm.runInNewContext(executable,scope),pending,state,scope};
}
const response=d=>({ok:true,status:200,json:async()=>d});
for(const outcome of ['success','failure','missing','cancelled'])test(`a silent ${outcome} replacement releases initial loading and ignores the older response`,async()=>{
  const h=harness(),first=h.load('s',true),controller=new AbortController();
  assert.equal(h.state.loading,true);
  const replacement=h.load('s',false,false,{force:true,signal:controller.signal});
  if(outcome==='success')h.pending[1].resolve(response(data('new')));
  else if(outcome==='failure')h.pending[1].reject(new Error('offline'));
  else if(outcome==='missing')h.pending[1].resolve({ok:false,status:404});
  else{controller.abort();h.pending[1].reject(Object.assign(new Error('cancelled'),{name:'AbortError'}));}
  await replacement;
  assert.equal(h.state.loading,false,'the current owner must settle loading even when it did not show the spinner');
  const settled=h.state.history;h.pending[0].resolve(response(data('old')));await first;
  assert.equal(h.state.history,settled,'a superseded response must not overwrite current history');
  assert.equal(h.pending.length,2,'terminal errors and explicit cancellation must not replay history');
  if(outcome==='failure')assert.match(h.state.error,/offline/);
  if(outcome==='cancelled')assert.equal(h.state.error,null);
});
