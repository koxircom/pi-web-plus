import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sourceDir = path.resolve(__dirname, "..");
const cssPath = path.resolve(sourceDir, "app/enhancements.css");
const mod06Path = path.resolve(sourceDir, "enhancements/modules/06-chat-view-and-tool-cards.js");

// 从 06 模块中精准提取 modelSpeedColor 和 upsertModelSpeedBadge 函数源码用于隔离沙盒测试
const mod06Source = fs.readFileSync(mod06Path, "utf8");
const colorMatch = mod06Source.match(/function modelSpeedColor\([\s\S]*?\n  \}/);
const upsertMatch = mod06Source.match(/function upsertModelSpeedBadge\([\s\S]*?\n  \}/);

assert.ok(colorMatch, "must extract modelSpeedColor from module 06");
assert.ok(upsertMatch, "must extract upsertModelSpeedBadge from module 06");

const speedHelperSnippet = `
${colorMatch[0]}
${upsertMatch[0]}
`;

test("Model generation speed inline badge in Chromium", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const cssContent = fs.readFileSync(cssPath, "utf8");

    await page.setContent(`<!DOCTYPE html>
<html>
<head>
  <style>
    ${cssContent}
  </style>
</head>
<body>
  <!-- Message 1: 带有 provider 的标准助手消息 -->
  <div data-message-role="assistant" data-entry-id="entry-1">
    <div style="font-size: 11px; color: #888; margin-bottom: 4px; display: flex; align-items: center; gap: 6px;">
      <span style="display: inline-flex; align-items: center; gap: 6px; max-width: 100%; min-width: 0;">
        <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0;" title="gateway/claude-sonnet-5">gateway/claude-sonnet-5</span>
        <span data-pi-model-speed-host="" style="display: inline-flex; align-items: center; flex-shrink: 0; white-space: nowrap;"></span>
      </span>
      <span id="est-tokens" style="display: flex; align-items: center; gap: 4;">128 tokens</span>
      <button class="assistant-message-copy" style="margin-left: auto;">Copy</button>
    </div>
    <div class="content">回答正文 1</div>
  </div>

  <!-- Message 2: 同 entry 分段的第二个消息容器 (同 entryId) -->
  <div data-message-role="assistant" data-entry-id="entry-1">
    <div style="font-size: 11px; color: #888; margin-bottom: 4px; display: flex; align-items: center; gap: 6px;">
      <span style="display: inline-flex; align-items: center; gap: 6px; max-width: 100%; min-width: 0;">
        <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0;" title="gateway/claude-sonnet-5">gateway/claude-sonnet-5</span>
        <span data-pi-model-speed-host="" style="display: inline-flex; align-items: center; flex-shrink: 0; white-space: nowrap;"></span>
      </span>
    </div>
    <div class="content">分段正文 2</div>
  </div>

  <!-- Message 3: 无 provider 消息 (没有 speed host) -->
  <div data-message-role="assistant" data-entry-id="entry-no-provider">
    <div style="font-size: 11px; color: #888; margin-bottom: 4px; display: flex; align-items: center; gap: 6px;">
      <button class="assistant-message-copy">Copy</button>
    </div>
    <div class="content">无 provider 正文</div>
  </div>

  <script>
    ${speedHelperSnippet}
  </script>
</body>
</html>`);

    // 1. 验证空 host 的 display: none（避免禁用留白）
    const initialDisplay = await page.evaluate(() => {
      const host = document.querySelector('[data-entry-id="entry-1"] [data-pi-model-speed-host]');
      return window.getComputedStyle(host).display;
    });
    assert.equal(initialDisplay, "none", "Empty host must have display: none to avoid layout spacing");

    // 2. 模拟运行流式实时速度 (live: true)
    await page.evaluate(() => {
      const msgs = document.querySelectorAll('[data-entry-id="entry-1"]');
      msgs.forEach(msg => {
        window.upsertModelSpeedBadge(msg, {
          output: 45,
          durationSec: 1.5,
          tps: 30.0,
          live: true,
        });
      });
    });

    // 检查 host 变为 inline-flex，内部成功挂载 badge
    const liveCheck = await page.evaluate(() => {
      const host = document.querySelector('[data-entry-id="entry-1"] [data-pi-model-speed-host]');
      const badge = host.querySelector('.pi-enh-model-speed');
      const cs = window.getComputedStyle(host);
      return {
        hostDisplay: cs.display,
        badgeText: badge ? badge.textContent : null,
        badgeDataLive: badge ? badge.getAttribute("data-live") : null,
        badgeOutput: badge ? badge.getAttribute("data-output-tokens") : null,
        childCount: host.children.length,
      };
    });
    assert.ok(liveCheck.hostDisplay === "flex" || liveCheck.hostDisplay === "inline-flex", "Populated host must be display: flex/inline-flex");
    assert.equal(liveCheck.badgeText, "30.0 t/s");
    assert.equal(liveCheck.badgeDataLive, "true");
    assert.equal(liveCheck.badgeOutput, "45");
    assert.equal(liveCheck.childCount, 1, "Only 1 badge inside host");

    // 3. 验证同 entry 分段的第二个消息容器也有且仅有 1 个 badge
    const secondMsgCheck = await page.evaluate(() => {
      const msgs = document.querySelectorAll('[data-entry-id="entry-1"]');
      const host2 = msgs[1].querySelector('[data-pi-model-speed-host]');
      const badge2 = host2.querySelector('.pi-enh-model-speed');
      return {
        badgeText: badge2 ? badge2.textContent : null,
        childCount: host2.children.length,
      };
    });
    assert.equal(secondMsgCheck.badgeText, "30.0 t/s");
    assert.equal(secondMsgCheck.childCount, 1);

    // 4. 重复挂载与幂等性：再次调用 upsert，不能产生多余 badge
    await page.evaluate(() => {
      const msgs = document.querySelectorAll('[data-entry-id="entry-1"]');
      msgs.forEach(msg => {
        window.upsertModelSpeedBadge(msg, {
          output: 60,
          durationSec: 1.5,
          tps: 40.0,
          live: false,
        });
      });
    });

    const dedupCheck = await page.evaluate(() => {
      const host = document.querySelector('[data-entry-id="entry-1"] [data-pi-model-speed-host]');
      const badges = host.querySelectorAll('.pi-enh-model-speed');
      return {
        count: badges.length,
        text: badges[0]?.textContent,
        live: badges[0]?.getAttribute("data-live"),
        output: badges[0]?.getAttribute("data-output-tokens"),
      };
    });
    assert.equal(dedupCheck.count, 1, "Must never duplicate badge on re-render / updates");
    assert.equal(dedupCheck.text, "40.0 t/s");
    assert.equal(dedupCheck.live, "false");
    assert.equal(dedupCheck.output, "60");

    // 5. 验证无 provider 消息调用 upsert 安全退出，不插入任何错误节点
    const noProviderCheck = await page.evaluate(() => {
      const msg = document.querySelector('[data-entry-id="entry-no-provider"]');
      window.upsertModelSpeedBadge(msg, { output: 10, durationSec: 1, tps: 10 });
      return msg.querySelector('.pi-enh-model-speed');
    });
    assert.equal(noProviderCheck, null, "Should not attach badge to message without speed host");

    // 6. 验证 metrics 清空时清除 badge，host 恢复为空，display 恢复为 none
    await page.evaluate(() => {
      const msgs = document.querySelectorAll('[data-entry-id="entry-1"]');
      msgs.forEach(msg => {
        window.upsertModelSpeedBadge(msg, null);
      });
    });

    const clearedDisplay = await page.evaluate(() => {
      const host = document.querySelector('[data-entry-id="entry-1"] [data-pi-model-speed-host]');
      return {
        childCount: host.children.length,
        display: window.getComputedStyle(host).display,
      };
    });
    assert.equal(clearedDisplay.childCount, 0, "Host children must be cleared");
    assert.equal(clearedDisplay.display, "none", "Empty host must revert to display: none");

  } finally {
    await browser.close();
  }
});
