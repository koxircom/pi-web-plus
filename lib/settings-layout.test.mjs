import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  clampSidebarWidth,
  clampDialogSize,
  readInitialSettingsLayout,
  saveSidebarWidth,
  saveSidebarCollapsed,
  saveDialogSize,
  SETTINGS_SIDEBAR_WIDTH_DEFAULT,
  SETTINGS_SIDEBAR_WIDTH_MIN,
  SETTINGS_SIDEBAR_WIDTH_MAX,
  SETTINGS_DIALOG_WIDTH_DEFAULT,
  SETTINGS_DIALOG_HEIGHT_DEFAULT,
  SETTINGS_SIDEBAR_WIDTH_KEY,
  SETTINGS_SIDEBAR_COLLAPSED_KEY,
  SETTINGS_DIALOG_SIZE_KEY,
} = await jiti.import("./settings-layout.ts");

function createMockStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return map.get(key) ?? null;
    },
    setItem(key, value) {
      map.set(key, String(value));
    },
    removeItem(key) {
      map.delete(key);
    },
  };
}

test("clampSidebarWidth handles boundaries and defaults", () => {
  assert.equal(clampSidebarWidth(200), 200);
  assert.equal(clampSidebarWidth(100), SETTINGS_SIDEBAR_WIDTH_MIN);
  assert.equal(clampSidebarWidth(600), SETTINGS_SIDEBAR_WIDTH_MAX);
  assert.equal(clampSidebarWidth(NaN), SETTINGS_SIDEBAR_WIDTH_DEFAULT);
});

test("clampDialogSize respects viewport bounds", () => {
  const size = clampDialogSize({ width: 1220, height: 860 }, { width: 1440, height: 900 });
  assert.equal(size.width, 1220);
  assert.equal(size.height, 860);

  // Viewport smaller than requested
  const small = clampDialogSize({ width: 1500, height: 1000 }, { width: 1000, height: 600 });
  assert.equal(small.width, 1000 - 32);
  assert.equal(small.height, 600 - 32);
});

test("readInitialSettingsLayout returns defaults on empty storage", () => {
  const storage = createMockStorage();
  const state = readInitialSettingsLayout(storage);
  assert.equal(state.sidebarWidth, SETTINGS_SIDEBAR_WIDTH_DEFAULT);
  assert.equal(state.isCollapsed, false);
  assert.equal(state.dialogSize.width, SETTINGS_DIALOG_WIDTH_DEFAULT);
  assert.equal(state.dialogSize.height, SETTINGS_DIALOG_HEIGHT_DEFAULT);
});

test("readInitialSettingsLayout and save methods work synchronously", () => {
  const storage = createMockStorage();
  saveSidebarWidth(240, storage);
  saveSidebarCollapsed(true, storage);
  saveDialogSize({ width: 1050, height: 750 }, storage);

  assert.equal(storage.getItem(SETTINGS_SIDEBAR_WIDTH_KEY), "240");
  assert.equal(storage.getItem(SETTINGS_SIDEBAR_COLLAPSED_KEY), "true");
  assert.equal(storage.getItem(SETTINGS_DIALOG_SIZE_KEY), JSON.stringify({ width: 1050, height: 750 }));

  const state = readInitialSettingsLayout(storage);
  assert.equal(state.sidebarWidth, 240);
  assert.equal(state.isCollapsed, true);
  assert.equal(state.dialogSize.width, 1050);
  assert.equal(state.dialogSize.height, 750);
});

test("readInitialSettingsLayout survives throwing localStorage getter", () => {
  const throwingStorage = {
    get getItem() {
      throw new Error("SecurityError: Access is denied for this document");
    },
    get setItem() {
      throw new Error("SecurityError: Access is denied for this document");
    },
  };
  const state = readInitialSettingsLayout(throwingStorage);
  assert.equal(state.sidebarWidth, SETTINGS_SIDEBAR_WIDTH_DEFAULT);
  assert.equal(state.dialogSize.width, SETTINGS_DIALOG_WIDTH_DEFAULT);

  // Saving also does not throw
  assert.doesNotThrow(() => saveSidebarWidth(250, throwingStorage));
  assert.doesNotThrow(() => saveSidebarCollapsed(true, throwingStorage));
  assert.doesNotThrow(() => saveDialogSize({ width: 1000, height: 700 }, throwingStorage));
});
