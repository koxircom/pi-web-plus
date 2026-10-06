const fs = require('node:fs');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const origin = process.env.PI_SELECTION_ORIGIN;
const outputDir = process.env.PI_SELECTION_OUTPUT;
if (!origin || !outputDir || !process.env.PI_SELECTION_SESSION) throw new Error('Set PI_SELECTION_ORIGIN, PI_SELECTION_SESSION and PI_SELECTION_OUTPUT');
fs.mkdirSync(outputDir, { recursive: true });
const apiOrigin = process.env.PI_SELECTION_API_ORIGIN || origin;
const live = process.env.PI_SELECTION_LIVE === '1';
const sid = process.env.PI_SELECTION_SESSION;
const receipt = { origin, version: require('../package.json').version, checks: [], pageErrors: [], blockedWrites: [] };
const toolbar = '[data-pi-native-selection-toolbar]';
(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    for (const width of [1440, 390]) {
      const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 1000 }, locale: 'zh-CN', isMobile: width === 390, hasTouch: width === 390 });
      await context.route('**/*', async route => {
        const req = route.request(), url = new URL(req.url());
        if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method())) {
          receipt.blockedWrites.push(url.pathname);
          return route.fulfill({ status: 403, body: 'Read-only selection verification' });
        }
        if (!live && (url.pathname.startsWith('/api/') || /^\/pi-.*-manifest.json$/.test(url.pathname) || url.pathname === '/pi-usage-ledger.json')) {
          if (/\/events$/.test(url.pathname)) return route.fulfill({ status: 200, contentType: 'text/event-stream', body: 'data: {"type":"connected"}\n\n' });
          const response = await route.fetch({ url: apiOrigin + url.pathname + url.search });
          return route.fulfill({ response });
        }
        return route.continue();
      });
      await context.addInitScript(() => {
        localStorage.setItem('pi-locale', 'zh-CN'); localStorage.setItem('pi-theme', 'dark');
        window.__selectionEvents = 0; window.__copied = '';
        window.addEventListener('pi-web:native-selection-change', e => { if (e.detail) window.__selectionEvents++; });
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { window.__copied = text; } } });
      });
      const page = await context.newPage();
      page.setDefaultTimeout(10000);
      const checkpoint = step => { receipt.step=step; fs.writeFileSync(outputDir+'/CHECKPOINT.json',JSON.stringify(receipt,null,2)); };
      page.on('pageerror', error => receipt.pageErrors.push(error.message));
      await page.goto(origin + '/?session=' + sid, { waitUntil: 'load' });
      const paragraph = page.locator('[data-message-role="assistant"] p').last();
      await paragraph.waitFor({ timeout: 45000 });
      const hide = page.getByRole('button', { name: '隐藏侧边栏', exact: true });
      if (await hide.isVisible()) await hide.click();
      await paragraph.scrollIntoViewIfNeeded();
      // Let the sidebar finish its CSS transition before deriving pointer coordinates.
      await page.waitForTimeout(250);
      const box = await paragraph.boundingBox();
      const x = box.x + 5, y = box.y + Math.min(12, box.height / 2), endX = box.x + Math.min(box.width - 8, 450);
      let check;
      await page.evaluate(() => { window.__selectionEvents = 0; });
      await page.mouse.move(x, y); await page.mouse.down();
      await page.mouse.move(endX, y, { steps: 20 });
      await page.waitForTimeout(150);
      const held = await page.evaluate(() => ({ visible: !!document.querySelector('[data-pi-native-selection-toolbar]'), events: window.__selectionEvents, selected: !!getSelection().toString().trim() }));
      assert(held.selected, 'Gesture must select real message text');
      assert.equal(held.visible, false, 'Toolbar must stay hidden before release');
      assert.equal(held.events, 0, 'Dragging must not publish intermediate selections');
      await page.mouse.up(); await page.locator(toolbar).waitFor({ state: 'visible' });
      const released = await page.evaluate(() => ({ events: window.__selectionEvents, text: getSelection().toString().trim() }));
      assert.equal(released.events, 1, 'Release must publish one final selection');
      await page.screenshot({ path: outputDir + `/${live ? 'live' : 'candidate'}-${width}.png` });
      check = { viewport: { width, height: width === 390 ? 844 : 1000 }, held, releasedEvents: released.events };
      if (!live) {
        await page.getByRole('button', { name: '复制选中文本', exact: true }).click();
        await page.locator(toolbar).waitFor({ state: 'detached' });
        assert.equal(await page.evaluate(() => window.__copied), released.text);
      }
      receipt.checks.push(check);
      fs.writeFileSync(outputDir + '/CHECKPOINT.json',JSON.stringify(receipt,null,2));
      if (!live) {
        // Non-pointer selection changes cover accessibility/keyboard-driven range updates.
        // Headless Chromium does not extend non-editable carets on Shift+ArrowRight.
        await paragraph.evaluate(element => { element.tabIndex=-1; element.focus(); const t = document.createTreeWalker(element, NodeFilter.SHOW_TEXT).nextNode(); getSelection().collapse(t, 0); getSelection().modify("extend", "forward", "word"); });
        check.nonPointerSelectionState = await page.evaluate(() => ({selected:getSelection().toString(),focused:document.activeElement.tagName,events:window.__selectionEvents}));
        await page.locator(toolbar).waitFor({ state: 'visible' });
        checkpoint('non-pointer range visible');
        await page.getByRole('button', { name: '添加引用注释', exact: true }).click();
        checkpoint('quote clicked');
        await page.locator('.pi-enh-annotation-editor').waitFor({ state: 'visible' });
        await page.keyboard.press('Escape');
        await page.locator('.pi-enh-annotation-editor').waitFor({ state: 'detached' });
        check.copyQuoteSelectionChangeEscape = 'passed'; checkpoint('quote Escape passed');
        if (width === 390) {
          const cdp = await context.newCDPSession(page);
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
          await paragraph.evaluate(element => { const range = document.createRange(); range.selectNodeContents(element); const s = getSelection(); s.removeAllRanges(); s.addRange(range); });
          await page.waitForTimeout(50);
          assert.equal(await page.locator(toolbar).count(), 0, 'Touch hold must not show toolbar');
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
          await page.locator(toolbar).waitFor({ state: 'visible' });
          await page.keyboard.press('Escape');
          await page.locator(toolbar).waitFor({ state: 'detached' });
          check.emulatedTouchRelease = 'passed';
        }
        // Losing focus cannot leave the next gesture locked in dragging state.
        await page.mouse.move(x,y); await page.mouse.down();
        await page.evaluate(() => window.dispatchEvent(new Event('blur')));
        await page.mouse.up();
        await page.mouse.move(x,y); await page.mouse.down(); await page.mouse.move(endX,y,{steps:5});
        assert.equal(await page.locator(toolbar).count(),0);
        await page.mouse.up(); await page.locator(toolbar).waitFor({state:'visible'});
        await page.keyboard.press('Escape'); await page.locator(toolbar).waitFor({state:'detached'});
        check.blurRecovery = 'passed'; checkpoint('blur passed');
      }
      await context.unrouteAll({behavior:'ignoreErrors'}); await context.close();
    }
    assert.deepEqual(receipt.pageErrors, []); receipt.status = 'passed';
  } catch (error) { receipt.status = 'failed'; receipt.failure = error.stack; console.log(JSON.stringify({failure:receipt.failure,step:receipt.step})); process.exitCode = 1; }
  finally { for(const c of browser.contexts()) await c.unrouteAll({behavior:'ignoreErrors'}); await browser.close(); fs.writeFileSync(outputDir + `/${live ? 'LIVE_BROWSER_RECEIPT' : 'BROWSER_RECEIPT'}.json`, JSON.stringify(receipt,null,2)); console.log(JSON.stringify(receipt)); }
})();
