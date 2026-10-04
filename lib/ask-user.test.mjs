import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { createJiti } from 'jiti';
import { createRequire } from 'node:module';
const sdkRequire = createRequire(new URL('../node_modules/@earendil-works/pi-coding-agent/package.json', import.meta.url));
const jiti = createJiti(import.meta.url, { tsconfigPaths: true, alias: {
  '@sinclair/typebox': sdkRequire.resolve('typebox'),
  '@earendil-works/pi-coding-agent': import.meta.resolve('@earendil-works/pi-coding-agent'),
  '@earendil-works/pi-tui': import.meta.resolve('@earendil-works/pi-tui'),
} });
const { findAskUserQuestion, readAskTerminal, buildAskAnswerInputs } = await jiti.import('./ask-user.ts');
const { AgentSessionWrapper } = await jiti.import('./rpc-manager.ts');
const { default: registerAsk } = await jiti.import('/root/.pi/agent/npm/node_modules/pi-ask-user/index.ts');
let tool;
registerAsk({ registerTool(value) { tool = value; }, events: { emit() {} } });
const args = { question: '请选择本次变更的处理方式？', context: '<!-- ask-user: high-risk -->\n风险原因：这是一条隔离测试提问。', options: [{title:'只读检查',description:'仅查看证据，不修改任何业务记录。'},{title:'隔离验收',description:'仅在独立测试实例运行。'},{title:'保留现状',description:'不变更正式环境。'}], allowFreeform: true, allowComment: true, singleSelectLayout:'list' };
const message = (id, input) => ({ role:'assistant',content:[{type:'toolCall',id,name:'ask_user',arguments:input}] });
const simpleLines = ['ask_user','Question',args.question,'Context (3 lines)','Filter:','→ 1. 只读检查','2. 隔离验收','3. 保留现状','4. [ ] Add extra context after selection','5. Type something.'];

test('metadata is bound to a unique unresolved question and internal comments are removed', () => {
  const q = findAskUserQuestion(simpleLines,[message('a',args)]);
  assert.equal(q.toolCallId,'a'); assert.equal(q.options[0].description,args.options[0].description);
  assert.equal(q.context.includes('<!--'),false); assert.equal(q.allowComment,true);
  assert.equal(findAskUserQuestion(simpleLines,[message('a',args),{role:'toolResult',toolCallId:'a'}]),undefined);
  assert.equal(findAskUserQuestion(simpleLines,[message('a',args),message('b',args)]),undefined);
  assert.equal(findAskUserQuestion(simpleLines,[message('a',{...args,question:'完全不同的问题'})]),undefined);
});

test('legacy string options are normalized and editor continuations do not infer unrelated metadata', () => {
  assert.equal(findAskUserQuestion(simpleLines,[message('a',{...args,options:args.options.map(o=>o.title)})]).options.length,3);
  assert.equal(findAskUserQuestion(['Custom response'],[message('a',args)]),undefined);
  assert.equal(readAskTerminal(['Custom response']).mode,'freeform');
});

test('no local timer/React Fiber bridge, old observer or skeleton renderer survives', () => {
  const root = new URL('../',import.meta.url);
  const modules = fs.readdirSync(new URL('enhancements/modules/',root)).filter(name=>name.endsWith('.js')).map(name=>fs.readFileSync(new URL('enhancements/modules/'+name,root),'utf8')).join('\n');
  for (const retired of ['renderAskUserWebNative','hydrateAskUserContext','extractAskUserReactBridge','instantDialogObserver','syncAskUserWebNative','removeAskUserWebNative']) assert.equal(modules.includes(retired),false,retired);
  assert.equal(fs.readFileSync(new URL('app/enhancements.css',root),'utf8').includes('.pi-enh-ask-native-host'),false);
});

async function runActual(t, params, selected, notes='', freeform=false) {
  const inner={sessionId:'isolated-ask',isStreaming:false,isCompacting:false,isBashRunning:false,sessionManager:{getCwd:()=>'/tmp'},agent:{state:{messages:[message('tool-fixture',params)]}},extensionRunner:{},dispose(){}};
  const wrapper=new AgentSessionWrapper(inner); t.after(()=>wrapper.destroy());
  const ui=wrapper.createExtensionUiContext(), events=[];
  wrapper.onEvent(event=>events.push(event));
  const running=tool.execute('tool-fixture',params,undefined,undefined,{hasUI:true,ui});
  await new Promise(resolve=>setImmediate(resolve));
  const request=events.find(event=>event.method==='custom');
  assert.ok(request?.askUser,'first real AskComponent frame contains full metadata: '+JSON.stringify(request));
  assert.equal(request.askUser.question,params.question);
  const batch=buildAskAnswerInputs(request.askUser,request.lines,selected,notes,freeform);
  const custom=wrapper.activeCustomUis.get(request.id), inputs=[];
  const original=custom.component.handleInput.bind(custom.component);
  custom.component.handleInput=data=>{inputs.push(data);original(data);};
  const count=events.filter(event=>event.method==='custom'&&!event.closed).length;
  await wrapper.send({type:'extension_ui_input',id:request.id,data:batch});
  const result=await running;
  assert.equal(result.isError,undefined); assert.equal(result.details.cancelled,false);
  assert.equal(inputs.length,batch.length);
  assert.equal(events.filter(event=>event.method==='custom'&&!event.closed).length,count,'no intermediate frames during one answer batch');
  await assert.rejects(wrapper.send({type:'extension_ui_input',id:request.id,data:batch}),/no longer pending/);
  return result.details.response;
}

test('real AskComponent: single choice confirms once, not on highlight',async t=>{
  const answer=await runActual(t,args,[1]); assert.deepEqual(answer.selections,['隔离验收']);
});
test('real AskComponent: selected option plus multiline notes',async t=>{
  const answer=await runActual(t,args,[1],'仅隔离验收\n请保留原数据');
  assert.deepEqual(answer.selections,['隔离验收']); assert.equal(answer.comment,'仅隔离验收\n请保留原数据');
});
test('real AskComponent: multiple selection and comment',async t=>{
  const answer=await runActual(t,{...args,allowMultiple:true},[0,2],'多个选项的说明');
  assert.deepEqual(answer.selections,['只读检查','保留现状']); assert.equal(answer.comment,'多个选项的说明');
});
test('real AskComponent: freeform answer uses the same public terminal protocol',async t=>{
  const answer=await runActual(t,args,[],'中文自定义回答\n第二行',true);
  assert.equal(answer.kind,'freeform'); assert.equal(answer.text,'中文自定义回答\n第二行');
});
test('empty answer and notes on a non-comment question are refused before sending',()=>{
  const q=findAskUserQuestion(simpleLines,[message('a',args)]);
  assert.throws(()=>buildAskAnswerInputs(q,simpleLines,[],''),/请选择/);
  assert.throws(()=>buildAskAnswerInputs(q,simpleLines,[],'',true),/请输入/);
  assert.throws(()=>buildAskAnswerInputs({...q,allowComment:false},simpleLines.filter(l=>!l.includes('Add extra')),[0],'备注'),/未开启/);
});
