import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");

test("expands process details when a completed turn has no final answer", () => {
  assert.match(source, /const \[expanded, setExpanded\] = useState\(defaultExpanded\)/);
  assert.match(
    source,
    /if \(run\.kind === "public"\) \{\s*if \(finalInTurn\) finalAnswerAssistantIndices\.add\(idx\);[\s\S]*?plans\.push\(makeMessagePlan\(idx,/,
  );
  assert.match(
    source,
    /plan\.defaultExpanded = finalAssistantIndex !== undefined\s*&& finalAssistantIndex < messages\.length\s*&& !finalAnswerAssistantIndices\.has\(finalAssistantIndex\)/,
  );
  assert.match(source, /<ProcessDetailsGroup toolStates=\{plan\.toolStates\} defaultExpanded=\{plan\.defaultExpanded\}/);
  assert.match(source, /plans\.slice\(startIndex\)\.map\(/);
});
