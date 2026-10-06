import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('./modules/03-session-cache-and-sync-engine.js',import.meta.url),'utf8');
const body=source.slice(source.indexOf('  async function prepareStopRuntimeForPrompt('),source.indexOf('  // 记录每个 DOM 按钮'));
test('Stop owns the entire lazy connection upgrade before prompt dispatch',async()=>{
 let resolve;const upgrading=new Promise(r=>resolve=r),pending=new Map();
 const context={pendingStopRuntimePreparations:pending,dormantSessionEventSources:new Map([['sid',{upgradeToReal:()=>upgrading}]]),baseFetch:async()=>({ok:true,json:async()=>({data:{stopRuntimeVersion:'1.0.0',subagentCancellationVersion:'not-applicable'}})}),originalWindowFetch:null,window:{},Headers,DOMException};
 vm.createContext(context);vm.runInContext(body+';this.prepare=prepareStopRuntimeForPrompt',context);
 const operation=context.prepare({sessionId:'sid',urlStr:'/api/agent/sid'},'/api/agent/sid',{});
 await new Promise(r=>setImmediate(r));assert.equal(pending.get('sid').size,1);
 for(const entry of pending.get('sid'))entry.cancelled=true;
 resolve();assert.equal(await operation,false);assert.equal(pending.size,0);
});
