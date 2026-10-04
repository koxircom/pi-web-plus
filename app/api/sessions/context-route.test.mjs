// Behavior coverage for the context pagination API: test query wiring and
// boundary exclusion without coupling assertions to local variable names.
import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const { buildSessionContext } = await jiti.import("@/lib/session-reader");
const { handleSessionContextRequest } = await jiti.import("@/lib/session-context-service");

test("context route parses ?tail and ?before, excluding the boundary on paging", async () => {
  for (const [query, expectedTail] of [["",50],["tail=NaN",50],["tail=-1",50],["tail=1001",1000],["tail=5",5]]) {
    let captured;
    const response = await handleSessionContextRequest(
      new Request(`http://localhost/api/sessions/s/context?before=cursor&leafId=ignored&deferThinking&deferMedia&${query}`),
      {id:"s"}, {
        getRpc:()=>undefined,
        resolvePath:async()=>"/known/session.jsonl",
        pool:{queryContext:async(file,options)=>{
          captured={file,options};
          return JSON.stringify({context:{messages:[],entryIds:[]},tail:options.tail,before:options.before});
        }},
      });
    assert.equal(response.status,200);
    assert.equal(captured.file,"/known/session.jsonl");
    assert.equal(captured.options.tail,expectedTail);
    assert.equal(captured.options.before,"cursor");
    assert.equal(captured.options.deferThinking,true);
    assert.equal(captured.options.deferToolResultImages,true);
  }
  const entries=[{id:"root",parentId:null,type:"message",message:{role:"user",content:"root"}}];
  const active = {isAlive:()=>true,isRunning:()=>true,inner:{sessionManager:{getEntries:()=>entries,getLeafId:()=>"root"}}};
  const response=await handleSessionContextRequest(
    new Request("http://localhost/api/sessions/s/context?before=root&leafId=ignored"),{id:"s"},{
      getRpc:()=>active,
      resolvePath:async()=>{throw Error("Live context must not scan disk");},
    });
  assert.equal(response.status,200);
  assert.deepEqual((await response.json()).context.entryIds,[]);
});

test("idle retained wrappers use the disk worker for history pages", async () => {
  const idle = { isAlive: () => true, isRunning: () => false };
  let captured;
  const response = await handleSessionContextRequest(
    new Request("http://localhost/api/sessions/s/context?tail=4"),
    { id: "s" },
    {
      getRpc: () => idle,
      resolvePath: async () => "/disk/session.jsonl",
      pool: {
        queryContext: async (file, options) => {
          captured = { file, options };
          return JSON.stringify({ context: { messages: [], entryIds: [] }, tail: options.tail, before: null });
        },
      },
    },
  );

  assert.equal(response.status, 200);
  assert.equal(captured.file, "/disk/session.jsonl");
  assert.equal(captured.options.tail, 4);
});

test("a new writer during a disk page read invalidates the snapshot", async () => {
  const idle = { isAlive: () => true, isRunning: () => false };
  const running = { isAlive: () => true, isRunning: () => true };
  let reads = 0;
  const response = await handleSessionContextRequest(
    new Request("http://localhost/api/sessions/s/context"),
    { id: "s" },
    {
      getRpc: () => ++reads === 1 ? idle : running,
      resolvePath: async () => "/disk/session.jsonl",
      pool: {
        queryContext: async () => JSON.stringify({ context: { messages: [], entryIds: [] }, tail: 50, before: null }),
      },
    },
  );

  assert.equal(response.status, 409);
});

test("context route: ?before pages upward without duplicating the boundary", () => {
  const entries = [];
  for (let i = 0; i < 100; i++) {
    entries.push({ id: `e${i}`, parentId: i === 0 ? null : `e${i - 1}`, type: "message", timestamp: new Date(1000 + i * 1000).toISOString(), message: { role: "user", content: `m${i}` } });
  }
  const page1 = buildSessionContext(entries, "e99", { tail: 5 }).entryIds;
  assert.deepEqual(page1, ["e95", "e96", "e97", "e98", "e99"]);
  const oldest = page1[0]; // e95
  const page2 = buildSessionContext(entries, oldest, { tail: 5, excludeLeaf: true }).entryIds;
  assert.equal(page2[page2.length - 1], "e94");
  assert.ok(!page2.includes(oldest), "boundary `before` must not be duplicated");
  assert.ok(page1.every((id) => !page2.includes(id)), "adjacent pages share no entry");
});

test("context route data reports when pagination reaches the root", () => {
  const entries = [
    { id: "e0", parentId: null, type: "message", timestamp: new Date(1000).toISOString(), message: { role: "user", content: "root" } },
  ];
  const page = buildSessionContext(entries, "e0", { tail: 50, excludeLeaf: true });
  assert.deepEqual(page.entryIds, []);
  assert.equal(page.hasMore, false);
});
