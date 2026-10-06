// Isolated browser regression: unread remains visible without continuous layout.
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const origin = process.env.PI_WEB_TEST_ORIGIN;
const cwd = process.env.PI_WEB_TEST_CWD;
const session = process.env.PI_WEB_TEST_SESSION;
const output = process.env.PI_WEB_TEST_OUTPUT;
const baseline = process.argv.includes('--baseline');
assert(origin && cwd && session && output, 'Explicit isolated origin, cwd, session and output required');
assert.equal(new URL(origin).hostname, '127.0.0.1');
fs.mkdirSync(output, { recursive: true });

(async () => {
  const models = await (await fetch(origin + '/api/models?cwd=' + encodeURIComponent(cwd))).json();
  assert.equal(models.defaultModel?.provider, 'fixture', 'Refuse production models');
  assert(models.modelList?.length && models.modelList.every(m => m.provider === 'fixture'));
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const result = { origin, baseline, checks: [], errors: [] };
  try {
    for (const mobile of baseline ? [false] : [false, true]) {
      const width = mobile ? 390 : 1440;
      const context = await browser.newContext({ viewport: { width, height: mobile ? 844 : 1000 }, isMobile: mobile, hasTouch: mobile, locale: 'zh-CN' });
      await context.addInitScript(() => { localStorage.setItem('pi-locale', 'zh-CN'); localStorage.setItem('pi-theme', 'dark'); });
      const page = await context.newPage();
      page.setDefaultTimeout(12000);
      page.on('pageerror', e => result.errors.push(e.message));
      await page.goto(origin + '/?session=' + encodeURIComponent(session), { waitUntil: 'domcontentloaded' });
      await page.locator('textarea.chat-input-textarea').waitFor();
      await page.locator('[data-message-role]').first().waitFor();
      await page.waitForFunction(() => typeof window.__PI_ENH_TOGGLE_SESSION_UNREAD__ === 'function');
      const showSidebar = page.getByRole('button', { name: '显示侧边栏', exact: true });
      if (await showSidebar.isVisible()) await showSidebar.click();
      await page.locator('.pi-enh-session-row-host').first().waitFor();
      const unread = await page.evaluate(current => {
        const sid = [...document.querySelectorAll('.pi-enh-session-row-host')].map(e => e.dataset.piEnhSessionId).find(id => id && !id.startsWith('new:') && id !== current);
        if (!sid) throw Error('No visible second fixture session');
        window.__PI_ENH_TOGGLE_SESSION_UNREAD__(sid, true);
        return sid;
      }, session);
      const row = page.locator('.pi-enh-session-row-host').filter({ has: page.locator('[aria-label="会话有新活动"]') }).first();
      await row.waitFor();
      // Measure idle, after history hydration and deferred first-load UI settle.
      await page.waitForTimeout(4000);
      const cdp = await context.newCDPSession(page);
      await cdp.send('Performance.enable');
      const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]));
      const before = await metrics();
      await page.waitForTimeout(5000);
      const after = await metrics();
      const check = { width, unread, layoutCount: after.LayoutCount - before.LayoutCount, taskMs: (after.TaskDuration - before.TaskDuration) * 1000, svgRadiusAnimations: await row.locator('animate[attributeName="r"]').count() };
      result.checks.push(check);
      if (!baseline) { assert.equal(check.svgRadiusAnimations, 0); assert(check.layoutCount <= 10, 'Idle unread badge repeatedly lays out the document'); }
      await page.screenshot({ path: output + '/unread-' + width + '.png' });
      await page.locator('[data-pi-enh-session-id="' + unread + '"]').click();
      await page.waitForFunction(sid => !document.querySelector('[data-pi-enh-session-id="' + sid + '"] [aria-label="会话有新活动"]'), unread);
      check.clearsOnRead = true;
      if (mobile) {
        const hide = page.getByRole('button', { name: '隐藏侧边栏', exact: true });
        if (await hide.isVisible()) await hide.click();
        await page.waitForFunction(() => document.querySelector('.sidebar-container').getBoundingClientRect().right <= 1);
      }
      const input = page.locator('textarea.chat-input-textarea');
      assert(await input.isEnabled());
      assert(await input.isVisible());
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.screenshot({ path: output + '/chat-' + width + '.png' });
      await context.close();
    }
    assert.deepEqual(result.errors, []);
    result.status = 'passed';
  } catch (e) { result.status = 'failed'; result.failure = e.stack; process.exitCode = 1; }
  finally { await browser.close(); fs.writeFileSync(output + '/sidebar-idle.json', JSON.stringify(result, null, 2)); console.log(JSON.stringify(result)); }
})().catch(e => { console.error(e); process.exitCode = 1; });
