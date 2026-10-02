import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() }, interopDefault: true });
const { GET: getAgent } = await jiti.import("./[id]/route.ts");
const { GET: getSession } = await jiti.import("../sessions/[id]/state/route.ts");
const { GET: getRunning } = await jiti.import("./running/route.ts");

test("idle retained runtime and active turns report the same activity on both state routes and sidebar", async (t) => {
  const prior = globalThis.__piSessions;
  t.after(() => { globalThis.__piSessions = prior; });
  const id = "isolated-activity-contract";
  for (const state of [
    { isStreaming: false, isPromptRunning: false, isCompacting: false, isBashRunning: false },
    { isStreaming: true, isPromptRunning: false, isCompacting: false, isBashRunning: false },
    { isStreaming: false, isPromptRunning: true, isCompacting: false, isBashRunning: false },
    { isStreaming: false, isPromptRunning: false, isCompacting: true, isBashRunning: false },
    { isStreaming: false, isPromptRunning: false, isCompacting: false, isBashRunning: true },
  ]) {
    const busy = Object.values(state).some(Boolean);
    globalThis.__piSessions = new Map([[id, {
      sessionId: id,
      isAlive: () => true,
      isRunning: () => busy,
      hasSuppressedCompletionNotifications: () => false,
      send: async (cmd) => { assert.equal(cmd.type, "get_state"); return state; },
    }]]);
    for (const get of [getAgent, getSession]) {
      const result = await get(new Request("http://localhost/api/isolated"), { params: Promise.resolve({ id }) });
      assert.equal(result.status, 200);
      assert.deepEqual(await result.json(), { running: busy, runtimeAlive: true, state });
    }
    const sidebar = await (await getRunning()).json();
    assert.equal(sidebar.runningSessionIds.includes(id), busy);
  }
});
