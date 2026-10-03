import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createJiti } from 'jiti';
const jiti = createJiti(import.meta.url, { alias: { '@': process.cwd() }, interopDefault: true });
const { POST } = await jiti.import('./route.ts');
const { cacheSessionPath, invalidateSessionListCache, invalidateSessionPathCache } = await jiti.import('../../../../lib/session-reader.ts');
const { loadUsageDeleteGuard } = await jiti.import('../../../../lib/usage-delete-guard.ts');
const post = ids => POST(new Request('http://localhost/api/sessions/batch-delete', { method: 'POST', body: JSON.stringify({ ids }) }));
async function fixture(t) {
 const root = await mkdtemp(join(tmpdir(), 'pi-batch-delete-'));
 const dir = join(root,'sessions','fixture-workspace'); await mkdir(dir,{recursive:true});
 const keys = ['PI_CODING_AGENT_DIR','PI_SESSIONS_DIR','PI_USAGE_DATA_DIR'];
 const previous = keys.map(key => process.env[key]);
 process.env.PI_CODING_AGENT_DIR = root; process.env.PI_SESSIONS_DIR = join(root,"sessions"); delete process.env.PI_USAGE_DATA_DIR;
 const previousOptions = globalThis.__piUsageDeleteGuardDefaultOptions;
 globalThis.__piUsageDeleteGuardDefaultOptions = { stateFile: join(root,'usage-state.json'), outputFile: join(root,'usage-output.json'), sessionsRoot: join(root,'sessions') };
 invalidateSessionListCache();
 const paths = new Map();
 const add = async (id, parentId, subagent = false, padding = '') => {
  const path = join(dir,id+'.jsonl'); paths.set(id,path);
  const header = { type:'session', version:3, id, timestamp:'2026-01-01T00:00:00.000Z',cwd:dir, ...(parentId ? {parentSession:paths.get(parentId)} : {}) };
  const entries = [header];
  if(subagent) entries.push({type:'custom',id:'meta',parentId:null,timestamp:header.timestamp,customType:'pi-web:subagent',data:{version:1,parentSessionId:parentId,parentSessionPath:paths.get(parentId),profile:'Explore',description:'隔离验收'}});
  if(padding) entries.push({type:'message',id:'user',parentId:null,timestamp:header.timestamp,message:{role:'user',content:padding,timestamp:Date.now()}});
  await writeFile(path,entries.map(e=>JSON.stringify(e)).join('\n')+'\n'); cacheSessionPath(id,path); return path;
 };
 t.after(async()=>{
  for(let i=0;i<keys.length;i++) { if(previous[i]===undefined) delete process.env[keys[i]]; else process.env[keys[i]]=previous[i]; }
  globalThis.__piUsageDeleteGuardDefaultOptions=previousOptions;
  for(const id of paths.keys()) invalidateSessionPathCache(id);
  invalidateSessionListCache(); await rm(root,{recursive:true,force:true});
 });
 return {dir,paths,add};
}
test('six-session batch seals once, keeps unrelated long history, and missing/duplicate IDs are idempotent', async t => {
 const f=await fixture(t); for(let i=0;i<6;i++) await f.add('batch-'+i);
 const survivor=await f.add('survivor',undefined,false,'long history '.repeat(100000));
 const before=await readFile(survivor);
 const guard=loadUsageDeleteGuard(); const original=guard.sealAndDeleteSync; let calls=0;
 guard.sealAndDeleteSync=(targets,...args)=>{calls++;assert.equal(targets.size,6);return original(targets,...args)};
 t.after(()=>guard.sealAndDeleteSync=original);
 const started=performance.now(); const response=await post([...f.paths.keys()].slice(0,6).concat('batch-0','missing'));
 assert.equal(response.status,200); const payload=await response.json();
 assert.equal(payload.results.length,7);assert(payload.results.every(r=>r.ok),JSON.stringify(payload));assert.equal(calls,1);assert.equal(payload.deletedSessionIds.length,6);
 for(let i=0;i<6;i++) await assert.rejects(readFile(f.paths.get('batch-'+i)),{code:'ENOENT'});
 assert.deepEqual(await readFile(survivor),before);
 console.log(JSON.stringify({batchSize:6,sealWorkers:calls,elapsedMs:Math.round(performance.now()-started),survivorBytes:before.length}));
});
test('batch handles selected ancestors/descendants and reattaches surviving forks to closest surviving ancestor',async t=>{
 const f=await fixture(t);await f.add('grandparent');await f.add('parent','grandparent');await f.add('fork','parent');await f.add('leaf','fork');await f.add('agent','parent',true);await f.add('agent-child','agent',true);
 const payload=await (await post(['parent','fork','agent'])).json();assert(payload.results.every(r=>r.ok),JSON.stringify(payload));
 for(const id of ['parent','fork','agent','agent-child'])await assert.rejects(readFile(f.paths.get(id)),{code:'ENOENT'});
 const header=JSON.parse((await readFile(f.paths.get('leaf'),'utf8')).split('\n')[0]);assert.equal(header.parentSession,f.paths.get('grandparent'));
});
test('sealing failure reports failure and preserves every target',async t=>{
 const f=await fixture(t);await f.add('keep-a');await f.add('keep-b');
 const guard=loadUsageDeleteGuard(),original=guard.sealAndDeleteSync;guard.sealAndDeleteSync=()=>{throw Error('isolated seal failure')};t.after(()=>guard.sealAndDeleteSync=original);
 const payload=await(await post(['keep-a','keep-b'])).json();assert(payload.results.every(r=>!r.ok));assert.deepEqual(payload.deletedSessionIds,[]);
 for(const path of f.paths.values())assert((await readFile(path)).length>0);
});
test('invalid batches are rejected before disk mutation',async()=>{
 for(const ids of [[],['../escape'],[null],Array(101).fill('a')])assert.equal((await post(ids)).status,400);
});
