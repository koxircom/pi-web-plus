const fs = require('fs');
const assert = require('assert/strict');
const { chromium } = require(process.env.PI_WEB_PLAYWRIGHT_MODULE || 'playwright');
assert(process.env.PI_WEB_QUOTE_TEST_ROOT, 'PI_WEB_QUOTE_TEST_ROOT required');
const R = fs.realpathSync(process.env.PI_WEB_QUOTE_TEST_ROOT);
assert(fs.existsSync(R + '/fixtures/manifest.json'), 'synthetic fixture manifest required');
const sid = '00000000-0000-4000-8000-000000000001';
const servers = JSON.parse(fs.readFileSync(R + '/SERVER_RECEIPT.json')).servers;
const server = servers.find(s => s.key === 'candidate132');
assert(server && server.port === 39123 && server.agentDir.startsWith(R + '/fixtures/'), 'isolated synthetic target required');
const result = { buildId: server.buildId, target: 'http://127.0.0.1:39123', checks: [] };
(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    page.setDefaultTimeout(15000);
    await page.addInitScript(() => { localStorage.setItem('pi-theme', 'dark'); localStorage.setItem('pi-locale', 'zh-CN'); });
    await page.goto(result.target + '/?session=' + sid, { waitUntil: 'domcontentloaded' });
    await page.getByText('基准A尾部', { exact: true }).waitFor();
    await page.waitForFunction(() => window.__PI_WEB_ENHANCEMENTS_LOADED__);
    const paragraph = page.locator('.markdown-body p').filter({ hasText: /^基准A尾部$/ });
    const drag = async () => {
      await paragraph.scrollIntoViewIfNeeded();
      const box = await paragraph.boundingBox();
      await page.mouse.move(box.x + 1, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + 82, box.y + box.height / 2, { steps: 10 });
      await page.mouse.up();
      await page.waitForTimeout(300);
      assert.match(await page.evaluate(() => getSelection().toString()), /基准A尾部/);
      assert(await page.locator('.pi-enh-quote-bar').isVisible());
    };
    const add = async () => {
      await drag();
      await page.locator('.pi-enh-quote-bar button').filter({ hasText: '引用' }).click();
      await page.locator('.pi-enh-annotation-editor textarea').fill('引用生命周期验收');
      await page.locator('.pi-enh-annotation-editor button[aria-label="保存注释"]').click();
      await page.locator('.pi-enh-annotation-badge').waitFor();
    };
    let badge;
    if (!process.env.PI_WEB_QUOTE_RESUME_REMAINING) {
    for (let n = 0; n < 3; n++) {
      await add();
      const badge = page.locator('.pi-enh-annotation-badge');
      await page.mouse.move(10, 10);
      await page.waitForTimeout(180);
      assert.equal(await badge.locator('input').evaluate(e => getComputedStyle(e).display), 'none');
      assert.equal(await badge.locator('.pi-enh-annotation-badge-remove').evaluate(e => getComputedStyle(e).opacity), '0');
      await badge.hover();
      await page.waitForTimeout(180);
      const hover = await badge.locator('.pi-enh-annotation-badge-remove').evaluate(e => ({ opacity: getComputedStyle(e).opacity, radius: getComputedStyle(e).borderRadius, width: e.getBoundingClientRect().width }));
      assert.equal(hover.opacity, '1'); assert.equal(hover.radius, '50%'); assert.equal(hover.width, 20);
      if (n === 0) await page.screenshot({ path: R + '/results/quote-single-hover.png' });
      await badge.locator('.pi-enh-annotation-badge-remove').click();
      await page.locator('.pi-enh-annotation-badge').waitFor({ state: 'detached' });
      await drag();
      result.checks.push('delete_then_reselect_' + (n + 1));
    }
    await add(); await add();
    badge = page.locator('.pi-enh-annotation-badge');
    assert.equal(await badge.getAttribute('data-annotation-count'), '2');
    await page.mouse.move(10, 10); await page.waitForTimeout(180);
    assert.equal(await badge.locator('input').evaluate(e => getComputedStyle(e).opacity), '0');
    await badge.hover(); await page.waitForTimeout(180);
    assert.equal(await badge.locator('input').evaluate(e => getComputedStyle(e).opacity), '1');
    await page.screenshot({ path: R + '/results/quote-multiple-hover.png' });
    await badge.locator('input').check();
    await badge.locator('.pi-enh-annotation-badge-remove').click();
    await page.locator('.pi-enh-annotation-badge').waitFor({ state: 'detached' });
    await drag();
    result.checks.push('multi_hover_and_batch_delete');
    } else {
      const previous = JSON.parse(fs.readFileSync(R + '/results/QUOTE_ACCEPTANCE.json'));
      assert.equal(previous.buildId, result.buildId, 'resume must use same candidate');
      assert.deepEqual(previous.checks, ['delete_then_reselect_1', 'delete_then_reselect_2', 'delete_then_reselect_3', 'multi_hover_and_batch_delete']);
      result.checks.push(...previous.checks);
      await drag();
    }
    await page.locator('.pi-enh-quote-bar button').filter({ hasText: '引用' }).click();
    await page.locator('.pi-enh-annotation-editor textarea').fill('点击正文自动保存');
    await drag();
    assert.equal(await page.locator('.pi-enh-annotation-editor').count(), 0);
    result.checks.push('outside_autosave_preserves_new_selection');
    await page.locator('.pi-enh-annotation-badge').hover();
    await page.locator('.pi-enh-annotation-badge-remove').click();
    await page.close();
    const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await mobile.addInitScript(() => { localStorage.setItem('pi-theme', 'dark'); localStorage.setItem('pi-locale', 'zh-CN'); });
    await mobile.goto(result.target + '/?session=' + sid, { waitUntil: 'domcontentloaded' });
    await mobile.getByText('基准A尾部', { exact: true }).waitFor();
    await mobile.waitForFunction(() => window.__PI_WEB_ENHANCEMENTS_LOADED__);
    // Browser-native selection starts the same quote path, without a real mobile long-press gesture.
    await mobile.getByText('基准A尾部', { exact: true }).evaluate(e => { const r = document.createRange(); r.selectNodeContents(e); const s = getSelection(); s.removeAllRanges(); s.addRange(r); document.dispatchEvent(new Event('selectionchange')); });
    await mobile.locator('.pi-enh-quote-bar button').filter({ hasText: '引用' }).click();
    await mobile.locator('.pi-enh-annotation-editor button[aria-label="保存注释"]').click();
    badge = mobile.locator('.pi-enh-annotation-badge');
    assert.equal(await badge.locator('input').evaluate(e => getComputedStyle(e).display), 'none');
    assert.equal(await badge.locator('.pi-enh-annotation-badge-remove').evaluate(e => getComputedStyle(e).opacity), '1');
    await mobile.screenshot({ path: R + '/results/quote-mobile.png' });
    await badge.locator('.pi-enh-annotation-badge-remove').click();
    await mobile.locator('.pi-enh-annotation-badge').waitFor({ state: 'detached' });
    result.checks.push('mobile_touch_delete_visible');
    result.status = 'passed';
  } catch (e) { result.status = 'failed'; result.error = e.stack; process.exitCode = 1; }
  finally { await browser.close(); fs.writeFileSync(R + '/results/QUOTE_ACCEPTANCE.json', JSON.stringify(result, null, 2)); console.log(JSON.stringify(result)); }
})();
