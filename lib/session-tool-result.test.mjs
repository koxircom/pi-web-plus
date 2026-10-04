import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync,writeFileSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createJiti } from 'jiti';
const jiti=createJiti(import.meta.url);
const {deferLargeToolResult,toolResultBodyRevision}=await jiti.import('./session-tool-result.ts');
const {entryToUiMessage}=await jiti.import('./session-context.ts');
const {SessionHistoryIndexer}=await jiti.import('./session-history-indexer.ts');
const {handleToolResultRequest}=await jiti.import('./session-tool-result-service.ts');
const full={role:'toolResult',toolCallId:'call',toolName:'apply_patch',content:[{type:'text',text:'完整输出中文\n'.repeat(3000)},{type:'image',source:{type:'url',url:'/image'}}],isError:false,timestamp:123,details:{result:{appliedFiles:['a.ts'],failures:['partial']},preview:{files:[]}}};
const entry={type:'message',id:'e',parentId:null,timestamp:'2026-10-04T00:00:00Z',message:full};
test('projection retains status images and details; legacy remains complete',()=>{
 const compact=deferLargeToolResult(full,'e'); assert.deepEqual(compact.content,[full.content[1]]);assert.equal(compact.details,full.details);assert.equal(compact.isError,false);assert.equal(compact.deferredResult.revision,toolResultBodyRevision(full));assert.ok(JSON.stringify(compact).length<JSON.stringify(full).length/20);
 for(const m of [{...full,inProgress:true},{...full,details:{kind:'pi-web-subagent'}}])assert.equal(deferLargeToolResult(m,'e'),m);
 assert.deepEqual(entryToUiMessage(entry,{}),full);assert.ok(entryToUiMessage(entry,{sessionId:'s',deferToolResults:true}).deferredResult);
});
test('one-entry disk read returns exact requested entry and rejects missing cursor',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'tool-detail-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const file=join(dir,'s.jsonl');
 const rows=[{type:'session',version:3,id:'s',timestamp:'2026-10-04T00:00:00Z',cwd:'/tmp'},...Array.from({length:50},(_,i)=>({...entry,id:`e${i}`,parentId:i?`e${i-1}`:null}))];writeFileSync(file,rows.map(JSON.stringify).join('\n')+'\n');
 const indexer=new SessionHistoryIndexer();const data=JSON.parse((await indexer.queryContext(file,{leafId:'e49',onlyEntry:true,requireCursor:true})));assert.deepEqual(data.context.entryIds,['e49']);assert.deepEqual(data.context.messages,[full]);await assert.rejects(()=>indexer.queryContext(file,{leafId:'missing',onlyEntry:true,requireCursor:true}));
});
test('read-only service returns complete result and guards identity, revision, deletion and cancellation',async()=>{
 const revision=toolResultBodyRevision(full);let calls=0;
 const deps={getRpc:()=>undefined,resolvePath:async()=>'/fixture',pool:{queryContextResult:async(_p,o)=>{calls++;assert.equal(o.onlyEntry,true);assert.equal(o.requireCursor,true);return {jsonString:JSON.stringify({context:{messages:[full],entryIds:['e']}})};}}};
 const req=(rev=revision)=>new Request(`http://localhost/api?revision=${rev}`);
 const response=await handleToolResultRequest(req(),{id:'s',entryId:'e'},deps);assert.equal(response.status,200);assert.deepEqual((await response.json()).result,full);
 assert.equal((await handleToolResultRequest(req('b'.repeat(64)),{id:'s',entryId:'e'},deps)).status,409);
 assert.equal((await handleToolResultRequest(req('bad'),{id:'s',entryId:'e'},deps)).status,400);
 assert.equal((await handleToolResultRequest(req(),{id:'s',entryId:'x'},deps)).status,404);
 assert.equal((await handleToolResultRequest(req(),{id:'s',entryId:'e'},{...deps,resolvePath:async()=>null})).status,404);
 const ac=new AbortController();ac.abort();assert.equal((await handleToolResultRequest(new Request(req(),{signal:ac.signal}),{id:'s',entryId:'e'},deps)).status,499);
 let rpc;const changed={...deps,getRpc:()=>rpc,pool:{queryContextResult:async()=>{rpc={isAlive:()=>true,isRunning:()=>true};return {jsonString:JSON.stringify({context:{messages:[full],entryIds:['e']}})};}}};assert.equal((await handleToolResultRequest(req(),{id:'s',entryId:'e'},changed)).status,409);
 const live={isAlive:()=>true,isRunning:()=>true,inner:{sessionManager:{getEntries:()=>[entry]}}};assert.equal((await handleToolResultRequest(req(),{id:'s',entryId:'e'},{getRpc:()=>live})).status,200);
});
