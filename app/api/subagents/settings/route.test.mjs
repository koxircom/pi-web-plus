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

test("settings route defaults off and persists switch states and the default profile", async () => {
  let response = await GET();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { enabled: false, maxConcurrent: 10, defaultProfile: "general-purpose" });

  response = await PUT(request({ enabled: true }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { enabled: true, maxConcurrent: 10, defaultProfile: "general-purpose" });
  assert.deepEqual(
    JSON.parse(await readFile(join(testAgentDir, "agents", "settings.json"), "utf8")),
    { version: 1, builtInEnabled: true },
  );

  response = await PUT(request({ defaultProfile: " explore " }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { enabled: true, maxConcurrent: 10, defaultProfile: "explore" });
  assert.equal(JSON.parse(await readFile(join(testAgentDir, "agents", "settings.json"), "utf8")).defaultProfile, "explore");

  response = await PUT(request({ enabled: false }));
  assert.deepEqual(await response.json(), { enabled: false, maxConcurrent: 10, defaultProfile: "explore" });
});

test("settings route validates mutations", async () => {
  let response = await PUT(request({ enabled: "yes" }));
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "enabled must be a boolean" });

  response = await PUT(request({ defaultProfile: "" }));
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "defaultProfile must be a non-empty string" });

  response = await PUT(request({ defaultProfile: 7 }));
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "defaultProfile must be a non-empty string" });

  response = await PUT(request({ enabled: true }, "text/plain"));
  assert.equal(response.status, 415);
  assert.deepEqual(await response.json(), { error: "Content-Type must be application/json" });
});

test("settings route validates and persists concurrency", async () => {
  let response = await PUT(request({ maxConcurrent: 2 }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { enabled: false, maxConcurrent: 2, defaultProfile: "explore" });
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
    futureSetting: "keep",
  }));

  const response = await PUT(request({ defaultProfile: "reviewer" }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { enabled: true, maxConcurrent: 4, defaultProfile: "reviewer" });
  assert.deepEqual(JSON.parse(await readFile(settingsPath, "utf8")), {
    version: 1,
    builtInEnabled: true,
    disabledBuiltIns: ["plan"],
    maxConcurrent: 4,
    futureSetting: "keep",
    defaultProfile: "reviewer",
  });
});
