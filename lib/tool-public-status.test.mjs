import test from 'node:test';
import assert from 'node:assert/strict';
import { createJiti } from 'jiti';
const { getToolPublicStatus, getToolPublicCategoryKey, createToolProcessSummary, includeToolInProcessSummary, getToolProcessSummaryLabel, completeActiveToolResult } = await createJiti(import.meta.url).import('./tool-public-status.ts');
test('tool success requires a final result; partial output never counts as success',()=>{const b={toolName:'bash'};assert.equal(getToolPublicStatus(b),'running');assert.equal(getToolPublicStatus(b,{content:[],inProgress:true}),'running');assert.equal(getToolPublicStatus(b,{content:[],isError:true}),'failure');assert.equal(getToolPublicStatus(b,{content:[],isError:false}),'success');assert.equal(getToolPublicStatus({toolName:'apply_patch'},{content:[],details:{result:{failures:[{filePath:'a',message:'fail'}]}}}),'failure');});
test('unknown tools use a neutral category rather than expose their raw name',()=>{assert.equal(getToolPublicCategoryKey('unknown_sensitive_name'),'chat.toolCategory.generic');assert.equal(getToolPublicCategoryKey('bash'),'chat.toolCategory.command');assert.equal(getToolPublicCategoryKey('read'),'chat.toolCategory.read');});

const translations={"chat.toolCategory.read":"读取文件","chat.toolCategory.command":"运行命令","chat.toolCategory.search":"搜索","chat.processAction.generic":"调用工具","chat.processAction.subagent":"执行子任务","chat.processActionSeparator":"、","chat.processRunning":"正在{actions}","chat.processExecuted":"已执行：{actions}","chat.thinking":"正在思考...","chat.processThinkingRecord":"思考记录","chat.toolStatusRunningCount":"运行中 {count} 项","chat.toolStatusSuccessCount":"成功 {count} 项","chat.toolStatusFailureCount":"失败 {count} 项"};
const t=(key,params={})=>Object.entries(params).reduce((s,[k,v])=>s.replace(`{${k}}`,String(v)),translations[key]??key);
test('current action changes on final tool result and uses active categories only',()=>{
 const read={toolName:'read'},command={toolName:'bash'};
 let s=createToolProcessSummary();includeToolInProcessSummary(s,read,{inProgress:true});includeToolInProcessSummary(s,command);
 assert.equal(getToolProcessSummaryLabel(s,t),'正在读取文件、运行命令 · 运行中 2 项');
 s=createToolProcessSummary();includeToolInProcessSummary(s,read,{content:[]});includeToolInProcessSummary(s,command,{inProgress:true});
 assert.equal(getToolProcessSummaryLabel(s,t),'正在运行命令 · 运行中 1 项 · 成功 1 项');
 s=createToolProcessSummary();includeToolInProcessSummary(s,read,{content:[]});includeToolInProcessSummary(s,command,{content:[]});
 assert.equal(getToolProcessSummaryLabel(s,t),'已执行：读取文件、运行命令 · 成功 2 项');
});
test('failures stay visible; actions are bounded and never disclose names or arguments',()=>{
 const s=createToolProcessSummary();for(let i=0;i<30;i++)includeToolInProcessSummary(s,{toolName:'private_custom_tool',arguments:{token:'SECRET'}},{isError:true});
 assert.equal(getToolProcessSummaryLabel(s,t),'已执行：调用工具 · 失败 30 项');assert.equal(s.categories.length,1);
});
test('thinking-only history is not presented as still running',()=>{
 const s=createToolProcessSummary();assert.equal(getToolProcessSummaryLabel(s,t,true),'正在思考...');assert.equal(getToolProcessSummaryLabel(s,t,false),'思考记录');
});

test('slim execution end establishes final status before transcript result arrives',()=>{
 const block={toolName:'read'};
 const completed=completeActiveToolResult(undefined,{toolCallId:'read-1',toolName:'read',isError:false});
 assert.equal(getToolPublicStatus(block,completed),'success');assert.deepEqual(completed.content,[]);
 const partial={role:'toolResult',toolCallId:'cmd-1',toolName:'bash',content:[{type:'text',text:'partial'}],inProgress:true,isError:false};
 const failed=completeActiveToolResult(partial,{toolCallId:'cmd-1',isError:true});
 assert.equal(getToolPublicStatus({toolName:'bash'},failed),'failure');assert.equal(failed.content,partial.content);assert.equal(partial.inProgress,true);
});
