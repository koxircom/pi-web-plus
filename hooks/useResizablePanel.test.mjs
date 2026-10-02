import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./useResizablePanel.ts", import.meta.url), "utf8");

test("vertical panels use vertical pointer movement, cursor, keys, and separator orientation", () => {
  assert.match(source, /axis === "vertical" \? event\.clientY : event\.clientX/);
  assert.match(source, /axis === "vertical" \? "row-resize" : "col-resize"/);
  assert.match(source, /axis === "vertical" \? "ArrowDown" : "ArrowRight"/);
  assert.match(source, /axis === "vertical" \? "ArrowUp" : "ArrowLeft"/);
  assert.match(source, /axis === "vertical" \? "horizontal" as const : "vertical" as const/);
});

test("resized values continue to persist and reset through the shared panel contract", () => {
  assert.match(source, /writeStoredWidth\(storageKey, nextWidth\)/);
  assert.match(source, /onDoubleClick: resetWidth/);
  assert.match(source, /event\.key === "Enter"/);
  assert.match(source, /window\.addEventListener\("resize", onResize\)/);
});

test("restores width before paint with localized transition suppression and cleanup", () => {
  // 必须采用 useIsomorphicLayoutEffect 在 paint 前恢复
  assert.match(source, /const useIsomorphicLayoutEffect = typeof window !== "undefined" \? useLayoutEffect : useEffect;/);
  assert.match(source, /useIsomorphicLayoutEffect\(/);

  // 必须使用 native ref 管理局部 transition 生命周期，不使用 timer 或 observer
  assert.match(source, /tempTransitionSuppressedRef/);
  assert.match(source, /node\.style\.transition = "none"/);
  assert.doesNotMatch(source, /setTimeout\(/);
  assert.doesNotMatch(source, /setInterval\(/);
  assert.doesNotMatch(source, /requestAnimationFrame\(/);
  assert.doesNotMatch(source, /MutationObserver/);
  assert.doesNotMatch(source, /ResizeObserver/);

  // cleanup 仅恢复本 hook 拥有的临时 transition
  assert.match(source, /cleanup 仅本 hook 拥有临时 transition/);
  assert.match(source, /tempTransitionSuppressedRef\.current = false/);

  // 初始 useState 不碰 window，杜绝 SSR hydration mismatch
  assert.match(source, /const \[width, setWidth\] = useState\(defaultWidth\);/);
});

test("storage operations gracefully catch errors without throwing", () => {
  assert.match(source, /function readStoredWidth/);
  assert.match(source, /function writeStoredWidth/);
  assert.match(source, /try \{[\s\S]*?window\.localStorage\.getItem[\s\S]*?\} catch/);
  assert.match(source, /try \{[\s\S]*?window\.localStorage\.setItem[\s\S]*?\} catch/);
});

