import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { SessionDetailManagerCache } = await jiti.import("./session-detail-manager-cache.ts");

test("detail manager cache is fingerprinted, LRU, and bounded by byte and entry caps", () => {
  const cache = new SessionDetailManagerCache({ maxEntries: 2, maxTotalBytes: 5, maxFileBytes: 5 });
  const a = { id: "a" };
  const b = { id: "b" };
  const c = { id: "c" };

  cache.set("a", "a-v1", 3, a);
  cache.set("b", "b-v1", 2, b);
  assert.equal(cache.get("a", "a-v1", 3), a); // touch a so b is least-recently used
  cache.set("c", "c-v1", 2, c);

  assert.equal(cache.get("a", "a-v1", 3), a);
  assert.equal(cache.get("b", "b-v1", 2), undefined);
  assert.equal(cache.get("c", "c-v1", 2), c);
  assert.equal(cache.getTotalBytes(), 5);
  assert.equal(cache.getSize(), 2);

  assert.equal(cache.get("a", "a-v2", 3), undefined);
  cache.set("oversize", "large", 6, { id: "oversize" });
  assert.equal(cache.get("oversize", "large", 6), undefined);
  assert.equal(cache.getTotalBytes(), 2);
});
