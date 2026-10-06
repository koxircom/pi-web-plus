import test from 'node:test';
import assert from 'node:assert/strict';
import { createJiti } from 'jiti';
const { AgentSessionWrapper } = await createJiti(import.meta.url, {tsconfigPaths:true}).import('./rpc-manager.ts');
function fixture(t) {
 const calls = [], inner = {sessionId:'mode-fixture', isStreaming:false, isCompacting:false, isBashRunning:false,
  extensionRunner:{getRegisteredCommands:()=>[], emit:async()=>{}, createCommandContext:()=>({marker:'context'})},
  dispose(){}, prompt:()=>{throw new Error('configuration must not start model')}, getContextUsage:()=>{throw new Error('configuration must not read full context')}};
 const wrapper = new AgentSessionWrapper(inner); wrapper.extensionsBound = true;
 inner.extensionRunner.getCommand = name => name === 'composer-mode' ? {handler:async(mode,ctx)=>{
  assert.equal(ctx.marker,'context'); calls.push(mode);
  wrapper.extensionStatuses.set('composer-modes', JSON.stringify({version:1,mode}));
 }} : undefined;
 t.after(()=>wrapper.shutdown()); return {inner,wrapper,calls};
}
test('one command uses registered authoritative mode handler without prompt or context scan',async t=>{
 const h=fixture(t);
 for(const mode of ['goal','normal','plan','normal']){
  const response=await h.wrapper.send({type:'set_composer_mode',mode});
  assert.equal(JSON.parse(response.extensionStatuses[0].text).mode,mode);
 }
 assert.deepEqual(h.calls,['goal','normal','plan','normal']); assert.equal(h.wrapper.isRunning(),false);
});
test('busy mode preparation uses the authoritative extension; invalid modes never reach it',async t=>{
 const h=fixture(t);h.inner.isStreaming=true;
 const response=await h.wrapper.send({type:'set_composer_mode',mode:'plan'});
 assert.equal(JSON.parse(response.extensionStatuses[0].text).mode,'plan');
 h.inner.isStreaming=false;
 await assert.rejects(h.wrapper.send({type:'set_composer_mode',mode:'plan extra'}),/参数无效/);
 assert.deepEqual(h.calls,['plan']);
});
test('missing or rejecting extension never reports successful mode change',async t=>{
 const h=fixture(t);h.inner.extensionRunner.getCommand=()=>undefined;
 await assert.rejects(h.wrapper.send({type:'set_composer_mode',mode:'goal'}),/未加载/);
 h.inner.extensionRunner.getCommand=()=>({handler:async()=>{}});
 await assert.rejects(h.wrapper.send({type:'set_composer_mode',mode:'goal'}),/未确认/);
 h.inner.extensionRunner.getCommand=()=>({handler:async()=>{throw new Error('扩展执行失败')}});
 await assert.rejects(h.wrapper.send({type:'set_composer_mode',mode:'goal'}),/扩展执行失败/);
});
test('mode changes serialize admission and preserve each authoritative response',async t=>{
 const h=fixture(t);let release; const gate=new Promise(r=>release=r);let active=0,maxActive=0;
 h.inner.extensionRunner.getCommand=()=>({handler:async mode=>{
  maxActive=Math.max(maxActive,++active);h.calls.push(mode);if(mode==='plan')await gate;
  h.wrapper.extensionStatuses.set('composer-modes',JSON.stringify({version:1,mode}));active--;
 }});
 const first=h.wrapper.send({type:'set_composer_mode',mode:'plan'});
 const second=h.wrapper.send({type:'set_composer_mode',mode:'goal'});
 await new Promise(r=>setImmediate(r)); assert.deepEqual(h.calls,['plan']); release();
 const [a,b]=await Promise.all([first,second]); assert.equal(maxActive,1);
 assert.equal(JSON.parse(a.extensionStatuses[0].text).mode,'plan');assert.equal(JSON.parse(b.extensionStatuses[0].text).mode,'goal');
});
