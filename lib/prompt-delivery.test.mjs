import test from 'node:test';
import assert from 'node:assert/strict';
import {createJiti} from 'jiti';
const jiti=createJiti(import.meta.url,{moduleCache:false});
const {runPromptDelivery,getPromptReceipt}=await jiti.import('./prompt-delivery.ts');
const id=()=>crypto.randomUUID();
const command={type:'prompt',message:'同一段引导',streamingBehavior:'steer'};
test('receipt exists before preflight; simultaneous same-ID POST is admitted once',async()=>{
 const requestId=id();let count=0,finish;const wait=new Promise(r=>finish=r);
 const a=runPromptDelivery('A',requestId,command,async()=>{count++;await wait;return null;});
 const b=runPromptDelivery('A',requestId,command,async()=>{count++;});
 assert.equal(getPromptReceipt('A',requestId).status,'pending');await Promise.resolve();assert.equal(count,1);
 finish();await Promise.all([a,b]);assert.equal(getPromptReceipt('A',requestId).status,'accepted');
});
test('failed preflight has an explicit negative receipt; duplicate is not executed',async()=>{
 const requestId=id();let count=0;const execute=async()=>{count++;throw Error('invalid model');};
 await assert.rejects(runPromptDelivery('A',requestId,command,execute),/invalid model/);
 assert.deepEqual(getPromptReceipt('A',requestId),{status:'rejected',error:'invalid model'});
 await assert.rejects(runPromptDelivery('A',requestId,command,execute),/invalid model/);assert.equal(count,1);
});
test('same text with distinct request IDs is not suppressed; receipts are session scoped',async()=>{
 let count=0;const execute=async()=>{count++;};const requestId=id();
 await runPromptDelivery('A',requestId,command,execute);await runPromptDelivery('B',requestId,command,execute);
 await runPromptDelivery('A',id(),command,execute);assert.equal(count,3);
 assert.equal(getPromptReceipt('other',requestId).status,'unknown');
});
test('reusing an ID with different text or attachments fails closed',async()=>{
 const requestId=id();await runPromptDelivery('A',requestId,command,async()=>null);
 await assert.rejects(runPromptDelivery('A',requestId,{...command,message:'different'},async()=>null),/another submission/);
 await assert.rejects(runPromptDelivery('A',requestId,{...command,images:[{data:'eA==',mimeType:'image/png'}]},async()=>null),/another submission/);
 assert.equal(getPromptReceipt('A',requestId).status,'accepted');
});
