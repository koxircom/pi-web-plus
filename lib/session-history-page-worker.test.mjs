import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createJiti} from 'jiti';
const jiti=createJiti(import.meta.url,{alias:{'@':process.cwd()},moduleCache:false});
const {SessionHistoryPool}=await jiti.import('./session-history-pool.ts');
const {HISTORY_CACHE_SCOPE}=await jiti.import('./session-history-page-cache.ts');

test('real Worker projects disk detail and hashes multi-MiB pages off-thread', async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'history-page-fingerprint-'));
  const file=path.join(dir,'fixture.jsonl');
  fs.writeFileSync(file,JSON.stringify({type:'session',version:3,id:'fixture',cwd:dir,timestamp:'2026-01-01T00:00:00Z'})+'\n');
  const largeContent='x'.repeat(700000);
  for(let i=0;i<100;i++) fs.appendFileSync(file,JSON.stringify({id:`e${i}`,parentId:i?`e${i-1}`:null,type:'message',timestamp:'2026-01-01T00:00:00Z',message:{role:'user',content:largeContent}})+'\n');
  const fileBytes=fs.statSync(file).size;
  assert.ok(fileBytes>64*1024*1024,`fixture must cross the original 64 MiB cache boundary (${fileBytes} bytes)`);
  const pool=new SessionHistoryPool({workerScriptPath:path.join(process.cwd(),'bin/session-history-worker.cjs'),idleTimeoutMs:2000});
  const options={sessionId:'fixture',before:'e11',tail:10,deferThinking:true,deferToolResultImages:true,includeFingerprint:true};
  try {
    const detailOptions={sessionId:'fixture',sourceId:'disk',summaryTree:true,deferThinking:true,deferToolResultImages:true,tail:1};
    let heartbeatTicks=0;
    const heartbeat=setInterval(()=>{heartbeatTicks++;},10);
    const startedAt=performance.now();
    let detail;
    try { detail=await pool.querySessionDetailResult(file,detailOptions); }
    finally { clearInterval(heartbeat); }
    const elapsedMs=Math.round(performance.now()-startedAt);
    console.log('session detail worker heartbeat',JSON.stringify({fileBytes,heartbeatTicks,elapsedMs}));
    assert.ok(heartbeatTicks>0,'main-thread timer should run while the detail Worker parses and projects the large file');
    assert.equal(typeof detail.fingerprint,'string');
    const detailSnapshot=JSON.parse(detail.jsonString);
    assert.equal(detailSnapshot.stats.totalMessages,100);
    assert.equal(detailSnapshot.leafId,'e99');
    assert.deepEqual(detailSnapshot.context.entryIds,['e99']);
    const cachedDetail=await pool.querySessionDetailResult(file,detailOptions);
    assert.equal(cachedDetail.fingerprint,detail.fingerprint);
    fs.appendFileSync(file,JSON.stringify({id:'e100',parentId:'e99',type:'message',timestamp:'2026-01-01T00:00:00Z',message:{role:'user',content:'new detail'}})+'\n');
    const refreshedDetail=await pool.querySessionDetailResult(file,detailOptions);
    assert.notEqual(refreshedDetail.fingerprint,detail.fingerprint);
    assert.equal(JSON.parse(refreshedDetail.jsonString).stats.totalMessages,101);
    assert.equal(JSON.parse(refreshedDetail.jsonString).leafId,'e100');
    assert.deepEqual(JSON.parse(refreshedDetail.jsonString).context.entryIds,['e100']);

    const get=await pool.queryContextResult(file,options);
    assert.ok(Buffer.byteLength(get.jsonString)>6*1024*1024);
    assert.equal(get.fingerprint,createHash('sha256').update(HISTORY_CACHE_SCOPE).update(get.jsonString).digest('hex'));
    const head=await pool.queryContextResult(file,{...options,fingerprintOnly:true});
    assert.equal(head.jsonString,'');
    assert.equal(head.fingerprint,get.fingerprint);
    assert.equal(await pool.queryContext(file,{...options,includeFingerprint:false}),get.jsonString);
    fs.appendFileSync(file,JSON.stringify({id:'e101',parentId:'e100',type:'message',timestamp:'2026-01-01T00:00:00Z',message:{role:'user',content:'new tail'}})+'\n');
    const appended=await pool.queryContextResult(file,{...options,fingerprintOnly:true});
    assert.equal(appended.fingerprint,get.fingerprint);
  } finally {
    await pool.closeAll();
    fs.rmSync(dir,{recursive:true,force:true});
  }
});
