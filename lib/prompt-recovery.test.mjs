import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { userMessageKey, preservePendingUserMessage } = await createJiti(import.meta.url).import("./prompt-recovery.ts");

function textMessage(content) {
  return { role: "user", content, timestamp: 1 };
}

test("builds stable keys for matching optimistic text messages", () => {
  assert.equal(userMessageKey(textMessage("repeat this")), userMessageKey(textMessage("repeat this")));
  assert.notEqual(userMessageKey(textMessage("first")), userMessageKey(textMessage("second")));
});

test("includes attached images in optimistic message keys", () => {
  const submitted = {
    role: "user",
    content: [
      { type: "text", text: "inspect" },
      { type: "image", source: { type: "base64", media_type: "image/png", data: "AQID" } },
    ],
    timestamp: 1,
  };
  const differentImage = {
    ...submitted,
    content: [
      { type: "text", text: "inspect" },
      { type: "image", source: { type: "base64", media_type: "image/png", data: "BAUG" } },
    ],
  };
  assert.notEqual(userMessageKey(submitted), userMessageKey(differentImage));
});

test('unconfirmed text and image echoes survive old history without changing it',()=>{
 for(const message of [textMessage('same'),{role:'user',content:[{type:'image',data:'AQID',mimeType:'image/png'}],timestamp:1}]){
  const history=[{...message,timestamp:0}],pending={sessionId:'s',message,precedingEntryIds:['old']};
  const result=preservePendingUserMessage(history,['old'],'s',pending);
  assert.equal(result.length,2);assert.equal(result[1],message);assert.equal(history.length,1);
  assert.equal(preservePendingUserMessage(history,['new'],'s',pending),history);
  assert.equal(preservePendingUserMessage(history,['old'],'other',pending),history);
  assert.equal(preservePendingUserMessage(history,['old'],'s',null),history);
 }
});
