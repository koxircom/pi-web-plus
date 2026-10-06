"use strict";
// Isolated product regression: every API response is synthetic; all writes are blocked.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const origin = process.argv[2];
assert(origin && ["127.0.0.1", "localhost"].includes(new URL(origin).hostname), "Use an isolated loopback instance");
const outputDir = process.argv[3] || process.cwd();
fs.mkdirSync(outputDir, { recursive: true });
const sid = "00000000-0000-4000-8000-000000001323";
const cwd = "/tmp/pi-addon-badge-fixture";
const sessions = Array.from({ length: 120 }, (_, index) => ({
  id: index === 0 ? sid : `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
  name: index === 0 ? "客户门户标签验收" : `其他会话 ${index}`,
  cwd, path: "", firstMessage: "检查插件更新标签", messageCount: 2,
  created: "2026-10-05T00:00:00.000Z",
  modified: new Date(Date.UTC(2026, 9, 6, 0, 0, 45 - index)).toISOString(),
}));
const baseManifest = {
  revision: 10, updatedAt: "2026-10-06T00:00:00.000Z",
  sessions: { [sid]: [{ technical: "kx_portal", status: "已更新" }] },
  latestByAddon: { kx_portal: { sessionId: sid } },
};
const receipt = { origin, checks: [], errors: [], blockedWrites: [] };

async function badgeGeometry(row) {
  return row.evaluate((element) => {
    const host = element.getBoundingClientRect();
    const badges = [...element.querySelectorAll(".pi-enh-odoo-addon-pill")];
    return { count: badges.length, height: host.height, contained: badges.every((badge) => {
      const box = badge.getBoundingClientRect();
      return box.width > 0 && box.height > 0 && box.top >= host.top && box.bottom <= host.bottom + 1
        && box.left >= host.left && box.right <= host.right + 1;
    }) };
  });
}

(async () => {
  let activePage;
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  try {
    for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
      let manifest = structuredClone(baseManifest);
      const context = await browser.newContext({ viewport, locale: "zh-CN", isMobile: viewport.width < 500, hasTouch: viewport.width < 500 });
      await context.addInitScript(() => {
        localStorage.setItem("pi-locale", "zh-CN");
        localStorage.setItem("pi-theme", "dark");
      });
      await context.route("**/*", async (route) => {
        const request = route.request(), url = new URL(request.url());
        if (!["GET", "HEAD", "OPTIONS"].includes(request.method())) {
          receipt.blockedWrites.push(url.pathname);
          return route.fulfill({ status: 403, body: "Fixture: writes blocked" });
        }
        if (url.pathname === "/pi-odoo-addons-manifest.json") return route.fulfill({ json: manifest });
        if (!url.pathname.startsWith("/api/")) return route.continue();
        if (request.method() === "HEAD") return route.fulfill({ headers: { "x-pi-enhancement-state": "durable" } });
        if (url.pathname === "/api/sessions") return route.fulfill({ json: { sessions, sessionListVersion: 1, runningSessionIds: [] } });
        if (url.pathname === "/api/agent/running") return route.fulfill({ json: { runningSessionIds: [], completionNotificationSuppressedSessionIds: [] } });
        if (url.pathname === "/api/enhancement-state") return route.fulfill({ json: { revision: 1, state: {
          sessionTagsDefinitions: [{ id: "unfinished", name: "Pi未完成", color: "#eab308" }],
          sessionTagMappings: { [sid]: ["unfinished"] },
        } } });
        return route.fulfill({ json: {} });
      });
      const page = await context.newPage();
      activePage = page;
      page.on("pageerror", (error) => receipt.errors.push(error.message));
      await page.goto(`${origin}/?cwd=${encodeURIComponent(cwd)}`, { waitUntil: "load" });
      const openSidebar = page.getByRole("button", { name: "显示侧边栏", exact: true });
      if (await openSidebar.count()) await openSidebar.click();
      const row = page.locator(`[data-pi-enh-session-id="${sid}"]`);
      await row.locator(".pi-enh-odoo-addon-pill").waitFor();
      assert.equal(await row.locator(".pi-enh-odoo-addon-pill.is-latest").count(), 1);

      // The escaped rename and manifest refresh race previously lost the badge permanently.
      if (viewport.width >= 500) await row.hover();
      await row.getByRole("button", { name: "会话更多操作" }).click();
      await page.locator('.pi-enh-session-menu [data-session-action="rename"]').click();
      await row.locator("input").waitFor();
      manifest.revision += 1;
      manifest.updatedAt = "2026-10-06T00:00:01.000Z";
      const versionRefresh = await page.evaluate(() => window.__PI_ENH_REFRESH_SESSION_ODOO_ADDONS_MANIFEST__({ force: true }));
      assert.equal(versionRefresh.versionChanged, true);
      await page.keyboard.press("Escape");
      await row.locator("input").waitFor({ state: "detached" });
      await row.locator(".pi-enh-odoo-addon-pill").waitFor();

      if (viewport.width >= 500) await row.hover();
      await row.getByRole("button", { name: "会话更多操作" }).click();
      await page.locator('.pi-enh-session-menu [data-session-action="rename"]').click();
      await row.locator("input").waitFor();
      manifest.revision += 1;
      manifest.sessions[sid].push({ technical: "kx_stock", status: "已修改" }, { technical: "kx_read_only", status: "未改动" });
      const contentRefresh = await page.evaluate(() => window.__PI_ENH_REFRESH_SESSION_ODOO_ADDONS_MANIFEST__({ force: true }));
      assert.equal(contentRefresh.changed, true);
      await page.keyboard.press("Escape");
      await row.locator("input").waitFor({ state: "detached" });
      await page.waitForFunction((sid) => document.querySelectorAll(`[data-pi-enh-session-id="${sid}"] .pi-enh-odoo-addon-pill`).length === 2, sid);
      const unchanged = await page.evaluate(() => window.__PI_ENH_REFRESH_SESSION_ODOO_ADDONS_MANIFEST__({ force: true }));
      assert.equal(unchanged.changed, false);
      assert.equal(await row.locator(".pi-enh-odoo-addon-pill").count(), 2);
      const geometry = await badgeGeometry(row);
      assert(geometry.contained, "Both badges must fit inside the virtual row");

      // Release the row's retained edit focus before testing virtual unmount.
      const secondRow = page.locator(`[data-pi-enh-session-id="${sessions[1].id}"]`);
      if (viewport.width >= 500) await secondRow.hover();
      await secondRow.getByRole("button", { name: "会话更多操作" }).focus();
      await page.getByRole("button", { name: "新建", exact: true }).focus();
      const scrollHost = await row.evaluateHandle((element) => {
        let host = element.parentElement;
        while (host && !(host.scrollHeight > host.clientHeight && getComputedStyle(host).overflowY === "auto")) host = host.parentElement;
        return host;
      });
      await scrollHost.evaluate((host) => { host.scrollTop = host.scrollHeight; });
      await row.waitFor({ state: "detached" });
      await scrollHost.evaluate((host) => { host.scrollTop = 0; });
      await row.locator(".pi-enh-odoo-addon-pill").first().waitFor();
      assert.equal(await row.locator(".pi-enh-odoo-addon-pill").count(), 2);
      await page.evaluate(() => window.__PI_ENH_SET_PLUGIN__("session-odoo-addons", false));
      await page.waitForFunction((sid) => document.querySelectorAll(`[data-pi-enh-session-id="${sid}"] .pi-enh-odoo-addon-pill`).length === 0, sid);
      await page.evaluate(() => window.__PI_ENH_SET_PLUGIN__("session-odoo-addons", true));
      await row.locator(".pi-enh-odoo-addon-pill").first().waitFor();
      assert.equal(await row.locator(".pi-enh-odoo-addon-pill").count(), 2);
      await page.screenshot({ path: path.join(outputDir, `addon-badges-${viewport.width}.png`) });
      receipt.checks.push({ viewport, versionRefresh: "restored after Escape", contentRefresh: "two confirmed addons; read-only addon excluded", unchanged: "no duplicate or missing badge", virtualRemount: "preserved", offOn: "restored", geometry });
      await context.close();
    }
    assert.deepEqual(receipt.errors, []);
    receipt.status = "passed";
  } catch (error) {
    receipt.status = "failed";
    if (activePage && !activePage.isClosed()) {
      await activePage.screenshot({ path: path.join(outputDir, "addon-badges-failure.png") });
      receipt.dom = await activePage.evaluate((sid) => {
        const row = document.querySelector(`[data-pi-enh-session-id="${sid}"]`);
        return { row: row?.outerHTML, rect: row?.getBoundingClientRect().toJSON() };
      }, sid);
    }
    receipt.failure = error.stack;
    process.exitCode = 1;
  } finally {
    await browser.close();
    fs.writeFileSync(path.join(outputDir, "addon-badges-browser.json"), JSON.stringify(receipt, null, 2));
    console.log(JSON.stringify(receipt));
  }
})();
