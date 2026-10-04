import assert from "node:assert/strict";
import test from "node:test";
import { composerModelLabel } from "./composer-model-label.ts";
test("restored IDs and catalog names show the same pure model label", () => {
  assert.equal(composerModelLabel("gemini-3.8-flash-high"), "Gemini 3.8 Flash");
  assert.equal(composerModelLabel("Gemini 3.8 Flash"), "Gemini 3.8 Flash");
  assert.equal(composerModelLabel("Gemini 3.1 Pro (High)"), "Gemini 3.1 Pro");
  assert.equal(composerModelLabel("GPT-6.1 Sol xhigh"), "GPT-6.1 Sol");
  for (const name of ["GPT-6.1 Sol", "o4-mini", "claude-sonnet-4-5", "Custom High Quality"]) assert.equal(composerModelLabel(name), name);
});
