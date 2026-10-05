import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
const source=readFileSync(new URL('./useAgentSession.ts',import.meta.url),'utf8');
const file=ts.createSourceFile('hook.ts',source,ts.ScriptTarget.Latest,true);
function callback(name){let found;function visit(n){if(ts.isVariableDeclaration(n)&&n.name.getText(file)===name)found=n.initializer.arguments[0];ts.forEachChild(n,visit);}visit(file);assert.ok(found,name);return new Function('scope',`with(scope){return ${ts.transpileModule('('+found.getText(file)+')',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText.trim().replace(/;$/,'')};}`);}
function harness(){const ref=current=>({current});let resolve;const response=new Promise(r=>resolve=r);const ui={running:true,phase:{kind:'waiting_model'},notifications:0};const noop=()=>{};
 const scope={agentRunningRef:ref(true),sdkAgentActiveRef:ref(true),rpcPromptPendingRef:ref(true),promptRunIdRef:ref(1),agentStateRevisionRef:ref(0),notifiedPromptRunIdRef:ref(0),sessionIdRef:ref('s'),optimisticUserMessageRef:ref(null),
 invalidatesSessionHistory:()=>false,bumpSessionEpoch:noop,cancelEventStreamGrace:noop,setAgentRunning:v=>ui.running=v,setAgentPhase:v=>ui.phase=v,setRetryInfo:noop,setActiveToolResults:noop,dispatch:noop,setIsCompacting:noop,setAutoCompactionEnabled:noop,setQueuedMessages:noop,normalizeQueuedMessages:x=>x,syncLiveModel:noop,loadSession:noop,scheduleEventStreamClose:noop,fetch:()=>response,
 setMessages:noop,normalizeToolCalls:x=>x,isSystemMessageEvent:()=>false,
 notifyPromptStage:id=>{if(scope.notifiedPromptRunIdRef.current!==id){scope.notifiedPromptRunIdRef.current=id;ui.notifications++;}},
 settleUiStage:()=>{const was=scope.agentRunningRef.current;scope.agentRunningRef.current=false;ui.running=false;ui.phase=null;return was;}};
 for(const n of ['handleAgentEvent','reconcileAgentState'])scope[n]=callback(n)(scope);
 return {scope,ui,resolve};}
test('settled ends the visible run before the POST completion callback',()=>{const h=harness();h.scope.handleAgentEvent({type:'agent_settled'});assert.equal(h.ui.running,false);assert.equal(h.ui.phase,null);h.scope.handleAgentEvent({type:'prompt_done'});assert.equal(h.ui.notifications,1);});
test('a busy snapshot started before settlement cannot revive SDK or prompt activity',async()=>{const h=harness();const pending=h.scope.reconcileAgentState('s');h.scope.handleAgentEvent({type:'agent_settled'});h.scope.handleAgentEvent({type:'prompt_done'});h.resolve({ok:true,json:async()=>({running:true,state:{isStreaming:true,isPromptRunning:true}})});await pending;assert.equal(h.scope.sdkAgentActiveRef.current,false);assert.equal(h.scope.rpcPromptPendingRef.current,false);assert.equal(h.ui.running,false);});
test('a real continuation started after settlement survives the old prompt_done',()=>{const h=harness();h.scope.handleAgentEvent({type:'agent_settled'});h.scope.handleAgentEvent({type:'agent_start'});h.scope.handleAgentEvent({type:'prompt_done'});assert.equal(h.ui.running,true);assert.equal(h.scope.sdkAgentActiveRef.current,true);});
test('a final assistant answer does not invent a waiting-model phase',()=>{const h=harness();h.scope.handleAgentEvent({type:'message_end',message:{role:'assistant',stopReason:'stop',content:[{type:'text',text:'完成'}]}});assert.equal(h.ui.phase,null);});
