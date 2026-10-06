const fs=require('fs'),a=require('assert/strict'),{chromium}=require('playwright');
const origin=process.env.PI_WEB_TEST_ORIGIN,cwd=process.env.PI_WEB_TEST_CWD,D=process.env.PI_WEB_TEST_OUTPUT;
a(origin&&cwd&&D,'Explicit isolated fixture required');fs.mkdirSync(D,{recursive:true});
a.equal(new URL(origin).hostname,'127.0.0.1');a(cwd.endsWith('/fixture/workspace'));
const out={version:'1.3.27',checks:[],sessions:[],errors:[]};const save=()=>fs.writeFileSync(D+'/BROWSER_RECEIPT.json',JSON.stringify(out,null,2));
async function post(path,b){const r=await fetch(origin+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});const j=await r.json();a(r.ok,JSON.stringify(j));a.notEqual(j.success,false,JSON.stringify(j));return j;}
(async()=>{const browser=await chromium.launch({headless:true,args:['--no-sandbox']});let page;try{for(const mobile of [false,true]){
 const c=await browser.newContext({viewport:{width:mobile?390:1440,height:mobile?844:1000},isMobile:mobile,hasTouch:mobile,locale:'zh-CN'});
 await c.addInitScript(()=>{localStorage.setItem('pi-locale','zh-CN');localStorage.setItem('pi-theme','dark')});
 const created=await post('/api/agent/new',{type:'ensure_session',cwd,provider:'fixture',modelId:'ask'}),sid=created.sessionId;out.sessions.push(sid);a.equal(created.model.provider,'fixture');
 const models=await(await fetch(origin+'/api/models?cwd='+encodeURIComponent(cwd))).json();a.equal(models.defaultModel.provider,'fixture');a(models.modelList.every(m=>m.provider==='fixture'));
 await post('/api/agent/'+sid,{type:'prompt',message:'队列拖动排序隔离验收'});
 page=await c.newPage();page.setDefaultTimeout(12000);page.on('pageerror',e=>out.errors.push(e.message));await page.goto(origin+'/?session='+sid);await page.locator('.pi-native-ask-card').waitFor({timeout:45000});
 const hide=page.getByRole('button',{name:'隐藏侧边栏',exact:true});if(await hide.isVisible())await hide.click();
 const rows=page.locator('.pi-enh-queue-row'),list=page.locator('.pi-enh-queue-list'),editor=page.locator('textarea.chat-input-textarea');
 // Inspect pending first paint with one slow network acknowledgement.
 let delayed=false;await page.route('**/api/agent/'+sid,async route=>{const b=route.request().postDataJSON();if(!delayed&&b?.type==='follow_up'){delayed=true;await new Promise(r=>setTimeout(r,600));}await route.continue()});
 await page.evaluate(()=>{window.queueHeights=[];window.queueSample=true;function sample(){const row=document.querySelector('.pi-enh-queue-row');if(row)window.queueHeights.push({height:row.getBoundingClientRect().height,pending:row.getAttribute('aria-busy'),menu:!!document.querySelector('.pi-enh-queue-menu')});if(window.queueSample)requestAnimationFrame(sample)}requestAnimationFrame(sample)});
 await editor.fill('消息 1');await editor.press('Enter');await page.waitForFunction(()=>document.querySelectorAll('.pi-enh-queue-row').length===1&&!document.querySelector('.pi-enh-queue-more').disabled);
 const frames=await page.evaluate(()=>{window.queueSample=false;return window.queueHeights});a(frames.some(x=>x.pending==='true'));a(frames.some(x=>!x.pending));a(frames.every(x=>!x.menu));a(Math.max(...frames.map(x=>x.height))-Math.min(...frames.map(x=>x.height))<1);
 for(let i=2;i<=7;i++)await post('/api/agent/'+sid,{type:'follow_up',message:'消息 '+i});
 await page.waitForFunction(()=>document.querySelectorAll('.pi-enh-queue-row').length===7&&!document.querySelector('.pi-enh-queue-sort').disabled);
 const check={mobile,viewport:mobile?'390x844':'1440x1000',firstPaintHeights:[...new Set(frames.map(x=>x.height))]};out.checks.push(check);out.stage='drag-'+mobile;save();
 const x=await rows.first().locator('.pi-enh-queue-sort').boundingBox(),r=await list.boundingBox();
 const cdp=mobile?await c.newCDPSession(page):null;
 if(mobile){await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:x.x+x.width/2,y:x.y+x.height/2}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x.x+x.width/2,y:r.y+r.height-5}]});}
 else{await page.mouse.move(x.x+x.width/2,x.y+x.height/2);await page.mouse.down();await page.mouse.move(x.x+x.width/2,r.y+r.height-5,{steps:10});}
 await page.waitForFunction(()=>{const l=document.querySelector('.pi-enh-queue-list');return l.scrollTop>=l.scrollHeight-l.clientHeight-1});
 a(await rows.nth(1).evaluate(e=>getComputedStyle(e).transform!=='none'),'siblings must make room');await page.screenshot({path:D+'/drag-'+(mobile?390:1440)+'.png'});
 const reordered=page.waitForResponse(r=>r.request().method()==='POST'&&r.request().postDataJSON()?.type==='reorder_queued_message');
 if(mobile)await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});else await page.mouse.up();
 a.equal((await(await reordered).json()).success,true);
 const order=['消息 2','消息 3','消息 4','消息 5','消息 6','消息 7','消息 1'];
 await page.waitForFunction(()=>document.querySelector('.pi-enh-queue-text').textContent==='消息 2');
 const snap=await post('/api/agent/'+sid,{type:'get_queue_actions'});a.deepEqual(snap.data.followUp.map(x=>x.text),order);check.savedOrder=order;
 await page.reload();await page.waitForFunction(()=>document.querySelectorAll('.pi-enh-queue-row').length===7&&!document.querySelector('.pi-enh-queue-sort').disabled);a.deepEqual(await rows.locator('.pi-enh-queue-text').allTextContents(),order);check.refreshRetainsOrder=true;
 await list.evaluate(e=>e.scrollTop=0);await rows.first().locator('.pi-enh-queue-text').hover();a.equal(await rows.first().locator('.pi-enh-queue-text').evaluate(e=>getComputedStyle(e).backgroundColor),'rgba(0, 0, 0, 0)');
 const fonts=await rows.first().evaluate(e=>['.pi-enh-queue-text','.pi-enh-queue-promote'].map(q=>getComputedStyle(e.querySelector(q)).fontSize));a.deepEqual(fonts,['13px','13px']);check.fonts=fonts;
 check.controls=[];for(const cls of ['sort','promote','delete','more']){const b=rows.first().locator('.pi-enh-queue-'+cls);await b.hover();const style=await b.evaluate(e=>{const s=getComputedStyle(e);return {background:s.backgroundColor,radius:s.borderRadius,height:e.getBoundingClientRect().height}});a.notEqual(style.background,'rgba(0, 0, 0, 0)');a.equal(style.radius,'8px');a.equal(style.height,28);check.controls.push({cls,...style});}
 const before=await list.boundingBox();await rows.first().locator('.pi-enh-queue-more').click();const menu=page.getByRole('menu',{name:'排队消息操作'});await menu.waitFor();a.deepEqual(await menu.getByRole('menuitem').allTextContents(),['编辑消息','关闭排队']);a.equal((await list.boundingBox()).height,before.height);await menu.getByRole('menuitem').first().hover();a.notEqual(await menu.getByRole('menuitem').first().evaluate(e=>getComputedStyle(e).backgroundColor),'rgba(0, 0, 0, 0)');await page.screenshot({path:D+'/queue-menu-'+(mobile?390:1440)+'.png'});await menu.press('Escape');await menu.waitFor({state:'detached'});
 // Existing safe token contract: shrink to two, then verify keyboard ordering.
 const q=await post('/api/agent/'+sid,{type:'get_queue_actions'});for(const row of q.data.followUp.slice(2))await post('/api/agent/'+sid,{type:'delete_queued_message',token:row.token});
 await page.waitForFunction(()=>document.querySelectorAll('.pi-enh-queue-row').length===2&&!document.querySelector('.pi-enh-queue-sort').disabled);
 await rows.first().locator('.pi-enh-queue-sort').focus();await rows.first().locator('.pi-enh-queue-sort').press('ArrowDown');await page.waitForFunction(()=>document.querySelector('.pi-enh-queue-text').textContent==='消息 3');a.deepEqual((await post('/api/agent/'+sid,{type:'get_queue_actions'})).data.followUp.map(x=>x.text),['消息 3','消息 2']);check.keyboard='passed';
 await page.screenshot({path:D+'/queue-'+(mobile?390:1440)+'.png'});await post('/api/agent/'+sid,{type:'abort'});await c.unrouteAll({behavior:'ignoreErrors'});await c.close();save();
 }a.deepEqual(out.errors,[]);out.status='passed';}catch(e){out.status='failed';out.failure=e.stack;process.exitCode=1;if(page)await page.screenshot({path:D+'/failure.png'}).catch(()=>{});}finally{for(const sid of out.sessions)await post('/api/agent/'+sid,{type:'abort'}).catch(()=>{});await browser.close();save()}console.log(JSON.stringify(out));})()
