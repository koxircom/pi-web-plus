import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { createJiti } from "jiti";

const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
const testAgentDir = await mkdtemp(join(tmpdir(), "pi-web-models-config-route-"));
process.env.PI_CODING_AGENT_DIR = testAgentDir;

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const { GET, PUT } = await jiti.import("./route.ts");
const modelsPath = join(testAgentDir, "models.json");

after(async () => {
  if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
  await rm(testAgentDir, { recursive: true, force: true });
});

function put(body) {
  return new Request("http://localhost/api/models-config", {
    method: "PUT",
    headers: { "Content-Type": "application/json", Host: "localhost" },
    body: JSON.stringify(body),
  });
}

test("a models.json with a syntax error is reported instead of read as empty, and a save cannot replace it", async () => {
  const original = '{ "providers": { "acme": { "models": [ } } }';
  await writeFile(modelsPath, original);

  let response = await GET();
  assert.equal(response.status, 422);
  assert.match((await response.json()).error, /models\.json/);

  response = await PUT(put({ providers: {} }));
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /models\.json/);
  assert.equal(await readFile(modelsPath, "utf8"), original);
});

test("models-config API rejects missing providers without replacing valid or invalid files", async () => {
  const validConfig = { providers: { acme: { models: [{ id: "acme-1" }] } } };
  await writeFile(modelsPath, JSON.stringify(validConfig));

  let response = await PUT(put({ success: true, quickShortcuts: [{ id: "chat" }] }));
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: 'Invalid models.json config: "providers" is required and must be an object',
  });
  assert.deepEqual(JSON.parse(await readFile(modelsPath, "utf8")), validConfig);

  const invalidConfig = JSON.stringify({ success: true, quickShortcuts: [{ id: "chat" }] });
  await writeFile(modelsPath, invalidConfig);
  response = await GET();
  assert.equal(response.status, 422);
  assert.match((await response.json()).error, /providers/);

  response = await PUT(put({ providers: {} }));
  assert.equal(response.status, 409);
  assert.equal(await readFile(modelsPath, "utf8"), invalidConfig);
});

test("a commented models.json loads with its providers", async () => {
  await writeFile(modelsPath, '{\n  // local models\n  "providers": { "acme": { "models": [{ "id": "a" },] } },\n}\n');

  const response = await GET();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { providers: { acme: { models: [{ id: "a" }] } } });
});
