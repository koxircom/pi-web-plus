import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
const css = await readFile(new URL("../app/composer.css", import.meta.url), "utf8");
const source = await readFile(new URL("./ThinkingSelector.tsx", import.meta.url), "utf8");
test("reasoning menu lives outside composer layout and clamps to visual viewport", () => {
  assert.match(source, /createPortal/);
  assert.match(source, /document.body/);
  assert.match(source, /viewport.width - 16/);
  assert.match(source, /viewport.left \+ 8/);
  assert.match(source, /aria-selected=\{active\}/);
});
test("one real capsule owns the shared background without pseudo-element seams", () => {
  assert.match(css, /chat-composer-model-controls/);
  assert.doesNotMatch(css, /chat-composer-model-pill::after/);
});
