"use client";

import { useEffect } from "react";

const STANDALONE_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? "0.0.0";

type EnhancementsWindow = Window & {
  __PI_WEB_LOADER_INJECTED__?: boolean;
  __PI_WEB_STANDALONE_EDITION__?: string;
  __PI_WEB_STANDALONE_VERSION__?: string;
  __PI_WEB_ENHANCEMENTS_LOADED__?: boolean;
  __PI_ENH_ASSET_BUILD__?: string;
  __PI_ENH_RELOAD__?: (forceBust?: boolean) => void;
};

function ensureEnhancementsRuntime(): void {
  if (typeof window === "undefined") return;
  const win = window as EnhancementsWindow;
  win.__PI_WEB_LOADER_INJECTED__ = true;
  win.__PI_WEB_STANDALONE_EDITION__ = `koxir-standalone-${STANDALONE_VERSION}`;
  win.__PI_WEB_STANDALONE_VERSION__ = STANDALONE_VERSION;

  let retryCount = 0;
  const maxRetries = 3;

  const loadScript = (forceBust = false) => {
    if (!forceBust && win.__PI_WEB_ENHANCEMENTS_LOADED__) return;
    const existing = document.getElementById("pi-web-enhancements-script");
    if (existing) existing.remove();
    const script = document.createElement("script");
    script.id = "pi-web-enhancements-script";
    const assetBuild = win.__PI_ENH_ASSET_BUILD__ || `koxir-${STANDALONE_VERSION}`;
    script.src = `/pi-web-enhancements.js?v=${encodeURIComponent(assetBuild)}${forceBust ? `&t=${Date.now()}` : ""}`;
    script.async = true;
    script.onerror = () => {
      if (retryCount < maxRetries) {
        retryCount += 1;
        setTimeout(() => loadScript(true), 1000 * retryCount);
      }
    };
    (document.head || document.documentElement)?.appendChild(script);
  };

  win.__PI_ENH_RELOAD__ = (forceBust = true) => loadScript(forceBust);

  if (!win.__PI_WEB_ENHANCEMENTS_LOADED__) {
    queueMicrotask(() => {
      if (!win.__PI_WEB_ENHANCEMENTS_LOADED__) loadScript(false);
    });
  }
}

if (typeof window !== "undefined") {
  ensureEnhancementsRuntime();
}

export function PiWebEnhancementsRuntime() {
  useEffect(() => {
    ensureEnhancementsRuntime();
    const onVisibilityChange = () => {
      const win = window as EnhancementsWindow;
      if (document.visibilityState === "visible" && !win.__PI_WEB_ENHANCEMENTS_LOADED__) {
        win.__PI_ENH_RELOAD__?.();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, []);

  return null;
}
