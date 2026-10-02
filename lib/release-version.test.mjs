import assert from "node:assert/strict";
import test from "node:test";
import { isNewerReleaseVersion } from "./release-version.ts";
test("version badges hide equal, older and unavailable versions", () => {
  for (const pair of [["1.0.0","1.0.0"],["0.99.2","1.0.0"],["1.1.8","1.1.9"],["bad","1.0.0"],["1.0.1","unknown"]]) assert.equal(isNewerReleaseVersion(...pair),false);
});
test("numeric versions and stable releases after prereleases show an update", () => {
  for (const pair of [["1.0.1","1.0.0"],["1.0.0","0.99.2"],["1.10.0","1.9.0"],["1.1.3","1.1.3-rc.7"],["1.1.3-rc.10","1.1.3-rc.7"]]) assert.equal(isNewerReleaseVersion(...pair),true);
  assert.equal(isNewerReleaseVersion("1.1.3-rc.7","1.1.3"),false);
});
