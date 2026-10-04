import assert from 'node:assert/strict';
import test from 'node:test';
import {loadToolResultContent,clearToolResultContentCache,deleteToolResultContentCache} from './tool-result-content.ts';
test('versioned cache coalesces, invalidates and retries errors without retaining stale results',async()=>{
 const saved=globalThis.fetch;let calls=0,fail=false;const ref={entryId:'e',revision:'a'.repeat(64)};const result={role:'toolResult',toolCallId:'call',content:[{type:'text',text:'complete'}]};
 globalThis.fetch=async()=>{calls++;return fail?new Response('',{status:503}):Response.json({...ref,result});};
 try{const [a,b]=await Promise.all([loadToolResultContent('s',ref,'call'),loadToolResultContent('s',ref,'call')]);assert.equal(calls,1);assert.equal(a,b);await loadToolResultContent('s',ref,'call');assert.equal(calls,1);deleteToolResultContentCache('s');await loadToolResultContent('s',ref,'call');assert.equal(calls,2);clearToolResultContentCache();fail=true;await assert.rejects(()=>loadToolResultContent('s',ref,'call'));fail=false;await loadToolResultContent('s',ref,'call');assert.equal(calls,4);clearToolResultContentCache();await assert.rejects(()=>loadToolResultContent('s',ref,'wrong'));}finally{globalThis.fetch=saved;clearToolResultContentCache();}
});
