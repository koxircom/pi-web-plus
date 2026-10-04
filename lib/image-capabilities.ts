type ImageWindow = Window & {
  __PI_IMAGE_PRELOAD_REQUESTED__?: boolean;
  __PI_ENH_LOAD_OPTIONAL__?: (name: string) => Promise<unknown>;
};

let previewRequest: Promise<typeof import("@/components/ImagePreviewDialog")> | undefined;

export function loadImagePreview() {
  return previewRequest ??= import("@/components/ImagePreviewDialog").catch((error) => {
    previewRequest = undefined;
    throw error;
  });
}

export function preloadImageCapabilities() {
  if (typeof window === "undefined") return;
  void loadImagePreview().catch(() => {});
  const win = window as ImageWindow;
  win.__PI_IMAGE_PRELOAD_REQUESTED__ = true;
  void win.__PI_ENH_LOAD_OPTIONAL__?.("image-editor").catch(() => {});
}

// Keep image work off the initial page load; Safari falls back to one timer.
export function scheduleImagePreload() {
  let idle: number | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  const run = () => {
    if (!disposed) preloadImageCapabilities();
  };
  const schedule = () => {
    if (disposed || document.visibilityState === "hidden") return;
    document.removeEventListener("visibilitychange", schedule);
    if (typeof window.requestIdleCallback === "function") {
      idle = window.requestIdleCallback(run, { timeout: 5000 });
    } else {
      timer = setTimeout(run, 1000);
    }
  };
  const afterLoad = () => {
    document.addEventListener("visibilitychange", schedule);
    schedule();
  };
  if (document.readyState === "complete") afterLoad();
  else window.addEventListener("load", afterLoad, { once: true });
  return () => {
    disposed = true;
    window.removeEventListener("load", afterLoad);
    document.removeEventListener("visibilitychange", schedule);
    if (idle !== undefined) window.cancelIdleCallback(idle);
    if (timer !== undefined) clearTimeout(timer);
  };
}
