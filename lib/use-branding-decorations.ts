"use client";

/**
 * @file lib/use-branding-decorations.ts
 * 客户端 Hook 与事件订阅：获取品牌装饰偏好状态。
 * 遵循 React Client Component 规范。
 */

import { useState, useEffect } from "react";
import {
  BRANDING_PREFERENCE_KEY,
  BRANDING_PREFERENCE_CHANGE_EVENT,
  isBrandingDecorationsActive,
} from "./branding.ts";

/**
 * 订阅品牌装饰偏好变更
 */
export function subscribeBrandingPreferenceChange(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};

  const handleCustomEvent = () => onChange();
  const handleStorage = (event: StorageEvent) => {
    if (
      event.key === BRANDING_PREFERENCE_KEY ||
      event.key === "pi-enh-settings-v1" ||
      event.key === `pi-enh-plugin-${BRANDING_PREFERENCE_KEY}`
    ) {
      onChange();
    }
  };

  window.addEventListener(BRANDING_PREFERENCE_CHANGE_EVENT, handleCustomEvent);
  window.addEventListener("storage", handleStorage);

  return () => {
    window.removeEventListener(BRANDING_PREFERENCE_CHANGE_EVENT, handleCustomEvent);
    window.removeEventListener("storage", handleStorage);
  };
}

/**
 * React Hook：获取当前品牌装饰开关状态（SSR 默认 true）
 */
export function useBrandingDecorations(): boolean {
  const [active, setActive] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    return isBrandingDecorationsActive();
  });

  useEffect(() => {
    setActive(isBrandingDecorationsActive());
    return subscribeBrandingPreferenceChange(() => {
      setActive(isBrandingDecorationsActive());
    });
  }, []);

  return active;
}

export { isBrandingDecorationsActive } from "./branding.ts";
