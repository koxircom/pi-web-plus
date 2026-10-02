"use client";

import { useSyncExternalStore, useCallback } from "react";
import { isEnhancementPluginFastActive } from "@/lib/enhancement-settings.generated";

export const COMPOSER_CUSTOM_HEIGHT_STORAGE_KEY = "pi-web:composer-custom-height";
export const COMPOSER_PREFERENCES_CHANGE_EVENT = "pi-native-composer-preferences-change";

export interface ComposerLayoutPreferences {
  codexLayoutEnabled: boolean;
  modelReasoningPillEnabled: boolean;
  modesEnabled: boolean;
  customHeight: number | null;
}

export const DEFAULT_COMPOSER_PREFERENCES: Readonly<ComposerLayoutPreferences> = Object.freeze({
  codexLayoutEnabled: true,
  modelReasoningPillEnabled: true,
  modesEnabled: true,
  customHeight: null,
});

function parseValidHeight(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const num = parseFloat(raw);
  if (Number.isFinite(num) && num >= 44) {
    return Math.round(num);
  }
  return null;
}

function getSafeLocalStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch (_) {
    return null;
  }
}

function readStorageItem(key: string): string | null {
  try {
    const storage = getSafeLocalStorage();
    return storage ? storage.getItem(key) : null;
  } catch (_) {
    return null;
  }
}

// 内存回退：当 localStorage 整体抛错或不可用时，仍可响应本地 UI 更新
let inMemoryCustomHeight: number | null = null;
let hasInMemoryCustomHeight = false;

let cachedSnapshot: ComposerLayoutPreferences = { ...DEFAULT_COMPOSER_PREFERENCES };
let lastStorageSignature = "";

function getPreferencesSnapshot(): ComposerLayoutPreferences {
  if (typeof window === "undefined") {
    return DEFAULT_COMPOSER_PREFERENCES;
  }

  // 1. 读取布局、胶囊与模式偏好
  const codexLayoutEnabled = isEnhancementPluginFastActive("codex-composer-layout");
  const modelReasoningPillEnabled = isEnhancementPluginFastActive("composer-model-reasoning-pill");
  const modesEnabled = isEnhancementPluginFastActive("composer-modes");

  // A successful storage read (including null) is authoritative. Memory is only
  // a fallback after a failed write; do not resurrect a removed saved height.
  const customHeight = hasInMemoryCustomHeight
    ? inMemoryCustomHeight
    : parseValidHeight(readStorageItem(COMPOSER_CUSTOM_HEIGHT_STORAGE_KEY));

  // 3. 构建快照签名，保持 React useSyncExternalStore 引用稳定性
  const signature = `${codexLayoutEnabled ? 1 : 0}:${modelReasoningPillEnabled ? 1 : 0}:${modesEnabled ? 1 : 0}:${customHeight ?? "none"}`;
  if (signature !== lastStorageSignature) {
    lastStorageSignature = signature;
    cachedSnapshot = {
      codexLayoutEnabled,
      modelReasoningPillEnabled,
      modesEnabled,
      customHeight,
    };
  }

  return cachedSnapshot;
}

function subscribeToPreferences(callback: () => void): () => void {
  if (typeof window === "undefined") return () => {};

  const onStorageChange = (e: StorageEvent) => {
    if (
      !e.key ||
      e.key === "pi-enh-settings-v1" ||
      e.key.startsWith("pi-enh-plugin-") ||
      e.key === COMPOSER_CUSTOM_HEIGHT_STORAGE_KEY
    ) {
      if (!e.key || e.key === COMPOSER_CUSTOM_HEIGHT_STORAGE_KEY) hasInMemoryCustomHeight = false;
      callback();
    }
  };

  const onCustomChange = () => {
    callback();
  };

  try {
    window.addEventListener("storage", onStorageChange);
    window.addEventListener(COMPOSER_PREFERENCES_CHANGE_EVENT, onCustomChange);
  } catch (_) {}

  return () => {
    try {
      window.removeEventListener("storage", onStorageChange);
      window.removeEventListener(COMPOSER_PREFERENCES_CHANGE_EVENT, onCustomChange);
    } catch (_) {}
  };
}

export function saveComposerCustomHeight(height: number | null): void {
  const sanitizedHeight =
    height !== null && Number.isFinite(height) && height >= 44
      ? Math.round(height)
      : null;

  // 更新内存状态，保证 localStorage 整体 throws 时本地 UI 依然可响应
  inMemoryCustomHeight = sanitizedHeight;
  hasInMemoryCustomHeight = true;

  try {
    const storage = getSafeLocalStorage();
    if (storage) {
      if (sanitizedHeight !== null) {
        storage.setItem(COMPOSER_CUSTOM_HEIGHT_STORAGE_KEY, String(sanitizedHeight));
      } else {
        storage.removeItem(COMPOSER_CUSTOM_HEIGHT_STORAGE_KEY);
      }
      hasInMemoryCustomHeight = false;
    }
  } catch (_) {}

  try {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent(COMPOSER_PREFERENCES_CHANGE_EVENT));
    }
  } catch (_) {}
}

export function useComposerLayoutPreferences(): ComposerLayoutPreferences & {
  setCustomHeight: (height: number | null) => void;
} {
  const preferences = useSyncExternalStore(
    subscribeToPreferences,
    getPreferencesSnapshot,
    () => DEFAULT_COMPOSER_PREFERENCES
  );

  const setCustomHeight = useCallback((height: number | null) => {
    saveComposerCustomHeight(height);
  }, []);

  return {
    ...preferences,
    setCustomHeight,
  };
}
