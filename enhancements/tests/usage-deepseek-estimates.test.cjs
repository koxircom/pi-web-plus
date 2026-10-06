'use strict';
const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const test = require('node:test'), assert = require('node:assert/strict');
const core = require('../usage-ledger-core.js');
function fixture() {
 const today = core.day(Date.now()), yesterday = core.day(Date.now()-86400000);
 const bucket = (model, role, day, extra = {}) => ({sessionId:'demo',provider:'demo',model,role,day,inputTokens:1000000,outputTokens:1000000,cacheReadTokens:1000000,cacheWriteTokens:1000000,totalTokens:4000000,messageCount:1,calls:role==='subagent'?1:0,records:1,costNano:1000000,unpricedTokens:0,missingUsage:0,...extra});
 const buckets = [bucket('gpt-6-sol','main',today),bucket('gemini-3.8-flash-high','main',yesterday),bucket('deepseek-flash','subagent',today,{controllerModel:'gpt-6-sol'}),bucket('deepseek-v4-pro','main',today)];
 return {version:2,snapshotId:'deepseek-render-fixture',generatedAt:new Date().toISOString(),buckets,sessions:{demo:{name:'演示用量'}}};
}
function render(ledger, timeRange) {
 const storage = new Map(), context = {console,PiUsageLedger:core,__PI_ENH_USAGE_LEDGER__:ledger,location:{protocol:'http:',hostname:'127.0.0.1'},AbortController,setTimeout,clearTimeout,localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},fetch:async()=>({ok:true,text:async()=>JSON.stringify(ledger)})};
 context.window=context;vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(__dirname,'../pi-usage-panel.js'),'utf8'),context);
 context.PiUsagePanel.setFilters({timeRange});
 const panel={dataset:{},innerHTML:'',isConnected:false,querySelector:()=>null,querySelectorAll:()=>[]};
 context.PiUsagePanel.render(panel,{}, {enabled:()=>false});return panel.innerHTML;
}
test('all history shows independent DeepSeek prices for every used model, alongside delegation savings',()=>{
 const ledger=fixture(), stats=core.aggregate(ledger);core.validate(ledger);
 assert(stats.modelBreakdowns.find(m=>m.key==='gpt-6-sol').dispatchedSubagents.savedCost>0,'Fixture must reproduce the savings branch');
 const html=render(ledger,'all');
 assert.equal((html.match(/data-usage-deepseek-estimate/g)||[]).length,4);
 assert.match(html,/委派 Sub agent 降本分析/);
 assert.equal((html.match(/折算 DeepSeek-V4\.1 Flash 低谷期: \$0\.756/g)||[]).length,4);
 assert.match(html,/含执行 Sub agent \(4\.00M\): \$0\.756 \(约 ¥5\.04\)/);
});
for(const [range,count] of [['today',3],['yesterday',1]]) test(`${range} keeps every filtered model's DeepSeek estimate`,()=>assert.equal((render(fixture(),range).match(/data-usage-deepseek-estimate/g)||[]).length,count));
test('system summaries and empty usage do not create misleading model conversion cards',()=>{
 const ledger=fixture();ledger.buckets=ledger.buckets.filter(b=>b.role==='main').slice(0,1);ledger.buckets[0].model='system-summaries';ledger.buckets[0].role='system';
 assert.equal((render(ledger,'all').match(/data-usage-deepseek-estimate/g)||[]).length,0);
 ledger.buckets=[];assert.equal((render(ledger,'all').match(/data-usage-deepseek-estimate/g)||[]).length,0);
});
