import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { convergeChatTail } from "./chat-scroll-to-bottom.ts";

test("click converges changing history height and yields to user input", () => {
  const saved = Object.fromEntries(["document", "performance", "requestAnimationFrame", "cancelAnimationFrame"].map(k => [k, Object.getOwnPropertyDescriptor(globalThis,k)]));
  let now=0, next=0; const frames=new Map(); const events=new EventTarget();
  try {
    Object.defineProperty(globalThis,"document",{configurable:true,value:events});
    Object.defineProperty(globalThis,"performance",{configurable:true,value:{now:()=>now}});
    globalThis.requestAnimationFrame=fn=>{frames.set(++next,fn);return next;};
    globalThis.cancelAnimationFrame=id=>frames.delete(id);
    const c={isConnected:true,scrollHeight:900,clientHeight:200,scrollTop:0,scrollTo({top}){this.scrollTop=top;}};
    const cancel=convergeChatTail(c);assert.equal(c.scrollTop,700);
    c.scrollHeight=1200;now=100;const tick=[...frames.values()][0];frames.clear();tick();assert.equal(c.scrollTop,1000);
    events.dispatchEvent(new Event("wheel"));assert.equal(frames.size,0);c.scrollTop=50;tick();assert.equal(c.scrollTop,50);cancel();
    now=0;convergeChatTail(c);now=300;const stable=[...frames.values()][0];frames.clear();stable();assert.equal(frames.size,0);
  } finally {for(const [k,d] of Object.entries(saved)) {if(d)Object.defineProperty(globalThis,k,d);else delete globalThis[k];}}
});

test("single native arrow; legacy DOM owner and repeated positioning are retired", () => {
  const root=new URL("../",import.meta.url);
  const read=p=>fs.readFileSync(new URL(p,root),"utf8");
  for(const p of ["enhancements/modules/06-chat-view-and-tool-cards.js","enhancements/modules/02-plugin-registry-and-settings-schema.js","enhancements/modules/08-settings-panels-and-lifecycle.js","app/enhancements.css"]) {
    const source=read(p);for(const name of ["pi-enh-scroll-bottom-btn","ensureScrollBottomButton","syncScrollBottomPosition","onChatContentScroll","removeScrollBottomButton"])assert(!source.includes(name),p+": "+name);
  }
  assert(read("enhancements/modules/06-chat-view-and-tool-cards.js").includes("function getChatContentContainer()"), "shared scheduler container helper must remain");
  const chat=read("components/ChatWindow.tsx");assert.equal(chat.split("<ChatScrollToBottom").length-1,1);
  assert(chat.indexOf('bottom: "100%"')<chat.indexOf("<ChatScrollToBottom"));
  assert(chat.indexOf("<ChatScrollToBottom")<chat.lastIndexOf("{chatInputElement}"));
  assert(chat.slice(chat.indexOf('bottom: "100%"'),chat.indexOf("<ChatScrollToBottom")).includes("right: columnEndInset"), "arrow shares composer column including actual gutter");
});
