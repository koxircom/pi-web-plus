import {
  createFastPluginReader,
  ENHANCEMENT_METADATA,
  type StorageGetter,
} from "./enhancement-settings.generated";

export type SettingsExtensionId =
  | "enhancements"
  | "notifications"
  | "archived"
  | "usage"
  | "tags";

export interface SettingsExtensionDefinition {
  id: SettingsExtensionId;
  label: string;
  pluginId?: string;
  legacyTabAttr: string;
  requiresProject: boolean;
}

export const LEGACY_SETTINGS_EXTENSIONS: readonly SettingsExtensionDefinition[] = [
  {
    id: "enhancements",
    label: "增强插件",
    legacyTabAttr: "plugins",
    requiresProject: false,
  },
  {
    id: "archived",
    label: "已归档",
    pluginId: "session-pin-archive",
    legacyTabAttr: "archived",
    requiresProject: false,
  },
  {
    id: "notifications",
    label: "通知管理",
    pluginId: "notification-center",
    legacyTabAttr: "notifications",
    requiresProject: false,
  },
  {
    id: "usage",
    label: "Usage",
    pluginId: "usage-cost-dashboard",
    legacyTabAttr: "usage",
    requiresProject: false,
  },
  {
    id: "tags",
    label: "会话标签",
    pluginId: "session-tags",
    legacyTabAttr: "tags",
    requiresProject: false,
  },
] as const;

const readBrowserPluginPreference = createFastPluginReader((key) => {
  try {
    return typeof window === "undefined" ? null : window.localStorage.getItem(key);
  } catch {
    return null;
  }
}, ENHANCEMENT_METADATA);

export function isSettingsPluginEnabled(pluginId: string, storageGetter?: StorageGetter): boolean {
  return storageGetter
    ? createFastPluginReader(storageGetter, ENHANCEMENT_METADATA)(pluginId)
    : readBrowserPluginPreference(pluginId);
}

export function isExtensionEnabled(
  def: SettingsExtensionDefinition,
  storageGetter?: StorageGetter,
): boolean {
  return !def.pluginId || isSettingsPluginEnabled(def.pluginId, storageGetter);
}

export type SettingsExtensionCleanup = () => void;

export interface SettingsExtensionContext {
  onClose: () => void;
  activateSection: (id: string) => boolean;
  nav: Readonly<{
    currentSection: string;
    availableSections: readonly string[];
    cwd: string | null;
    sessionId: string | null;
  }>;
}

export type SettingsExtensionMount = (
  host: HTMLElement,
  context: SettingsExtensionContext,
) => SettingsExtensionCleanup | void;

export interface SettingsNativeAbi {
  registerRenderer(id: string, mount: SettingsExtensionMount): () => void;
  notifyPreferencesChanged(): void;
  activateSection(id: string): boolean;
  getActiveSection(): string | null;
  isModalOpen(): boolean;
}

declare global {
  interface Window {
    __PI_WEB_SETTINGS_NATIVE__?: SettingsNativeAbi;
  }
}

type PreferenceListener = () => void;
type RendererChangeListener = (id: string) => void;
type RendererMap = Map<string, SettingsExtensionMount>;

interface ModalRuntime {
  activateSection(id: string): boolean;
  getActiveSection(): string | null;
  isModalOpen(): boolean;
  onRendererRegistered(id: string): void;
}

class SettingsExtensionRegistry {
  private renderers: RendererMap = new Map();
  private preferenceListeners: Set<PreferenceListener> = new Set();
  private rendererListeners: Set<RendererChangeListener> = new Set();
  private currentModal: ModalRuntime | null = null;
  private readyDispatched = false;

  constructor() {
    this.ensureWindowAbi();
  }

  public registerRenderer(id: string, mount: SettingsExtensionMount): () => void {
    this.renderers.set(id, mount);
    if (this.currentModal) {
      this.currentModal.onRendererRegistered(id);
    }
    this.notifyRendererChanged(id);
    return () => {
      if (this.renderers.get(id) === mount) {
        this.renderers.delete(id);
        this.notifyRendererChanged(id);
      }
    };
  }

  public getRenderer(id: string): SettingsExtensionMount | undefined {
    return this.renderers.get(id);
  }

  public subscribeRenderer(id: string, listener: () => void): () => void {
    const handler: RendererChangeListener = (changedId) => {
      if (changedId === id || changedId === "*") {
        listener();
      }
    };
    this.rendererListeners.add(handler);
    return () => {
      this.rendererListeners.delete(handler);
    };
  }

  public subscribeAllRenderers(listener: (id: string) => void): () => void {
    this.rendererListeners.add(listener);
    return () => {
      this.rendererListeners.delete(listener);
    };
  }

  private notifyRendererChanged(id: string): void {
    for (const listener of this.rendererListeners) {
      try {
        listener(id);
      } catch (err) {
        console.error("Error in settings renderer listener:", err);
      }
    }
  }

  public notifyPreferencesChanged(): void {
    for (const listener of this.preferenceListeners) {
      try {
        listener();
      } catch (err) {
        console.error("Error in settings preference listener:", err);
      }
    }
  }

  public subscribePreferences(listener: PreferenceListener): () => void {
    this.preferenceListeners.add(listener);
    return () => {
      this.preferenceListeners.delete(listener);
    };
  }

  public setModalRuntime(modal: ModalRuntime | null): void {
    this.currentModal = modal;
  }

  public activateSection(id: string): boolean {
    if (!this.currentModal) return false;
    return this.currentModal.activateSection(id);
  }

  public getActiveSection(): string | null {
    if (!this.currentModal) return null;
    return this.currentModal.getActiveSection();
  }

  public isModalOpen(): boolean {
    return Boolean(this.currentModal && this.currentModal.isModalOpen());
  }

  public ensureWindowAbi(): SettingsNativeAbi | null {
    if (typeof window === "undefined") return null;

    const abi: SettingsNativeAbi = {
      registerRenderer: (id, mount) => this.registerRenderer(id, mount),
      notifyPreferencesChanged: () => this.notifyPreferencesChanged(),
      activateSection: (id) => this.activateSection(id),
      getActiveSection: () => this.getActiveSection(),
      isModalOpen: () => this.isModalOpen(),
    };

    window.__PI_WEB_SETTINGS_NATIVE__ = abi;

    if (!this.readyDispatched) {
      this.readyDispatched = true;
      try {
        window.dispatchEvent(new CustomEvent("pi-web:settings-native-ready", { detail: abi }));
      } catch {}
    }

    return abi;
  }
}

export const settingsExtensionRegistry = new SettingsExtensionRegistry();
