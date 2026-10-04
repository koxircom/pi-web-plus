export interface ModelsData {
  models: Record<string, string>;
  modelList: { id: string; name: string; provider: string; input?: string[] }[];
  defaultModel: { provider: string; modelId: string } | null;
  /** Resolved thinking level a new session starts with when the user has not picked one. */
  defaultThinkingLevel: string | null;
  thinkingLevels: Record<string, string[]>;
  thinkingLevelMaps: Record<string, Record<string, string | null>>;
  /** `provider/modelId` → thinking level pinned by an `enabledModels` `:level` suffix. */
  thinkingLevelPins: Record<string, string>;
  modelError?: string;
  /** Warnings from resolving the `enabledModels` scope (e.g. a pattern matched nothing). */
  modelScopeWarnings?: string[];
}

interface ModelsCacheState {
  entries: Map<string, { data: ModelsData; expiresAt: number; retryAfter?: number }>;
  inFlight: Map<string, Promise<ModelsData>>;
  generation: number;
}

declare global {
  var __piModelsCacheState: ModelsCacheState | undefined;
}

const MODELS_CACHE_TTL_MS = 60_000;
// Serve stale results only for a bounded grace period, never after explicit invalidation.
const MODELS_CACHE_STALE_MS = 5 * 60_000;
const MODELS_REFRESH_RETRY_MS = 10_000;
const MAX_MODELS_CACHE_ENTRIES = 32;
// Never interpolate the caught error here; SDK errors can contain paths and provider details.
const SAFE_MODEL_LOAD_FAILURE_MESSAGE = "暂时无法获取模型，请稍后重试。";

function getModelsCacheState(): ModelsCacheState {
  if (!globalThis.__piModelsCacheState) {
    globalThis.__piModelsCacheState = {
      entries: new Map(),
      inFlight: new Map(),
      generation: 0,
    };
  }
  return globalThis.__piModelsCacheState;
}

export function invalidateModelsCache(): void {
  const state = getModelsCacheState();
  state.generation += 1;
  state.entries.clear();
  state.inFlight.clear();
}

export function withModelRuntimeError(data: ModelsData, modelError: string | undefined): ModelsData {
  return modelError ? { ...data, modelError } : data;
}

export function withSafeModelLoadFailure(data: ModelsData): ModelsData {
  return { ...data, modelError: SAFE_MODEL_LOAD_FAILURE_MESSAGE };
}

export function loadModelsWithCache(cwd: string, loader: () => Promise<ModelsData>): Promise<ModelsData> {
  const state = getModelsCacheState();
  const cached = state.entries.get(cwd);
  if (cached) {
    if (cached.expiresAt > Date.now()) return Promise.resolve(cached.data);
    if (cached.expiresAt + MODELS_CACHE_STALE_MS <= Date.now()) state.entries.delete(cwd);
    else {
      // A tab refresh must not wait on rebuilding an otherwise usable catalog.
      // Join an existing revalidation and rate-limit failures without timers.
      if (!state.inFlight.has(cwd) && (cached.retryAfter ?? 0) <= Date.now()) {
        void refreshModels(cwd, loader).catch(() => {});
      }
      return Promise.resolve(cached.data);
    }
  }

  return refreshModels(cwd, loader);
}

function refreshModels(cwd: string, loader: () => Promise<ModelsData>): Promise<ModelsData> {
  const state = getModelsCacheState();
  const existingLoad = state.inFlight.get(cwd);
  if (existingLoad) return existingLoad;

  const generation = state.generation;
  const loadPromise: Promise<ModelsData> = Promise.resolve()
    .then(loader)
    .then((data) => {
      if (!data.modelError && state.generation === generation && state.inFlight.get(cwd) === loadPromise) {
        const now = Date.now();
        state.entries.delete(cwd);
        for (const [key, entry] of state.entries) {
          if (entry.expiresAt + MODELS_CACHE_STALE_MS <= now) state.entries.delete(key);
        }
        while (state.entries.size >= MAX_MODELS_CACHE_ENTRIES) {
          const oldestKey = state.entries.keys().next().value;
          if (oldestKey === undefined) break;
          state.entries.delete(oldestKey);
        }
        state.entries.set(cwd, { data, expiresAt: now + MODELS_CACHE_TTL_MS });
      }
      return data;
    })
    .finally(() => {
      // Failure catalogs and thrown errors both leave the previous success intact.
      // Identity plus generation checks keep invalidated loads from restoring state.
      if (state.generation === generation && state.inFlight.get(cwd) === loadPromise) {
        const cached = state.entries.get(cwd);
        if (cached && cached.expiresAt <= Date.now()) cached.retryAfter = Date.now() + MODELS_REFRESH_RETRY_MS;
      }
      if (state.inFlight.get(cwd) === loadPromise) state.inFlight.delete(cwd);
    });

  state.inFlight.set(cwd, loadPromise);
  return loadPromise;
}
