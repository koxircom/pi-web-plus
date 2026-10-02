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

test('real Worker hashes multi-MiB pages off-thread; HEAD IPC has no history body', async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'history-page-fingerprint-'));
  const file=path.join(dir,'fixture.jsonl');
  const entries=[{type:'session',version:3,id:'fixture',cwd:dir,timestamp:'2026-01-01T00:00:00Z'}];
  for(let i=0;i<12;i++) entries.push({id:`e${i}`,parentId:i?`e${i-1}`:null,type:'message',timestamp:'2026-01-01T00:00:00Z',message:{role:'user',content:'x'.repeat(700000)}});
  fs.writeFileSync(file,entries.map(e=>JSON.stringify(e)).join('\n')+'\n');
  const pool=new SessionHistoryPool({workerScriptPath:path.join(process.cwd(),'bin/session-history-worker.cjs'),idleTimeoutMs:2000});
  const options={sessionId:'fixture',before:'e11',tail:10,deferThinking:true,deferToolResultImages:true,includeFingerprint:true};
  try {
    const get=await pool.queryContextResult(file,options);
    assert.ok(Buffer.byteLength(get.jsonString)>6*1024*1024);
    assert.equal(get.fingerprint,createHash('sha256').update(HISTORY_CACHE_SCOPE).update(get.jsonString).digest('hex'));
    const head=await pool.queryContextResult(file,{...options,fingerprintOnly:true});
    assert.equal(head.jsonString,'');
    assert.equal(head.fingerprint,get.fingerprint);
    assert.equal(await pool.queryContext(file,{...options,includeFingerprint:false}),get.jsonString);
    fs.appendFileSync(file,JSON.stringify({id:'e12',parentId:'e11',type:'message',timestamp:'2026-01-01T00:00:00Z',message:{role:'user',content:'new tail'}})+'\n');
    const appended=await pool.queryContextResult(file,{...options,fingerprintOnly:true});
    assert.equal(appended.fingerprint,get.fingerprint);
  } finally {
    await pool.closeAll();
    fs.rmSync(dir,{recursive:true,force:true});
  }
});
