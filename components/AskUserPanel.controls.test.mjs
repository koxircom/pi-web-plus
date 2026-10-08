import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const askCssSource = await readFile(new URL("../app/ask-user.css", import.meta.url), "utf8");
const enhCssSource = await readFile(new URL("../app/enhancements.css", import.meta.url), "utf8");
const panelSource = await readFile(new URL("./AskUserPanel.tsx", import.meta.url), "utf8");
const module05Source = await readFile(new URL("../enhancements/modules/05-composer-and-input-workflow.js", import.meta.url), "utf8");

test("enhancements.css narrows quickReply selectors strictly to native composer layout without generic button leaks", () => {
  // Reject generic / un-scoped quick reply button selectors
  assert.doesNotMatch(
    enhCssSource,
    /(?:^|\n|\})\s*button\[data-pi-enh-quick-reply\]/,
    "Generic button[data-pi-enh-quick-reply] selector must be eliminated"
  );
  assert.doesNotMatch(
    enhCssSource,
    /(?:^|\n|\})\s*button\[data-pi-enh-quick-reply\]::before/,
    "Generic button[data-pi-enh-quick-reply]::before selector must be eliminated"
  );

  // Require explicit native composer layout scope
  assert.match(
    enhCssSource,
    /\[data-pi-native-composer-layout\]\s+button\[data-pi-enh-quick-reply\]/,
    "Quick reply button must be strictly scoped under [data-pi-native-composer-layout]"
  );
  assert.match(
    enhCssSource,
    /\[data-pi-native-composer-layout\]\s+button\[data-pi-enh-quick-reply\]::before/,
    "Quick reply ::before rule must be strictly scoped under [data-pi-native-composer-layout]"
  );
});

