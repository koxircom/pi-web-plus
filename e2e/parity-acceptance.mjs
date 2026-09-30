// Runs only against its own isolated loopback server and disposable agent directory.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtempSync,mkdirSync,writeFileSync,createWriteStream,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'node:net';
import {createRequire} from 'node:module';
const {createStateStore}=createRequire(import.meta.url)('../lib/enhancement-state-store.cjs');
import {setTimeout as delay} from 'node:timers/promises';
import {chromium} from 'playwright';
const root=dirname(dirname(fileURLToPath(import.meta.url)));
const imagesOnly=process.argv.includes('--images-only');
const artifacts=join(root,'test-results/parity');mkdirSync(artifacts,{recursive:true});
const agent=mkdtempSync(join(tmpdir(),'pi-parity-'));const project=join(agent,'project');const sessions=join(agent,'sessions','parity');
mkdirSync(project);mkdirSync(sessions,{recursive:true});
const stamp='2026-09-27T00:00:00.000Z';
const PNG='iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAA2SURBVGhD7cExAQAAAMKg9U9tCU+gAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA4NcAARAAAb89lBcAAAAASUVORK5CYII=';
const msg=(id,parentId,role,content,extra={})=>({type:'message',id,parentId,timestamp:stamp,message:{role,content,timestamp:Date.parse(stamp),...extra}});
function seed(id,entries){writeFileSync(join(sessions,`${id}.jsonl`),[{type:'session',version:3,id,timestamp:stamp,cwd:project},...entries].map(JSON.stringify).join('\n')+'\n');}
seed('parity-history',Array.from({length:120},(_,i)=>msg(`e${i}`,i?`e${i-1}`:null,i%2?'assistant':'user',`Parity history ${i}`)));
seed('parity-rich',[
 msg('user',null,'user',[{type:'text',text:'Parity picture question'},{type:'image',data:PNG,mimeType:'image/png'}]),
 msg('call','user','assistant',[{type:'thinking',thinking:'Parity private process'},{type:'text',text:'Parity public intermediate output'},{type:'toolCall',id:'t1',name:'bash',arguments:{command:'echo parity'}}]),
 msg('result','call','toolResult',[{type:'text',text:'Parity tool result'}],{toolCallId:'t1',toolName:'bash',isError:false}),
 msg('answer','result','assistant',[{type:'text',text:'Parity final answer'}]),
]);
let server,browser,context,page,serverExit;const log=createWriteStream(join(artifacts,'server.log'));
const checks=[];let base;const errors=[];
try{
 const probe=createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');const port=probe.address().port;await new Promise(r=>probe.close(r));
 assert.ok(![30141,30142,30149].includes(port));base=`http://127.0.0.1:${port}`;
 server=spawn(process.execPath,[join(root,'node_modules/next/dist/bin/next'),'start','-H','127.0.0.1','-p',String(port)],{cwd:root,env:{...process.env,PI_CODING_AGENT_DIR:agent,PI_WEB_PASSWORD:'',NEXT_TELEMETRY_DISABLED:'1'},stdio:['ignore','pipe','pipe']});
 serverExit=once(server,'exit');server.stdout.pipe(log,{end:false});server.stderr.pipe(log,{end:false});
 for(let n=0;n<80;n++){if((await fetch(base+'/api/sessions').catch(()=>null))?.ok)break;assert.equal(server.exitCode,null);await delay(250);}
 const api=async(path,body)=>{assert.equal(new URL(base).hostname,'127.0.0.1');const r=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});const json=await r.json();return {status:r.status,data:json.success===true?json.data:json};};
 const subagentSettings=await(await fetch(base+'/api/subagents/settings')).json();assert.ok(Object.hasOwn(subagentSettings,'subagentModel'),'compiled core must expose selected subagent model capability');checks.push('compiled subagent settings exposes subagentModel capability');
 const queue=await api('/api/agent/parity-rich',{type:'get_queue_actions'});assert.equal(queue.status,200);assert.equal(queue.data.version,2);assert.deepEqual(queue.data.followUp,[]);
 for(const type of ['get_queued_message','promote_queued_message','recall_queued_message','delete_queued_message']){const r=await api('/api/agent/parity-rich',{type,token:'stale-fixture-token'});assert.ok(r.status>=400);assert.doesNotMatch(JSON.stringify(r.data),/unknown command/i);assert.match(JSON.stringify(r.data),type==='promote_queued_message'?/token|not streaming/i:/token/i);}
 const drain=await api('/api/agent/parity-rich',{type:'recall_all_queued_messages',tokens:[]});assert.equal(drain.status,200);assert.deepEqual(drain.data.entries,[]);checks.push('6 compiled queue RPCs and stale-token rejection');
 const image={type:'image',data:PNG,mimeType:'image/png'};
 assert.equal((await api('/api/agent/parity-rich',{type:'follow_up',message:'Parity queued image',images:[image,image]})).status,200);
 const queued=(await api('/api/agent/parity-rich',{type:'get_queue_actions'})).data;
 assert.equal(queued.followUp[0].imageCount,2);
 const item=(await api('/api/agent/parity-rich',{type:'get_queued_message',token:queued.followUp[0].token})).data;assert.deepEqual(item.images.map(i=>i.data),[PNG,PNG]);
 const recalled=(await api('/api/agent/parity-rich',{type:'recall_queued_message',token:queued.followUp[0].token})).data;assert.deepEqual(recalled.images.map(i=>i.data),[PNG,PNG]);
 assert.deepEqual((await api('/api/agent/parity-rich',{type:'get_queue_actions'})).data.followUp,[]);checks.push('real SDK follow-up enqueue, token detail and two-image recall (no model execution)');
 browser=await chromium.launch({headless:true});
 if(!imagesOnly){
 // Native hydration control: replay progress before the bounded IndexedDB read
 // resolves. The legacy epoch matcher would cancel this first read permanently.
 context=await browser.newContext({viewport:{width:1280,height:844},serviceWorkers:'block'});
 await context.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.fulfill({json:{}}));
 await context.route('**/pi-web-enhancements.js*',route=>route.fulfill({contentType:'application/javascript',body:''}));
 await context.addInitScript(()=>{const original=indexedDB.open.bind(indexedDB);indexedDB.open=(name,...args)=>{if(name==='pi-enh-session-wire-v1'){window.__parityDiskWait=true;return {};}return original(name,...args);};});
 let replayed=0;
 await context.route('**/api/agent/parity-history/events*',route=>{replayed++;return route.fulfill({contentType:'text/event-stream',body:[{type:'connected',sessionId:'parity-history',isStreaming:true},{type:'agent_start'},{type:'tool_execution_start',toolCallId:'replay',toolName:'bash',args:{command:'echo replay'}},{type:'tool_execution_update',toolCallId:'replay',toolName:'bash',partialResult:{content:[{type:'text',text:'progress'}]}}].map(e=>'data: '+JSON.stringify(e)+'\n\n').join('')});});
 page=await context.newPage();page.setDefaultTimeout(15000);await context.tracing.start({screenshots:true,snapshots:true});
 await page.goto(base+'/?session=parity-history',{waitUntil:'domcontentloaded'});await page.getByText('Parity history 119',{exact:true}).waitFor();
 assert.ok(replayed>0);assert.equal(await page.evaluate(()=>window.__parityDiskWait),true);checks.push('native cold history survives initial SSE replay while IndexedDB is pending');
 await context.tracing.stop();await context.close();context=null;page=null;
 }
 for(const width of (process.argv.includes('--state-only')?[]:[1280,390])){
  context=await browser.newContext({viewport:{width,height:844},locale:'en-US',serviceWorkers:'block'});
  await context.route('**/*',route=>{const u=new URL(route.request().url());if(u.origin===base||!/^https?:$/.test(u.protocol))return route.continue();return route.fulfill({json:{state:{},revision:0,available:false,settings:{}}});});
  await context.addInitScript(()=>{localStorage.setItem('pi-language','en');});
  page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));
  await context.tracing.start({screenshots:true,snapshots:true});
  if(!imagesOnly){
  await page.goto(base+'/?session=parity-history',{waitUntil:'domcontentloaded'});
  await page.getByText('Parity history 119',{exact:true}).waitFor();
  await page.waitForFunction(()=>typeof window.__PI_ENH_GET_HISTORY_STATE__==='function'&&typeof window.__PI_ENH_SET_PLUGIN__==='function');
  const before=await page.evaluate(()=>window.__PI_ENH_GET_HISTORY_STATE__());assert.equal(before.sessionId,'parity-history');assert.ok(before.entryIds.includes('e119'));
  if(before.hasEarlierMessages){await page.evaluate(async()=>{for(let i=0;i<30;i++){const s=window.__PI_ENH_GET_HISTORY_STATE__();if(!s.hasEarlierMessages||s.entryIds.includes('e0'))break;await window.__PI_ENH_LOAD_EARLIER__(500,'parity-test');await new Promise(r=>setTimeout(r,50));}});await page.waitForFunction(()=>window.__PI_ENH_GET_HISTORY_STATE__().entryIds.includes('e0'));}
  const history=await page.evaluate(()=>window.__PI_ENH_GET_HISTORY_STATE__());assert.deepEqual(history.entryIds,Array.from({length:120},(_,i)=>`e${i}`));
  const sidebar=await page.evaluate(()=>{window.__PI_ENH_TOGGLE_SESSION_UNREAD__('parity-rich',true);return {count:window.__PI_ENH_GET_RAW_SESSIONS__().length};});assert.equal(sidebar.count,2);
  await page.waitForFunction(()=>window.__PI_ENH_IS_SESSION_UNREAD__('parity-rich')===true);
  await page.evaluate(()=>window.__PI_ENH_TOGGLE_SESSION_UNREAD__('parity-rich',false));
  await page.waitForFunction(()=>window.__PI_ENH_IS_SESSION_UNREAD__('parity-rich')===false);
  const boxes=await page.locator('[data-entry-id]:not([data-message-role])').evaluateAll(es=>es.filter(e=>e.getBoundingClientRect().height>0).slice(-4).map(e=>{const b=e.getBoundingClientRect();return {y:b.y,bottom:b.bottom};}));assert.ok(boxes.length>=4);for(let i=1;i<boxes.length;i++)assert.ok(boxes[i].y>=boxes[i-1].bottom,'adjacent history messages must not overlap');
  await page.screenshot({path:join(artifacts,`history-${width}.png`)});checks.push(`${width}px: history bridge order/pagination, sidebar unread, 4-message geometry`);
  }
  await page.goto(base+'/?session=parity-rich',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>typeof window.__PI_ENH_SET_PLUGIN__==='function');
  await page.getByText('Parity final answer',{exact:true}).waitFor();await page.getByText('Parity public intermediate output',{exact:true}).waitFor();
  const process=page.locator('[data-pi-enh-native-process]');await process.waitFor();
  await page.evaluate(()=>window.__PI_ENH_SET_PLUGIN__('task-tool-auto-collapse',false));await page.waitForFunction(()=>window.__PI_ENH_IS_PLUGIN_ENABLED__('task-tool-auto-collapse')===false);
  // Disabled enhancement retains the native ProcessDetails control, which must still work.
  await process.locator('button').first().click();await page.getByText('Parity public intermediate output',{exact:true}).waitFor();
  await page.evaluate(()=>window.__PI_ENH_SET_PLUGIN__('task-tool-auto-collapse',true));await process.waitFor();await page.getByText('Parity public intermediate output',{exact:true}).waitFor();checks.push(`${width}px: process toggle, native fallback, and public-output preservation`);
  const delivered=page.locator('[data-message-role="user"] img').first();await delivered.waitFor();await delivered.dblclick();await page.locator('dialog.pi-enh-image-zoom-dialog').waitFor();await page.keyboard.press('Escape');
  const fileInput=page.locator('input[type=file][accept*="image"]').first();
  const candidates=page.locator('button[aria-haspopup="dialog"] img');
  await fileInput.setInputFiles([{name:'existing.png',mimeType:'image/png',buffer:Buffer.from(PNG,'base64')}]);
  await page.locator('.pi-enh-formatted-composer:visible, textarea:visible').first().fill('existing draft');
  await page.evaluate(async image=>{const response=await fetch('/api/agent/parity-rich',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:'follow_up',message:'Parity queued images',images:[image,image]})});if(!response.ok)throw new Error('Fixture enqueue failed: '+await response.text());},image);
  await page.locator('.pi-enh-queue-row').waitFor();
  await page.evaluate(()=>window.__PI_ENH_SET_PLUGIN__('composer-queue-panel',false));
  const imageCount=await candidates.count();
  const recallButton=page.getByRole('button',{name:/Recall|移回输入框/}).first();
  await recallButton.waitFor();
  await page.screenshot({path:join(artifacts,`native-queue-${width}.png`)});
  const composerGeometry=await recallButton.evaluate(button=>{const composer=button.closest('.pi-enh-cursor-composer'),items=[];const visit=e=>{if(getComputedStyle(e).display==='contents'){Array.from(e.children).forEach(visit);return;}const r=e.getBoundingClientRect();if(r.height>0&&r.width>0)items.push({class:e.className,tag:e.tagName,y:r.y,bottom:r.bottom,x:r.x,right:r.right,height:r.height});};Array.from(composer.children).forEach(visit);return items;});
  writeFileSync(join(artifacts,`native-queue-${width}.json`),JSON.stringify(composerGeometry,null,2));
  assert.ok(composerGeometry.length>=4,'measure native queue and at least three sibling blocks');
  for(let i=0;i<composerGeometry.length;i++)for(let j=i+1;j<composerGeometry.length;j++){const a=composerGeometry[i],b=composerGeometry[j];const x=Math.min(a.right,b.right)-Math.max(a.x,b.x),y=Math.min(a.bottom,b.bottom)-Math.max(a.y,b.y);assert.ok(x<=0||y<=0,`composer siblings overlap: ${JSON.stringify({a,b})}`);}
  const queueGeometry=await recallButton.evaluate(button=>{const q=button.parentElement.parentElement.getBoundingClientRect();const c=button.closest('.pi-enh-cursor-composer').getBoundingClientRect();return {queue:q.width,composer:c.width};});
  assert.ok(queueGeometry.queue>=queueGeometry.composer*0.8,`native queue must remain full-width: ${JSON.stringify(queueGeometry)}`);
  let releaseRecall;
  const recallGate=new Promise(resolve=>releaseRecall=resolve);
  const recallStarted=page.waitForRequest(request=>request.method()==='POST'&&new URL(request.url()).pathname==='/api/agent/parity-rich'&&request.postDataJSON()?.type==='recall_all_queued_messages');
  const holdRecall=async route=>{if(route.request().method()==='POST'&&route.request().postDataJSON()?.type==='recall_all_queued_messages'){await recallGate;return route.continue();}return route.fallback();};
  await context.route('**/api/agent/parity-rich',holdRecall);
  await recallButton.click();await recallStarted;
  await fileInput.setInputFiles(Array.from({length:8},(_,i)=>({name:`during-recall-${i}.png`,mimeType:'image/png',buffer:Buffer.from(PNG,'base64')})));
  await page.waitForFunction(n=>document.querySelectorAll('button[aria-haspopup="dialog"] img').length===n+8,imageCount);
  releaseRecall();
  await page.waitForFunction(n=>document.querySelectorAll('button[aria-haspopup="dialog"] img').length===n+10,imageCount);
  await context.unroute('**/api/agent/parity-rich',holdRecall);
  assert.equal(await page.locator('.pi-enh-cursor-send:visible').first().isDisabled(),true);
  await page.screenshot({path:join(artifacts,`over-capacity-${width}.png`)});
  for(let i=0;i<8;i++)await page.locator('.pi-enh-cursor-attachments > div > button:not([aria-haspopup])').last().click();
  assert.equal(await candidates.count(),imageCount+2);
  assert.match(await page.locator('textarea').first().inputValue(),/Parity queued images[\s\S]*existing draft/);
  checks.push(`${width}px: delayed recall plus concurrent attachment intake preserves all 11 images, blocks over-limit send, and recovers after removal`);
  assert.deepEqual((await api('/api/agent/parity-rich',{type:'get_queue_actions'})).data.followUp,[]);checks.push(`${width}px: native recall preserves queued pictures and existing draft with enhancement off`);
  await page.evaluate(()=>window.__PI_ENH_SET_PLUGIN__('composer-queue-panel',true));
  let count=await candidates.count();await fileInput.setInputFiles([{name:'one.png',mimeType:'image/png',buffer:Buffer.from(PNG,'base64')},{name:'two.png',mimeType:'image/png',buffer:Buffer.from(PNG,'base64')}]);
  await page.waitForFunction(n=>document.querySelectorAll('button[aria-haspopup="dialog"] img').length===n+2,count);
  for(const kind of ['paste','drop']){count=await candidates.count();await page.evaluate(({kind,png})=>{const dt=new DataTransfer();const bytes=Uint8Array.from(atob(png),c=>c.charCodeAt(0));for(let i=0;i<2;i++)dt.items.add(new File([bytes],`${kind}-${i}.png`,{type:'image/png'}));const target=Array.from(document.querySelectorAll('.pi-enh-formatted-composer, textarea')).find(e=>e.getBoundingClientRect().height>0&&getComputedStyle(e).display!=='none');if(!target)throw new Error('No visible composer editor');target.focus();target.dispatchEvent(kind==='paste'?new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:dt}):new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:dt}));},{kind,png:PNG});await page.waitForFunction(n=>document.querySelectorAll('button[aria-haspopup="dialog"] img').length===n+2,count);}
  checks.push(`${width}px: delivered-image double click, multi-image paste and drop`);
  await candidates.last().waitFor();
  // The last two image triggers are the local draft attachments, not sent messages.
  await candidates.last().click();await page.locator('dialog.pi-enh-image-zoom-dialog.is-editing').waitFor();assert.equal(await page.locator('dialog[open]').count(),1);
  await page.locator('[data-image-editor-action="cancel"]').click();if(await page.locator('[data-confirm-action="discard"]').isVisible())await page.locator('[data-confirm-action="discard"]').click();
  await page.waitForFunction(()=>!document.querySelector('dialog[open]'));checks.push(`${width}px: multi-file input and native composer image editor`);
  await page.evaluate(()=>window.__PI_OPEN_SETTINGS__('general'));await page.waitForFunction(()=>document.querySelector('[role="dialog"]'));
  await page.screenshot({path:join(artifacts,`settings-${width}.png`)});await page.keyboard.press('Escape');checks.push(`${width}px: native settings bridge`);
  await page.screenshot({path:join(artifacts,`rich-${width}.png`)});
  await context.tracing.stop();await context.close();context=null;page=null;
 }
 if(!imagesOnly){
 // Reuse the old journal schema only in this disposable agent directory. No migration
 // or initialization API exists in the application; production state is never touched.
 assert.ok(agent.startsWith(join(tmpdir(),'pi-parity-')));
 let head=await fetch(base+'/api/enhancement-state',{method:'HEAD'});assert.equal(head.status,200);assert.equal(head.headers.get('x-pi-enhancement-state'),'absent');
 if(!existsSync(join(agent,'models.json')))writeFileSync(join(agent,'models.json'),JSON.stringify({providers:{}}));
 createStateStore({agentDir:agent}).initializeFromLegacy();
 head=await fetch(base+'/api/enhancement-state',{method:'HEAD'});assert.equal(head.headers.get('x-pi-enhancement-state'),'present');
 const stateContexts=[];const statePages=[];const foreignStateRequests=[];
 for(let device=0;device<2;device++){
  context=await browser.newContext({viewport:{width:device?390:1280,height:844},serviceWorkers:'block'});stateContexts.push(context);
  await context.route('**/*',route=>{const url=new URL(route.request().url());if(url.origin===base||!/^https?:$/.test(url.protocol))return route.continue();if(/^\/enhancement-state(?:\?|$|\/operations)/.test(url.pathname))foreignStateRequests.push(url.href);return route.fulfill({json:{}});});
  page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));statePages.push(page);
  await context.tracing.start({screenshots:true,snapshots:true});
  await page.goto(base+'/?session=parity-rich',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.__PI_WEB_ENHANCEMENTS_LOADED__&&window.__PI_ENH_NATIVE_STATE_API__===true&&window.__PI_ENH_DURABLE_STATE_ENABLED__===true&&Number(localStorage.getItem('pi-enh-durable-state-rev'))>0);
  if(device===0){
   assert.equal(await page.evaluate(async()=>{window.__PI_ENH_SET_SESSION_COLOR__('parity-rich','red');return window.__PI_ENH_PERSIST_SESSION_COLORS_TO_SERVER__();}),true);
   assert.equal((await(await fetch(base+'/api/enhancement-state')).json()).state.sessionColors['parity-rich'],'red');
   await page.waitForFunction(()=>!Object.keys(localStorage).some(k=>k.startsWith('pi-enh-decoration-op-v2:')));
  }else{
   await page.waitForFunction(()=>JSON.parse(localStorage.getItem('pi-enh-session-colors-v1')||'{}')['parity-rich']==='red');
  }
 }
 assert.equal(await page.evaluate(async()=>{window.__PI_ENH_SET_SESSION_COLOR__('parity-rich','green');return window.__PI_ENH_PERSIST_SESSION_COLORS_TO_SERVER__();}),true);
 assert.equal((await(await fetch(base+'/api/enhancement-state')).json()).state.sessionColors['parity-rich'],'green');
 await statePages[0].evaluate(()=>window.__PI_ENH_SYNC_MANIFEST_SESSION_COLORS__(true));
 writeFileSync(join(artifacts,'state-before-convergence.json'),JSON.stringify(await statePages[0].evaluate(async()=>({native:window.__PI_ENH_NATIVE_STATE_API__,enabled:window.__PI_ENH_DURABLE_STATE_ENABLED__,local:JSON.parse(localStorage.getItem('pi-enh-session-colors-v1')||'{}'),revision:localStorage.getItem('pi-enh-durable-state-rev'),outbox:Object.keys(localStorage).filter(k=>k.startsWith('pi-enh-decoration-op-v2:')),remote:await(await fetch('/api/enhancement-state')).json()})),null,2));
 await statePages[0].waitForFunction(()=>JSON.parse(localStorage.getItem('pi-enh-session-colors-v1')||'{}')['parity-rich']==='green');
 checks.push('same-origin durable state: capability before bootstrap, isolated desktop/mobile contexts converge, ACK drains outbox');
 await context.route('**/api/enhancement-state/operations*',route=>route.fulfill({status:503,json:{ok:false,error:'TEST_OFFLINE'}}));
 await page.evaluate(()=>window.__PI_ENH_SET_SESSION_COLOR__('parity-rich','yellow'));
 assert.equal(await page.evaluate(()=>window.__PI_ENH_PERSIST_SESSION_COLORS_TO_SERVER__()),false);
 assert.ok(await page.evaluate(()=>Object.keys(localStorage).some(k=>k.startsWith('pi-enh-decoration-op-v2:'))));
 assert.equal((await (await fetch(base+'/api/enhancement-state')).json()).state.sessionColors['parity-rich'],'green');
 await context.unroute('**/api/enhancement-state/operations*');
 assert.equal(await page.evaluate(()=>window.__PI_ENH_PERSIST_SESSION_COLORS_TO_SERVER__()),true);
 await page.waitForFunction(()=>!Object.keys(localStorage).some(k=>k.startsWith('pi-enh-decoration-op-v2:')));
 assert.equal((await (await fetch(base+'/api/enhancement-state')).json()).state.sessionColors['parity-rich'],'yellow');
 assert.deepEqual(foreignStateRequests,[]);checks.push('failed durable POST preserves outbox and server state; retry commits only with valid ACK; no 30149 state calls');
 for(const ctx of stateContexts){await ctx.tracing.stop();await ctx.close();}context=null;page=null;
 }
 assert.deepEqual(errors,[]);console.log(JSON.stringify({checks,errors},null,2));writeFileSync(join(artifacts,'acceptance.json'),JSON.stringify({checks,errors},null,2));
}catch(e){console.error(e);process.exitCode=1;if(page)await page.screenshot({path:join(artifacts,'failure.png')}).catch(()=>{});if(context)await context.tracing.stop({path:join(artifacts,'trace.zip')}).catch(()=>{});writeFileSync(join(artifacts,'acceptance.json'),JSON.stringify({checks,errors,error:String(e)},null,2));}
finally{await browser?.close();if(server&&server.exitCode===null&&server.signalCode===null){server.kill('SIGTERM');const timer=setTimeout(()=>server.kill('SIGKILL'),10000);await serverExit;clearTimeout(timer);}log.end();rmSync(agent,{recursive:true,force:true});}
