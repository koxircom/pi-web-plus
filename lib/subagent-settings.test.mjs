import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const {
  disabledBuiltInSubagents,
  isBuiltInSubagentsEnabled,
  readSubagentSettings,
  writeBuiltInSubagentsEnabled,
  writeDisabledBuiltInSubagent,
  writeSubagentModelOverride,
  writeSubagentProfileOverride,
  writeSubagentOverrides,
} = await createJiti(import.meta.url).import("./subagent-settings.ts");

test("subagent settings default the built-in extension to disabled", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "pi-web-subagent-settings-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const settingsPath = join(root, "agents", "settings.json");

  assert.deepEqual(readSubagentSettings(settingsPath), { builtInEnabled: false, disabledBuiltIns: [] });
  assert.equal(readSubagentSettings(settingsPath).subagentModel, null);
  assert.deepEqual(readSubagentSettings(settingsPath).subagentOverrides, {});
  assert.equal(isBuiltInSubagentsEnabled(settingsPath), false);
  assert.deepEqual([...disabledBuiltInSubagents(settingsPath)], []);
});

test("subagent settings persist both states and preserve unrelated fields", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "pi-web-subagent-settings-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const settingsPath = join(root, "agents", "settings.json");

  writeBuiltInSubagentsEnabled(true, settingsPath);
  assert.deepEqual(readSubagentSettings(settingsPath), { builtInEnabled: true, disabledBuiltIns: [] });
  assert.equal(isBuiltInSubagentsEnabled(settingsPath), true);
  const first = JSON.parse(await readFile(settingsPath, "utf8"));
  assert.deepEqual(first, { version: 1, builtInEnabled: true });

  await writeFile(settingsPath, JSON.stringify({ ...first, futureSetting: 3 }));
  writeBuiltInSubagentsEnabled(false, settingsPath);
  const second = JSON.parse(await readFile(settingsPath, "utf8"));
  assert.deepEqual(second, { version: 1, builtInEnabled: false, futureSetting: 3 });
});

test("subagent model override persists, trims, clears, and preserves other settings", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "pi-web-subagent-settings-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const settingsPath = join(root, "agents", "settings.json");

  await mkdir(join(root, "agents"), { recursive: true });
  await writeFile(settingsPath, JSON.stringify({
    version: 1,
    builtInEnabled: true,
    disabledBuiltIns: ["explore"],
    maxConcurrent: 3,
    defaultProfile: "obsolete-from-local-preview",
    futureSetting: { keep: true },
  }));

  writeSubagentModelOverride("  cliproxyapi/gemini-3.8-flash-high  ", settingsPath);
  assert.equal(readSubagentSettings(settingsPath).subagentModel, "cliproxyapi/gemini-3.8-flash-high");
  assert.deepEqual(JSON.parse(await readFile(settingsPath, "utf8")), {
    version: 1,
    builtInEnabled: true,
    disabledBuiltIns: ["explore"],
    maxConcurrent: 3,
    futureSetting: { keep: true },
    subagentModel: "cliproxyapi/gemini-3.8-flash-high",
  });

  writeSubagentModelOverride(null, settingsPath);
  assert.equal(readSubagentSettings(settingsPath).subagentModel, null);
  assert.equal("subagentModel" in JSON.parse(await readFile(settingsPath, "utf8")), false);
  assert.throws(() => writeSubagentModelOverride("  ", settingsPath), /non-empty string/);
});

test("subagent overrides persist, update per profile, clear, and isolate independent agents", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "pi-web-subagent-settings-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const settingsPath = join(root, "agents", "settings.json");

  writeSubagentProfileOverride("Worker", { model: " cliproxyapi/gemini-3.8-flash-high ", thinking: " high " }, settingsPath);
  assert.deepEqual(readSubagentSettings(settingsPath).subagentOverrides, {
    worker: { model: "cliproxyapi/gemini-3.8-flash-high", thinking: "high" },
  });

  writeSubagentProfileOverride("scout", { model: "openai-codex/gpt-5.6-luna", thinking: "max" }, settingsPath);
  assert.deepEqual(readSubagentSettings(settingsPath).subagentOverrides, {
    worker: { model: "cliproxyapi/gemini-3.8-flash-high", thinking: "high" },
    scout: { model: "openai-codex/gpt-5.6-luna", thinking: "max" },
  });

  // Updating scout only touches scout
  writeSubagentProfileOverride("SCOUT", { model: "anthropic/claude-sonnet" }, settingsPath);
  assert.deepEqual(readSubagentSettings(settingsPath).subagentOverrides, {
    worker: { model: "cliproxyapi/gemini-3.8-flash-high", thinking: "high" },
    scout: { model: "anthropic/claude-sonnet" },
  });

  // Clearing scout removes it without touching worker
  writeSubagentProfileOverride("scout", null, settingsPath);
  assert.deepEqual(readSubagentSettings(settingsPath).subagentOverrides, {
    worker: { model: "cliproxyapi/gemini-3.8-flash-high", thinking: "high" },
  });

  // Batch override updates multiple agents
  writeSubagentOverrides({
    planner: { model: "openai-codex/gpt-5.6-luna", thinking: "max" },
    "general-purpose": { thinking: "low" },
    worker: null,
  }, settingsPath);

  assert.deepEqual(readSubagentSettings(settingsPath).subagentOverrides, {
    planner: { model: "openai-codex/gpt-5.6-luna", thinking: "max" },
    "general-purpose": { thinking: "low" },
  });

  assert.throws(() => writeSubagentProfileOverride("  ", { model: "m" }, settingsPath), /non-empty string/);
});

