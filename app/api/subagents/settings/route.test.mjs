import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { createJiti } from "jiti";

const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
const testAgentDir = await mkdtemp(join(tmpdir(), "pi-web-subagent-settings-route-"));
process.env.PI_CODING_AGENT_DIR = testAgentDir;

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const { GET, PUT } = await jiti.import("./route.ts");

after(async () => {
  if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
  await rm(testAgentDir, { recursive: true, force: true });
});

function request(body, contentType = "application/json") {
  return new Request("http://localhost/api/subagents/settings", {
    method: "PUT",
    headers: { "Content-Type": contentType, Host: "localhost" },
    body: JSON.stringify(body),
  });
}

test("settings route defaults off and persists the global subagent model override", async () => {
  let response = await GET();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { enabled: false, maxConcurrent: 10, subagentModel: null, subagentOverrides: {} });

  response = await PUT(request({ enabled: true }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { enabled: true, maxConcurrent: 10, subagentModel: null, subagentOverrides: {} });
  assert.deepEqual(
    JSON.parse(await readFile(join(testAgentDir, "agents", "settings.json"), "utf8")),
    { version: 1, builtInEnabled: true },
  );

  response = await PUT(request({ subagentModel: " cliproxyapi/gemini-3.8-flash-high " }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { enabled: true, maxConcurrent: 10, subagentModel: "cliproxyapi/gemini-3.8-flash-high", subagentOverrides: {} });
  assert.equal(JSON.parse(await readFile(join(testAgentDir, "agents", "settings.json"), "utf8")).subagentModel, "cliproxyapi/gemini-3.8-flash-high");

  response = await PUT(request({ subagentModel: null }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { enabled: true, maxConcurrent: 10, subagentModel: null, subagentOverrides: {} });
  assert.equal("subagentModel" in JSON.parse(await readFile(join(testAgentDir, "agents", "settings.json"), "utf8")), false);

  response = await PUT(request({ enabled: false }));
  assert.deepEqual(await response.json(), { enabled: false, maxConcurrent: 10, subagentModel: null, subagentOverrides: {} });
});

test("settings route validates mutations", async () => {
  let response = await PUT(request({ enabled: "yes" }));
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "enabled must be a boolean" });

  response = await PUT(request({ subagentModel: "" }));
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "subagentModel must be null or a non-empty string" });

  response = await PUT(request({ subagentModel: 7 }));
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "subagentModel must be null or a non-empty string" });

  response = await PUT(request({ subagentModel: null }));
  assert.equal(response.status, 200);

  response = await PUT(request({ enabled: true }, "text/plain"));
  assert.equal(response.status, 415);
  assert.deepEqual(await response.json(), { error: "Content-Type must be application/json" });
});

test("settings route validates and persists concurrency", async () => {
  let response = await PUT(request({ maxConcurrent: 2 }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { enabled: false, maxConcurrent: 2, subagentModel: null, subagentOverrides: {} });
  response = await PUT(request({ maxConcurrent: 0 }));
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /between 1 and 32/);
});

test("settings route preserves disabled profiles, concurrency, and unknown fields", async () => {
  const settingsPath = join(testAgentDir, "agents", "settings.json");
  await mkdir(join(testAgentDir, "agents"), { recursive: true });
  await writeFile(settingsPath, JSON.stringify({
    version: 1,
    builtInEnabled: true,
    disabledBuiltIns: ["plan"],
    maxConcurrent: 4,
    defaultProfile: "obsolete-from-local-preview",
    futureSetting: "keep",
  }));

  const response = await PUT(request({ subagentModel: "provider/model-id" }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { enabled: true, maxConcurrent: 4, subagentModel: "provider/model-id", subagentOverrides: {} });
  assert.deepEqual(JSON.parse(await readFile(settingsPath, "utf8")), {
    version: 1,
    builtInEnabled: true,
    disabledBuiltIns: ["plan"],
    maxConcurrent: 4,
    futureSetting: "keep",
    subagentModel: "provider/model-id",
  });
});

test("settings route supports per-subagent model and thinking overrides", async () => {
  let response = await PUT(request({
    profileOverride: {
      profile: "worker",
      model: "cliproxyapi/gemini-3.8-flash-high",
      thinking: "high",
    },
  }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    enabled: true,
    maxConcurrent: 4,
    subagentModel: "provider/model-id",
    subagentOverrides: {
      worker: { model: "cliproxyapi/gemini-3.8-flash-high", thinking: "high" },
    },
  });

  // Updating scout independently keeps worker
  response = await PUT(request({
    profileOverride: {
      profile: "scout",
      model: "openai-codex/gpt-5.6-luna",
      thinking: "max",
    },
  }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    enabled: true,
    maxConcurrent: 4,
    subagentModel: "provider/model-id",
    subagentOverrides: {
      worker: { model: "cliproxyapi/gemini-3.8-flash-high", thinking: "high" },
      scout: { model: "openai-codex/gpt-5.6-luna", thinking: "max" },
    },
  });

  // Batch override updates
  response = await PUT(request({
    subagentOverrides: {
      worker: null,
      planner: { model: "anthropic/claude-sonnet", thinking: "medium" },
    },
  }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    enabled: true,
    maxConcurrent: 4,
    subagentModel: "provider/model-id",
    subagentOverrides: {
      scout: { model: "openai-codex/gpt-5.6-luna", thinking: "max" },
      planner: { model: "anthropic/claude-sonnet", thinking: "medium" },
    },
  });

  // Validations
  response = await PUT(request({ profileOverride: { profile: "" } }));
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /profile must be a non-empty string/);

  response = await PUT(request({ profileOverride: { profile: "worker", model: 123 } }));
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /model must be null or a non-empty string/);
});
