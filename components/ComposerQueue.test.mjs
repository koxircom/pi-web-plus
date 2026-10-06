import assert from "node:assert/strict";
import test from "node:test";
import {createJiti} from "jiti";
import {readFileSync} from "node:fs";
const jiti=createJiti(import.meta.url,{jsx:{runtime:"automatic"},tsconfigPaths:true});
const React=await jiti.import("react");
const {renderToStaticMarkup}=await jiti.import("react-dom/server");
const {ComposerQueue}=await jiti.import("./ComposerQueue.tsx");
test("first render uses the final queue structure for steering and follow-up",()=>{
 const html=renderToStaticMarkup(React.createElement(ComposerQueue,{sessionId:"fixture",queuedMessages:{steering:["优先任务"],followUp:["后续任务"]}}));
 assert.match(html,/data-pi-native-queue="true"/);
 assert.match(html,/优先任务/); assert.match(html,/后续任务/);
 assert.match(html,/pi-enh-queue-promote/);
 assert.doesNotMatch(html,/pi-enh-queue-header|待处理|全部编辑/);
 assert.doesNotMatch(html,/>steer<|>follow-up<|pi-enh-native-queue-hidden/);
});
test("pending steering uses the same final row with its image preserved",()=>{
 const html=renderToStaticMarkup(React.createElement(ComposerQueue,{sessionId:"fixture",queuedMessages:{steering:[],followUp:[]},pending:{kind:"steering",text:"",images:[{data:"aW1n",mimeType:"image/png"}]}}));
 assert.match(html,/pi-enh-queue-row/);assert.match(html,/data:image\/png;base64,aW1n/);
 assert.doesNotMatch(html,/data-pi-native-queue-submission|>steer</);
});
test("enhancement adapter cannot hide, scan or rebuild React queue nodes",()=>{
 const source=readFileSync(new URL("../enhancements/modules/05-composer-and-input-workflow.js",import.meta.url),"utf8");
 const s=source.slice(source.indexOf("// Native React owns queue rendering"), source.indexOf("// Foundation composer layout"));
 assert.doesNotMatch(s,/pi-enh-native-queue-hidden|panel.innerHTML|row.firstElementChild/);
 assert.match(s,/pi:native-queue-snapshot/);assert.match(s,/pi:native-queue-action/);
});

test("reference row uses sort handles, quiet thumbnails and more actions", () => {
 const html=renderToStaticMarkup(React.createElement(ComposerQueue,{sessionId:"fixture",queuedMessages:{steering:[],followUp:["one","two"]}}));
 assert.match(html,/拖动排序第 1 条排队消息/);
 assert.match(html,/更多操作：第 1 条排队消息/);
 assert.doesNotMatch(html,/pi-enh-queue-number|pi-enh-queue-edit|pi-enh-queue-img-label/);
 const css=readFileSync(new URL("./ComposerQueue.css",import.meta.url),"utf8");
 assert.doesNotMatch(css,/234, 179|translateY|pi-enh-queue-img-label/);
 assert.doesNotMatch(css,/pi-enh-queue-header|pi-enh-queue-recall/);
 assert.doesNotMatch(css,/\.pi-enh-queue-row\s*\{[^}]*transition\s*:\s*[^;}]*\b(?:all|height|margin|max-height)\b/);
 assert.match(css,/touch-action: none/);
});
test("composer adapters follow the semantic native host after refresh", () => {
 const input=readFileSync(new URL("./ChatInput.tsx",import.meta.url),"utf8");
 assert.match(input,/data-pi-native-composer-host="true"/);
 for(const name of ["03-session-cache-and-sync-engine", "04-sidebar-and-session-management", "05-composer-and-input-workflow", "06-chat-view-and-tool-cards", "07-kernel-scheduler-and-observers"]){
  const source=readFileSync(new URL(`../enhancements/modules/${name}.js`,import.meta.url),"utf8");
  assert.doesNotMatch(source,/closest\??\.?\(\??["']fieldset|querySelector\??\.?\(\??["']fieldset/);
  assert.match(source,/data-pi-native-composer-host/);
 }
});
