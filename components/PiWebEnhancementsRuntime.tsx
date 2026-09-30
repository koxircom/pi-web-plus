"use client";

import { useEffect } from "react";
import {
  ensureEnhancementsRuntime as bootstrapEnhancementsRuntime,
  type EnhancementsRuntimeWindow,
} from "@/lib/enhancement-state-bootstrap";

const STANDALONE_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? "0.0.0";
const OFFICIAL_PI_VERSION =
  process.env.NEXT_PUBLIC_PI_VERSION && process.env.NEXT_PUBLIC_PI_VERSION !== "unknown"
    ? process.env.NEXT_PUBLIC_PI_VERSION
    : "0.87.1";

type EnhancementsWindow = Window & EnhancementsRuntimeWindow;

export function ensureEnhancementsRuntime(
  targetWindow?: EnhancementsRuntimeWindow,
): Promise<boolean> {
  const win =
    targetWindow
    ?? (typeof window !== "undefined" ? (window as EnhancementsWindow) : undefined);
  if (!win) {
    return Promise.resolve(false);
  }
  win.__PI_ENH_NATIVE_STATE_API__ = true;
  win.__PI_OFFICIAL_AGENT_VERSION__ = OFFICIAL_PI_VERSION;
  return bootstrapEnhancementsRuntime(win, {
    standaloneVersion: STANDALONE_VERSION,
    officialPiVersion: OFFICIAL_PI_VERSION,
  });
}

if (typeof window !== "undefined") {
  void ensureEnhancementsRuntime();
}

export function PiWebEnhancementsRuntime() {
  useEffect(() => {
    void ensureEnhancementsRuntime();
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
