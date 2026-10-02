'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),test=require('node:test');
const folder=path.resolve(__dirname,'..');
test('chat startup defers usage data; explicit ingestion reads remain single-flight',async()=>{
 const calls=[],cache=new Map(),snapshot=JSON.stringify({version:2,generatedAt:'2026-10-02T00:00:00.000Z',snapshotId:'owned-fixture',buckets:[]});
 const context={location:{protocol:'http:',hostname:'127.0.0.1'},console,AbortController,setTimeout,clearTimeout,sessionStorage:{getItem:k=>cache.get(k)||null,setItem:(k,v)=>cache.set(k,v)},fetch:async url=>{calls.push(url);return {ok:true,status:200,text:async()=>snapshot};}};
 context.window=context;context.globalThis=context;vm.createContext(context);
 vm.runInContext(fs.readFileSync(folder+'/usage-ledger-core.js','utf8'),context);
 vm.runInContext(fs.readFileSync(folder+'/pi-usage-panel.js','utf8'),context);await Promise.resolve();
 assert.equal(calls.length,0,'Chat startup must not download the usage ledger');
 const [a,b]=await Promise.all([context.PiUsagePanel.fetchSnapshotOnce(),context.PiUsagePanel.fetchSnapshotOnce()]);
 assert.equal(calls.length,1);assert.match(calls[0],/^\/pi-usage-ledger\.json\?/);assert.equal(a,b);assert.equal(a.snapshotId,'owned-fixture');assert.equal(context.PiUsagePanel.read().snapshotId,'owned-fixture');
 assert.equal(typeof context.PiUsagePanel.refresh,'function','Explicit usage refresh/deletion guard API stays available');
});
