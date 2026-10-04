import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
const source=readFileSync(new URL('../app/api/agent/new/route.ts',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace('export async function POST','async function POST');
function harness(){
 const calls=[];let release;
 const ready=new Promise(r=>release=r);
 const session={inner:{model:{id:'fixture',provider:'fixture'},agent:{state:{thinkingLevel:'high'}}},send:async c=>{calls.push(c.type);await ready;return {model:session.inner.model,thinkingLevel:'high'};}};
 const POST=vm.runInNewContext(stripTypeScriptTypes(source)+'\nPOST',{NextResponse:{json:(body,options)=>({body,status:options?.status??200})},existsSync:()=>true,randomUUID:()=> 'unique',allowFileRoot:()=>{},invalidateSessionListCache:()=>{},startRpcSession:async()=>({session,realSessionId:'real'}),Error,Set,String});
 return {POST,calls,release};
}
test('ensure_session returns identity and initial model without waiting for extension-bound get_state',async()=>{
 const h=harness();const result=await h.POST({json:async()=>({cwd:'/fixture',type:'ensure_session'})});
 assert.equal(result.body.sessionId,'real');assert.deepEqual(JSON.parse(JSON.stringify(result.body.model)),{provider:'fixture',modelId:'fixture'});assert.equal(result.body.thinkingLevel,'high');assert.deepEqual(h.calls,[]);
});
test('a direct first prompt still waits for readiness and dispatches once',async()=>{
 const h=harness();let settled=false;const request=h.POST({json:async()=>({cwd:'/fixture',type:'prompt',message:'hello'})}).then(r=>{settled=true;return r;});
 await new Promise(r=>setImmediate(r));assert.equal(settled,false);assert.deepEqual(h.calls,['get_state']);h.release();const result=await request;assert.equal(result.body.success,true);assert.deepEqual(h.calls,['get_state','prompt']);
});
test('invalid initial model is rejected before runtime creation',async()=>{
 const h=harness();const result=await h.POST({json:async()=>({cwd:'/fixture',type:'ensure_session',provider:'fixture'})});assert.equal(result.status,500);assert.deepEqual(h.calls,[]);
});
