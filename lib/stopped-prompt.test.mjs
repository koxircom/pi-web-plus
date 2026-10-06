import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SessionManager} from '@earendil-works/pi-coding-agent';
import {createJiti} from 'jiti';
const jiti=createJiti(import.meta.url,{tsconfigPaths:true});
const {AgentSessionWrapper}=await jiti.import('./rpc-manager.ts');
const tick=()=>new Promise(r=>setImmediate(r));
async function fixture(t){
 const dir=await mkdtemp(join(tmpdir(),'pi-stopped-message-'));
 const manager=SessionManager.create(dir,dir);let release;
 const gate=new Promise(r=>release=r),calls=[];
 const inner={sessionId:manager.getSessionId(),sessionFile:manager.getSessionFile(),sessionManager:manager,agent:{state:{messages:[]}},isStreaming:false,isCompacting:false,isBashRunning:false,
 extensionRunner:{getRegisteredCommands:()=>[],emit:async()=>{}},dispose(){},abort:async()=>{},
 prompt:async(text,options)=>{await gate;options.preflightResult('started');calls.push('model');}};
 const wrapper=new AgentSessionWrapper(inner);
 t.after(async()=>{await wrapper.shutdown();await rm(dir,{recursive:true,force:true});});
 return {inner,wrapper,manager,calls,release};
}
test('retained stopped text+images+files survive native reopen and duplicate acknowledgement',async t=>{
 const h=await fixture(t),command={type:'retain_stopped_prompt',requestId:'submission-0000000000001',message:'修改这里\n\n[附件: @.pi-uploads/report.pdf]',images:[{type:'image',mimeType:'image/png',data:'AQID'}]};
 const saved=await h.wrapper.send(command);assert.equal(saved.stopped,true);
 assert.deepEqual(await h.wrapper.send(command),saved);
 const reopened=SessionManager.open(h.manager.getSessionFile());
 const users=reopened.getEntries().filter(e=>e.type==='message'&&e.message.role==='user');
 assert.equal(users.length,1);assert.equal(users[0].id,saved.entryId);assert.equal(users[0].message.content[0].text,command.message);assert.deepEqual(users[0].message.content[1],command.images[0]);
 assert.deepEqual(h.inner.agent.state.messages,[users[0].message]);assert.equal(h.calls.length,0);
});
test('retention refuses active generation rather than writing to its branch',async t=>{
 const h=await fixture(t);h.inner.isStreaming=true;
 await assert.rejects(h.wrapper.send({type:'retain_stopped_prompt',requestId:'submission-0000000000002',message:'no write'}),/仍在运行/);
 assert.equal(h.manager.getEntries().length,0);
 h.inner.isStreaming=false;
});
test('Stop during async SDK preflight never starts a later model request and saves once',async t=>{
 const h=await fixture(t);h.wrapper.extensionsBound=true;
 const sending=h.wrapper.send({type:'prompt',requestId:'submission-0000000000003',message:'停止这轮'});await tick();
 assert.equal(h.wrapper.isRunning(),true);await h.wrapper.send({type:'abort'});h.release();
 assert.equal((await sending).stopped,true);assert.deepEqual(h.calls,[]);assert.equal(h.wrapper.isRunning(),false);
 assert.equal(h.manager.getEntries().filter(e=>e.type==='message').length,1);
});