test("disabling a built-in is a minimal edit of the stored name list", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "pi-web-subagent-settings-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const settingsPath = join(root, "agents", "settings.json");

  writeBuiltInSubagentsEnabled(true, settingsPath);
  writeDisabledBuiltInSubagent("explore", true, settingsPath);
  assert.deepEqual([...disabledBuiltInSubagents(settingsPath)], ["explore"]);
  // The feature switch and any unknown field survive the write.
  assert.deepEqual(JSON.parse(await readFile(settingsPath, "utf8")), {
    version: 1,
    builtInEnabled: true,
    disabledBuiltIns: ["explore"],
  });

  writeDisabledBuiltInSubagent("plan", true, settingsPath);
  writeDisabledBuiltInSubagent("explore", true, settingsPath);
  assert.deepEqual(readSubagentSettings(settingsPath).disabledBuiltIns, ["explore", "plan"]);

  // A name is matched case-insensitively, and re-enabling one leaves the other.
  writeDisabledBuiltInSubagent("EXPLORE", false, settingsPath);
  assert.deepEqual(readSubagentSettings(settingsPath).disabledBuiltIns, ["plan"]);
  writeDisabledBuiltInSubagent("plan", false, settingsPath);
  assert.deepEqual(readSubagentSettings(settingsPath).disabledBuiltIns, []);
  assert.equal(isBuiltInSubagentsEnabled(settingsPath), true);

  assert.throws(() => writeDisabledBuiltInSubagent("  ", true, settingsPath));
});

test("a name no built-in claims is kept, and a damaged list is ignored", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "pi-web-subagent-settings-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const settingsPath = join(root, "agents", "settings.json");

  await mkdir(join(root, "agents"), { recursive: true });
  await writeFile(settingsPath, JSON.stringify({
    version: 1,
    disabledBuiltIns: ["from-a-newer-build", 7, " explore ", "Explore", ""],
    futureSetting: 3,
  }));
  assert.deepEqual(readSubagentSettings(settingsPath).disabledBuiltIns, ["from-a-newer-build", "explore"]);

  writeDisabledBuiltInSubagent("explore", false, settingsPath);
  assert.deepEqual(JSON.parse(await readFile(settingsPath, "utf8")), {
    version: 1,
    disabledBuiltIns: ["from-a-newer-build"],
    futureSetting: 3,
  });

  // A switch that changes nothing does not rewrite the file at all.
  const untouched = JSON.stringify({ disabledBuiltIns: ["from-a-newer-build"] });
  await writeFile(settingsPath, untouched);
  writeDisabledBuiltInSubagent("plan", false, settingsPath);
  writeDisabledBuiltInSubagent("From-A-Newer-Build", true, settingsPath);
  assert.equal(await readFile(settingsPath, "utf8"), untouched);

  await writeFile(settingsPath, JSON.stringify({ version: 1, disabledBuiltIns: "explore" }));
  assert.deepEqual(readSubagentSettings(settingsPath).disabledBuiltIns, []);
});

test("damaged settings fail closed and are not overwritten", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "pi-web-subagent-settings-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const settingsPath = join(root, "settings.json");
  await writeFile(settingsPath, "{");

  assert.equal(isBuiltInSubagentsEnabled(settingsPath), false);
  assert.throws(() => readSubagentSettings(settingsPath));
  assert.throws(() => writeBuiltInSubagentsEnabled(true, settingsPath));
  assert.throws(() => writeDisabledBuiltInSubagent("explore", true, settingsPath));
  // Fails open: an unreadable file must not hide the built-in profiles.
  assert.deepEqual([...disabledBuiltInSubagents(settingsPath)], []);
  assert.equal(await readFile(settingsPath, "utf8"), "{");
});