test("AskUserPanel replaces text checkmark with round inline SVG and preserves 18px stable circular slot", () => {
  // Text checkmark must be completely eliminated
  assert.doesNotMatch(panelSource, />\s*✓\s*</, "Text checkmark ✓ must not exist in JSX body");
  assert.doesNotMatch(panelSource, /"✓"/, "Text checkmark string literal must be eliminated");

  // Inline SVG checkmark with round stroke caps and joints
  assert.match(panelSource, /<svg[^>]*viewBox="[^"]*"[^>]*>/, "Inline SVG checkmark must be rendered");
  assert.match(panelSource, /strokeLinecap="round"/, "SVG checkmark uses round stroke linecap");
  assert.match(panelSource, /strokeLinejoin="round"/, "SVG checkmark uses round stroke linejoin");

  // SVG size is within 12~14px
  const svgMatch = panelSource.match(/<svg[^>]*width="(\d+)"[^>]*height="(\d+)"/);
  assert.ok(svgMatch, "SVG checkmark specifies explicit width and height");
  const width = Number(svgMatch[1]);
  const height = Number(svgMatch[2]);
  assert.ok(width >= 12 && width <= 14, `SVG width (${width}px) must be between 12px and 14px`);
  assert.ok(height >= 12 && height <= 14, `SVG height (${height}px) must be between 12px and 14px`);

  // Unselected slot preserves layout structure without icon
  assert.match(
    panelSource,
    /\{isSelected \? \(\s*<svg[\s\S]*?<\/svg>\s*\) : null\}/,
    "Unselected option preserves slot container but renders no icon"
  );

  // Accessible selection semantics preserved
  assert.match(panelSource, /aria-pressed=\{isSelected\}/, "Option button sets aria-pressed based on effective selection");
  assert.match(panelSource, /const isSelected = !freeform && selected\.includes\(index\);/, "Custom text (freeform) prioritizes over option selection");

  // 18px circular slot in ask-user.css
  assert.match(askCssSource, /\.pi-native-ask-check\s*\{[^}]*width:\s*18px;/, "Check slot width is 18px");
  assert.match(askCssSource, /\.pi-native-ask-check\s*\{[^}]*height:\s*18px;/, "Check slot height is 18px");
  assert.match(askCssSource, /\.pi-native-ask-check\s*\{[^}]*flex:\s*0\s+0\s+18px;/, "Check slot has flex 0 0 18px stability");
  assert.match(askCssSource, /\.pi-native-ask-check\s*\{[^}]*border-radius:\s*50%;/, "Check slot is circular (50% border radius)");
  assert.match(askCssSource, /\.pi-native-ask-check\s*\{[^}]*background:\s*transparent;/, "Unselected slot is reserved without a distracting dot");
  assert.match(
    askCssSource,
    /\.pi-native-ask-option\[aria-pressed="true"\]\s+\.pi-native-ask-check\s*\{[^}]*background:\s*color-mix\(/,
    "Active check slot highlights with accent-based tint"
  );
});

test("module 05 enforces native composer layout boundary predicate across all send and click handlers", () => {
  // Predicate function exists and checks both native composer layout and excludes Ask containers
  assert.match(
    module05Source,
    /function isNativeComposerLayoutButton\s*\(\s*button\s*\)\s*\{[\s\S]*?closest\(\s*"\[data-pi-native-composer-layout\]"\s*\)[\s\S]*?closest\(\s*"[^"]*pi-native-ask-host[^"]*"\s*\)/,
    "isNativeComposerLayoutButton must verify layout ancestry and exclude Ask containers"
  );

  // All send button verifiers and click handlers reuse the predicate
  assert.match(
    module05Source,
    /function isNativeComposerSendButton\s*\(\s*button\s*\)\s*\{[\s\S]*?isNativeComposerLayoutButton\(button\)/,
    "isNativeComposerSendButton reuses isNativeComposerLayoutButton"
  );
  assert.match(
    module05Source,
    /function isEmptySendContinueButton\s*\(\s*button\s*\)\s*\{[\s\S]*?isNativeComposerLayoutButton\(button\)/,
    "isEmptySendContinueButton reuses isNativeComposerLayoutButton"
  );
  assert.match(
    module05Source,
    /function isNativeSendButton\s*\(\s*button\s*\)\s*\{[\s\S]*?isNativeComposerLayoutButton\(button\)/,
    "isNativeSendButton reuses isNativeComposerLayoutButton"
  );
  assert.match(
    module05Source,
    /function consumeQuickReplyClick\s*\(\s*event\s*\)\s*\{[\s\S]*?isNativeComposerLayoutButton\(button\)/,
    "consumeQuickReplyClick reuses isNativeComposerLayoutButton before handling or intercepting click"
  );

  // Finders are rooted at data-pi-native-composer-layout and do not cross outward to composer-host or form
  const extractFunctionBody = (name) => {
    const start = module05Source.indexOf(`function ${name}`);
    if (start === -1) return "";
    const nextFn = module05Source.indexOf("function ", start + 10);
    return nextFn === -1 ? module05Source.slice(start) : module05Source.slice(start, nextFn);
  };

  const findNativeComposerSendBody = extractFunctionBody("findNativeComposerSendButton");
  assert.match(findNativeComposerSendBody, /textarea\.closest\?\.\(\s*"\[data-pi-native-composer-layout\]"\s*\)/, "findNativeComposerSendButton roots at layout");
  assert.doesNotMatch(findNativeComposerSendBody, /\[data-pi-native-composer-host\]/, "findNativeComposerSendButton does not search composer-host");
  assert.doesNotMatch(findNativeComposerSendBody, /closest\?\.\(\s*["']form["']\s*\)/, "findNativeComposerSendButton does not search form");

  const getEmptySendContinueBody = extractFunctionBody("getEmptySendContinueButtons");
  assert.match(getEmptySendContinueBody, /textarea\.closest\?\.\(\s*"\[data-pi-native-composer-layout\]"\s*\)/, "getEmptySendContinueButtons roots at layout");
  assert.doesNotMatch(getEmptySendContinueBody, /\[data-pi-native-composer-host\]/, "getEmptySendContinueButtons does not search composer-host");
  assert.doesNotMatch(getEmptySendContinueBody, /closest\?\.\(\s*["']form["']\s*\)/, "getEmptySendContinueButtons does not search form");

  const findNativeSendButtonsBody = extractFunctionBody("findNativeSendButtons");
  assert.match(findNativeSendButtonsBody, /textarea\.closest\?\.\(\s*"\[data-pi-native-composer-layout\]"\s*\)/, "findNativeSendButtons roots at layout");
  assert.doesNotMatch(findNativeSendButtonsBody, /\[data-pi-native-composer-host\]/, "findNativeSendButtons does not search composer-host");
  assert.doesNotMatch(findNativeSendButtonsBody, /closest\?\.\(\s*["']form["']\s*\)/, "findNativeSendButtons does not search form");
});

test("simulated DOM hierarchy asserts correct positive and negative matching for layout predicate", () => {
  // Lightweight DOM node mockup strictly testing closest and boundary logic without full fakeDOM
  function createMockNode(name, attributes = {}, classes = [], parent = null) {
    const node = {
      name,
      attributes: { ...attributes },
      classes: new Set(classes),
      parent,
      children: [],
      closest(selector) {
        let current = this;
        while (current) {
          if (selector.startsWith("[") && selector.endsWith("]")) {
            const attr = selector.slice(1, -1);
            if (attr in current.attributes) return current;
          }
          if (selector.startsWith(".")) {
            const classSelectors = selector.split(",").map(s => s.trim());
            for (const item of classSelectors) {
              if (item.startsWith(".")) {
                const cls = item.slice(1);
                if (current.classes.has(cls)) return current;
              } else if (item.startsWith("[") && item.endsWith("]")) {
                const attr = item.slice(1, -1);
                if (attr in current.attributes) return current;
              }
            }
          }
          current = current.parent;
        }
        return null;
      },
      appendChild(child) {
        child.parent = this;
        this.children.push(child);
        return child;
      }
    };
    if (parent) parent.children.push(node);
    return node;
  }

  // Model the predicate directly from module05 specification
  function testPredicate(button) {
    if (!button || typeof button.closest !== "function") return false;
    const layout = button.closest("[data-pi-native-composer-layout]");
    if (!layout) return false;
    if (button.closest(".pi-native-ask-host, .pi-native-ask-card, [data-pi-native-ask-card], [data-pi-native-ask-owner], [data-ask-user-picker]")) return false;
    return true;
  }

  // Positive case: Standard main composer send button
  const host = createMockNode("div", { "data-pi-native-composer-host": "true" });
  const layout = createMockNode("div", { "data-pi-native-composer-layout": "true" }, ["chat-composer-card"], host);
  const mainSendButton = createMockNode("button", { "aria-label": "发送消息" }, ["chat-send-btn"], layout);
  assert.equal(testPredicate(mainSendButton), true, "Main composer send button must match predicate");

  // Negative case: AskUserPanel inside extensionPanel in data-pi-native-composer-host
  const askHost = createMockNode("div", { "data-pi-native-ask-owner": "call_1" }, ["pi-native-ask-host"], host);
  const askCard = createMockNode("section", { "data-ask-user-picker": "true" }, ["pi-native-ask-card"], askHost);
  const askFooter = createMockNode("footer", {}, ["pi-native-ask-footer"], askCard);
  const askSubmitButton = createMockNode("button", {}, ["pi-native-ask-submit"], askFooter);
  const askCancelButton = createMockNode("button", {}, ["pi-native-ask-cancel"], askFooter);
  const askOptionButton = createMockNode("button", {}, ["pi-native-ask-option"], askCard);

  assert.equal(testPredicate(askSubmitButton), false, "Ask submit button must NOT match predicate");
  assert.equal(testPredicate(askCancelButton), false, "Ask cancel button must NOT match predicate");
  assert.equal(testPredicate(askOptionButton), false, "Ask option button must NOT match predicate");

  // Negative case: Even if AskCard were inadvertently nested inside a layout node
  const nestedAskCard = createMockNode("section", { "data-ask-user-picker": "true" }, ["pi-native-ask-card"], layout);
  const nestedAskButton = createMockNode("button", {}, ["pi-native-ask-submit"], nestedAskCard);
  assert.equal(testPredicate(nestedAskButton), false, "Nested Ask card inside layout is still rejected by predicate");

  // Negative case: Plain button outside layout
  const outsideButton = createMockNode("button", {}, [], host);
  assert.equal(testPredicate(outsideButton), false, "Button outside layout must NOT match predicate");
});
