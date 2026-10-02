export const SETTINGS_SIDEBAR_WIDTH_KEY = "pi-enh-settings-sidebar-width";
export const SETTINGS_SIDEBAR_COLLAPSED_KEY = "pi-enh-settings-sidebar-collapsed";
export const SETTINGS_DIALOG_SIZE_KEY = "pi-enh-settings-dialog-size";

export const SETTINGS_SIDEBAR_WIDTH_DEFAULT = 200;
export const SETTINGS_SIDEBAR_WIDTH_MIN = 160;
export const SETTINGS_SIDEBAR_WIDTH_MAX = 500;
export const SETTINGS_SIDEBAR_WIDTH_COLLAPSED = 58;

export const SETTINGS_DIALOG_WIDTH_DEFAULT = 1220;
export const SETTINGS_DIALOG_HEIGHT_DEFAULT = 860;
export const SETTINGS_DIALOG_WIDTH_MIN = 760;
export const SETTINGS_DIALOG_HEIGHT_MIN = 480;

export interface SettingsDialogSize {
  width: number;
  height: number;
}

export interface SettingsLayoutState {
  sidebarWidth: number;
  isCollapsed: boolean;
  dialogSize: SettingsDialogSize;
}

export function clampSidebarWidth(width: number): number {
  if (!Number.isFinite(width)) return SETTINGS_SIDEBAR_WIDTH_DEFAULT;
  return Math.max(SETTINGS_SIDEBAR_WIDTH_MIN, Math.min(SETTINGS_SIDEBAR_WIDTH_MAX, Math.round(width)));
}

export function clampDialogSize(
  size: { width?: number; height?: number },
  viewport?: { width?: number; height?: number },
): SettingsDialogSize {
  const vpWidth = viewport?.width ?? (typeof window !== "undefined" ? window.innerWidth : 1440);
  const vpHeight = viewport?.height ?? (typeof window !== "undefined" ? window.innerHeight : 900);

  const maxW = Math.max(SETTINGS_DIALOG_WIDTH_MIN, vpWidth - 32);
  const maxH = Math.max(SETTINGS_DIALOG_HEIGHT_MIN, vpHeight - 32);

  const rawW = typeof size.width === "number" && Number.isFinite(size.width) ? size.width : SETTINGS_DIALOG_WIDTH_DEFAULT;
  const rawH = typeof size.height === "number" && Number.isFinite(size.height) ? size.height : SETTINGS_DIALOG_HEIGHT_DEFAULT;

  return {
    width: Math.max(SETTINGS_DIALOG_WIDTH_MIN, Math.min(maxW, Math.round(rawW))),
    height: Math.max(SETTINGS_DIALOG_HEIGHT_MIN, Math.min(maxH, Math.round(rawH))),
  };
}

export function getSafeStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readInitialSettingsLayout(storage?: Storage | null): SettingsLayoutState {
  const store = storage !== undefined ? storage : getSafeStorage();
  let sidebarWidth = SETTINGS_SIDEBAR_WIDTH_DEFAULT;
  let isCollapsed = false;
  let dialogSize: SettingsDialogSize = {
    width: SETTINGS_DIALOG_WIDTH_DEFAULT,
    height: SETTINGS_DIALOG_HEIGHT_DEFAULT,
  };

  if (!store) {
    return { sidebarWidth, isCollapsed, dialogSize: clampDialogSize(dialogSize) };
  }

  // 1. Sidebar width
  try {
    const rawWidth = store.getItem(SETTINGS_SIDEBAR_WIDTH_KEY);
    if (rawWidth !== null) {
      const num = Number(rawWidth);
      if (!Number.isNaN(num)) {
        sidebarWidth = clampSidebarWidth(num);
      }
    }
  } catch {
    sidebarWidth = SETTINGS_SIDEBAR_WIDTH_DEFAULT;
  }

  // 2. Sidebar collapsed
  try {
    const rawCollapsed = store.getItem(SETTINGS_SIDEBAR_COLLAPSED_KEY);
    if (rawCollapsed === "true") {
      isCollapsed = true;
    }
  } catch {
    isCollapsed = false;
  }

  // 3. Dialog size
  try {
    const rawSize = store.getItem(SETTINGS_DIALOG_SIZE_KEY);
    if (rawSize) {
      const parsed = JSON.parse(rawSize);
      if (parsed && typeof parsed === "object") {
        dialogSize = clampDialogSize(parsed);
      } else {
        dialogSize = clampDialogSize(dialogSize);
      }
    } else {
      dialogSize = clampDialogSize(dialogSize);
    }
  } catch {
    dialogSize = clampDialogSize(dialogSize);
  }

  return {
    sidebarWidth,
    isCollapsed,
    dialogSize,
  };
}

export function saveSidebarWidth(width: number, storage?: Storage | null): void {
  const store = storage !== undefined ? storage : getSafeStorage();
  if (!store) return;
  try {
    store.setItem(SETTINGS_SIDEBAR_WIDTH_KEY, String(clampSidebarWidth(width)));
  } catch {}
}

export function saveSidebarCollapsed(collapsed: boolean, storage?: Storage | null): void {
  const store = storage !== undefined ? storage : getSafeStorage();
  if (!store) return;
  try {
    store.setItem(SETTINGS_SIDEBAR_COLLAPSED_KEY, collapsed ? "true" : "false");
  } catch {}
}

export function saveDialogSize(size: SettingsDialogSize, storage?: Storage | null): void {
  const store = storage !== undefined ? storage : getSafeStorage();
  if (!store) return;
  try {
    store.setItem(SETTINGS_DIALOG_SIZE_KEY, JSON.stringify(clampDialogSize(size)));
  } catch {}
}
