'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
function fixture(){
 const nodes=[],timers=new Map();let next=0;
 const context={Map,Promise,Error,setTimeout:cb=>{timers.set(++next,cb);return next;},clearTimeout:id=>timers.delete(id),document:{createElement:()=>({dataset:{},remove(){this.removed=true;}}),head:{appendChild:n=>nodes.push(n)}}};context.window=context;
 const assets={'xlsx-engine':{path:'/pi-web-assets/xlsx-engine-owned.js',integrity:'sha256-owned'},'usage-panel':{path:'/pi-web-assets/usage-panel-owned.js',integrity:'sha256-panel'}};
 vm.runInNewContext(fs.readFileSync(root+'/lazy-assets.js','utf8').replace('__PI_OPTIONAL_ASSET_MANIFEST__',JSON.stringify(assets)),context);
 return{context,nodes,timers,load:context.__PI_ENH_LOAD_OPTIONAL__};
}
test('startup does not request optional assets; concurrent workbook loads share one integrity-checked request',async()=>{
 const f=fixture();assert.equal(f.nodes.length,0);const a=f.load('xlsx-engine'),b=f.load('xlsx-engine');assert.equal(a,b);assert.equal(f.nodes.length,1);assert.equal(f.nodes[0].integrity,'sha256-owned');
 f.context.XLSX={read:()=>{}};f.nodes[0].onload();assert.equal(await a,f.context.XLSX);assert.equal(await f.load('xlsx-engine'),f.context.XLSX);assert.equal(f.nodes.length,1);assert.equal(f.timers.size,0);
});
test('network failure removes the failed element and allows a successful retry',async()=>{
 const f=fixture(),first=f.load('usage-panel');const rejected=assert.rejects(first,/加载失败/);f.nodes[0].onerror();await rejected;assert(f.nodes[0].removed);assert.equal(f.timers.size,0);
 const second=f.load('usage-panel');assert.equal(f.nodes.length,2);f.context.PiUsagePanel={render:()=>{}};f.nodes[1].onload();assert.equal(await second,f.context.PiUsagePanel);
});
test('missing exports and timeout fail closed and remain retryable; unknown names create no request',async()=>{
 const f=fixture();await assert.rejects(f.load('unregistered'),/未知/);assert.equal(f.nodes.length,0);
 const missing=f.load('xlsx-engine'),rejected=assert.rejects(missing,/初始化失败/);f.nodes[0].onload();await rejected;
 const timeout=f.load('xlsx-engine'),timed=assert.rejects(timeout,/超时/);[...f.timers.values()][0]();await timed;assert(f.nodes[1].removed);assert.equal(f.nodes[1].onload,null);assert.equal(f.timers.size,0);
 const retry=f.load('xlsx-engine');f.context.XLSX={read:()=>{}};f.nodes[2].onload();await retry;
});
test('extracted unchanged workbook engine preserves Chinese sheets, merges, numbers and round-trip parsing',()=>{
 const asset=fs.readFileSync(root+'/assets/xlsx-engine.js');const provenance=JSON.parse(fs.readFileSync(path.join(root,'assets/xlsx-engine.provenance.json')));
 assert.equal(crypto.createHash('sha256').update(asset).digest('hex'),provenance.assetSha256);
 const context={console,ArrayBuffer,Uint8Array,TextDecoder,TextEncoder};context.window=context;vm.runInNewContext(asset.toString(),context);const x=context.XLSX;assert.equal(x.version,'0.20.3');
 const book=x.utils.book_new(),sheet=x.utils.aoa_to_sheet([['验收表',''],['产品','数量'],['中文商品',12.5]]);sheet['!merges']=[{s:{r:0,c:0},e:{r:0,c:1}}];x.utils.book_append_sheet(book,sheet,'中文工作表');x.utils.book_append_sheet(book,x.utils.aoa_to_sheet([['第二页']]),'第二工作表');
 const bytes=x.write(book,{type:'array',bookType:'xlsx'}),parsed=x.read(bytes,{type:'array'});assert.deepEqual(Array.from(parsed.SheetNames),['中文工作表','第二工作表']);assert.equal(parsed.Sheets['中文工作表'].A3.v,'中文商品');assert.equal(parsed.Sheets['中文工作表'].B3.v,12.5);assert.equal(parsed.Sheets['中文工作表']['!merges'][0].e.c,1);
});
