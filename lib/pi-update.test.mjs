import assert from "node:assert/strict";
import test from "node:test";
import { createPiAgentReleaseChecker } from "./pi-update.ts";

test("coalesces concurrent release checks and caches a valid official release", async () => {
  let fetchCount = 0;
  let resolveFetch;
  const checker = createPiAgentReleaseChecker({
    fetchImpl: (url) => {
      assert.equal(url, "https://api.github.com/repos/earendil-works/pi/releases/latest");
      fetchCount += 1;
      return new Promise((resolve) => {
        resolveFetch = resolve;
      });
    },
    now: () => 100,
  });

  const first = checker();
  const second = checker();
  assert.equal(fetchCount, 1);
  resolveFetch({ ok: true, json: async () => ({ tag_name: "v1.0.0" }) });

  const expected = {
    latestVersion: "1.0.0",
    releaseUrl: "https://github.com/earendil-works/pi/releases/tag/v1.0.0",
  };
  assert.deepEqual(await first, expected);
  assert.deepEqual(await second, expected);
  assert.deepEqual(await checker(), expected);
  assert.equal(fetchCount, 1);
});

test("returns unavailable after a failure and backs off without inventing a version", async () => {
  let fetchCount = 0;
  let currentTime = 100;
  const checker = createPiAgentReleaseChecker({
    fetchImpl: async () => {
      fetchCount += 1;
      throw new Error("offline");
    },
    now: () => currentTime,
    failureBackoffMs: 500,
  });

  assert.deepEqual(await checker(), { latestVersion: null, releaseUrl: null });
  currentTime += 499;
  assert.deepEqual(await checker(), { latestVersion: null, releaseUrl: null });
  assert.equal(fetchCount, 1);

  currentTime += 1;
  assert.deepEqual(await checker(), { latestVersion: null, releaseUrl: null });
  assert.equal(fetchCount, 2);
});

test("rejects malformed upstream tags instead of fabricating a release link", async () => {
  const checker = createPiAgentReleaseChecker({
    fetchImpl: async () => ({ ok: true, json: async () => ({ tag_name: "v1.0.0/other" }) }),
  });

  assert.deepEqual(await checker(), { latestVersion: null, releaseUrl: null });
});
