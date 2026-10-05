/** Click-owned tail convergence. No idle observer, polling or layout measurement. */
export function convergeChatTail(container: HTMLElement): () => void {
  const controller = new AbortController();
  const startedAt = performance.now();
  let lastShiftAt = startedAt;
  let lastHeight = -1;
  let frame: number | null = null;
  let stopped = false;
  const finish = () => {
    stopped = true;
    if (frame !== null) cancelAnimationFrame(frame);
    controller.abort();
  };
  for (const type of ["wheel", "touchstart", "pointerdown", "keydown"]) {
    document.addEventListener(type, finish, { capture: true, passive: true, signal: controller.signal });
  }
  const align = () => {
    if (stopped) return;
    if (!container.isConnected) { finish(); return; }
    const now = performance.now();
    const height = container.scrollHeight;
    const target = Math.max(0, height - container.clientHeight);
    if (height !== lastHeight || Math.abs(container.scrollTop - target) > 1) {
      lastShiftAt = now;
      lastHeight = height;
      container.scrollTo({ top: target, behavior: "instant" });
    }
    if (now - startedAt >= 2000 || now - lastShiftAt >= 250) { finish(); return; }
    frame = requestAnimationFrame(align);
  };
  align();
  return finish;
}
