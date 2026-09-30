import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { writePrivateFileAtomicSync } from "./atomic-file";

export interface SubagentOverride {
  model?: string | null;
  thinking?: string | null;
}

export interface SubagentSettings {
  builtInEnabled: boolean;
  /** Built-in profiles switched off, in the spelling the file uses. */
  disabledBuiltIns: string[];
  maxConcurrent: number;
  subagentModel: string | null;
  subagentOverrides: Record<string, SubagentOverride>;
}

type StoredSubagentSettings = Record<string, unknown> & {
  version?: unknown;
  builtInEnabled?: unknown;
  disabledBuiltIns?: unknown;
  maxConcurrent?: unknown;
  subagentModel?: unknown;
  subagentOverrides?: unknown;
};

export const DEFAULT_SUBAGENT_MAX_CONCURRENT = 10;
export const MAX_SUBAGENT_MAX_CONCURRENT = 32;

function readMaxConcurrent(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= MAX_SUBAGENT_MAX_CONCURRENT
    ? value
    : DEFAULT_SUBAGENT_MAX_CONCURRENT;
}

/**
 * Built-in profiles have no file to carry `enabled: false`, so their off state is
 * stored here by name. Entries are kept as authored and matched case-insensitively;
 * a name no built-in claims is preserved rather than dropped, because it usually
 * means the file was written by a newer build.
 */
function readDisabledBuiltIns(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const names: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const name = entry.trim();
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  return names;
}

function readSubagentModel(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readSubagentOverrides(value: unknown): Record<string, SubagentOverride> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const overrides: Record<string, SubagentOverride> = {};
  for (const [rawKey, rawVal] of Object.entries(value)) {
    const key = rawKey.trim().toLowerCase();
    if (!key || !rawVal || typeof rawVal !== "object" || Array.isArray(rawVal)) continue;
    const val = rawVal as Record<string, unknown>;
    const model = typeof val.model === "string" && val.model.trim() ? val.model.trim() : null;
    const thinking = typeof val.thinking === "string" && val.thinking.trim() ? val.thinking.trim() : null;
    if (model || thinking) {
      overrides[key] = {
        ...(model ? { model } : {}),
        ...(thinking ? { thinking } : {}),
      };
    }
  }
  return overrides;
}

function settingsValue(
  builtInEnabled: boolean,
  maxConcurrent: number,
  disabledBuiltIns: string[],
  subagentModel: string | null,
  subagentOverrides: Record<string, SubagentOverride> = {},
): SubagentSettings {
  const settings = Object.defineProperty({ builtInEnabled, disabledBuiltIns }, "maxConcurrent", {
    value: maxConcurrent,
    enumerable: false,
    configurable: true,
  });
  Object.defineProperty(settings, "subagentModel", {
    value: subagentModel,
    enumerable: false,
    configurable: true,
  });
  return Object.defineProperty(settings, "subagentOverrides", {
    value: subagentOverrides,
    enumerable: false,
    configurable: true,
  }) as SubagentSettings;
}

export function getSubagentSettingsPath(agentDir = getAgentDir()): string {
  return join(agentDir, "agents", "settings.json");
}

function readStoredSettings(settingsPath: string): StoredSubagentSettings {
  if (!existsSync(settingsPath)) return {};
  const parsed: unknown = JSON.parse(readFileSync(settingsPath, "utf8"));
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Invalid subagent settings: expected an object");
  }
  return parsed as StoredSubagentSettings;
}

export function readSubagentSettings(
  settingsPath = getSubagentSettingsPath(),
): SubagentSettings {
  const stored = readStoredSettings(settingsPath);
  return settingsValue(
    stored.builtInEnabled === true,
    readMaxConcurrent(stored.maxConcurrent),
    readDisabledBuiltIns(stored.disabledBuiltIns),
    readSubagentModel(stored.subagentModel),
    readSubagentOverrides(stored.subagentOverrides),
  );
}

/**
 * Lowercased names of the built-in profiles switched off.
 *
 * Damaged settings fail *open* here, unlike `isBuiltInSubagentsEnabled`: an
 * unreadable file must not make built-in profiles vanish from the Agents panel,
 * and the feature switch it also holds has already failed closed by then.
 */
export function disabledBuiltInSubagents(
  settingsPath = getSubagentSettingsPath(),
): ReadonlySet<string> {
  try {
    return new Set(readSubagentSettings(settingsPath).disabledBuiltIns.map((name) => name.toLowerCase()));
  } catch {
    return new Set();
  }
}

export function isBuiltInSubagentsEnabled(
  settingsPath = getSubagentSettingsPath(),
): boolean {
  try {
    return readSubagentSettings(settingsPath).builtInEnabled;
  } catch {
    return false;
  }
}

export function writeBuiltInSubagentsEnabled(
  enabled: boolean,
  settingsPath = getSubagentSettingsPath(),
): SubagentSettings {
  const stored = readStoredSettings(settingsPath);
  mkdirSync(dirname(settingsPath), { recursive: true });
  writePrivateFileAtomicSync(settingsPath, JSON.stringify({
    ...stored,
    version: 1,
    builtInEnabled: enabled,
  }, null, 2));
  return readSubagentSettings(settingsPath);
}

/** Minimal edit of the stored list: names this call did not touch are left as authored. */
export function writeDisabledBuiltInSubagent(
  name: string,
  disabled: boolean,
  settingsPath = getSubagentSettingsPath(),
): SubagentSettings {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Sub-agent name is required");
  const stored = readStoredSettings(settingsPath);
  const current = readDisabledBuiltIns(stored.disabledBuiltIns);
  const key = trimmed.toLowerCase();
  const alreadyDisabled = current.some((entry) => entry.toLowerCase() === key);
  // Nothing to record: leave the file exactly as it is, unnormalized keys included.
  if (disabled === alreadyDisabled) return readSubagentSettings(settingsPath);
  const disabledBuiltIns = disabled
    ? alreadyDisabled ? current : [...current, trimmed]
    : current.filter((entry) => entry.toLowerCase() !== key);
  mkdirSync(dirname(settingsPath), { recursive: true });
  writePrivateFileAtomicSync(settingsPath, JSON.stringify({
    ...stored,
    version: 1,
    disabledBuiltIns,
  }, null, 2));
  return readSubagentSettings(settingsPath);
}

export function writeSubagentMaxConcurrent(
  maxConcurrent: number,
  settingsPath = getSubagentSettingsPath(),
): SubagentSettings {
  if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1 || maxConcurrent > MAX_SUBAGENT_MAX_CONCURRENT) {
    throw new Error(`maxConcurrent must be an integer between 1 and ${MAX_SUBAGENT_MAX_CONCURRENT}`);
  }
  const stored = readStoredSettings(settingsPath);
  mkdirSync(dirname(settingsPath), { recursive: true });
  writePrivateFileAtomicSync(settingsPath, JSON.stringify({
    ...stored,
    version: 1,
    maxConcurrent,
  }, null, 2));
  return readSubagentSettings(settingsPath);
}

export function writeSubagentModelOverride(
  subagentModel: string | null,
  settingsPath = getSubagentSettingsPath(),
): SubagentSettings {
  const normalized = typeof subagentModel === "string" ? subagentModel.trim() : null;
  if (subagentModel !== null && !normalized) throw new Error("subagentModel must be null or a non-empty string");
  const stored = readStoredSettings(settingsPath);
  const next: StoredSubagentSettings = { ...stored, version: 1 };
  delete next.defaultProfile;
  if (normalized) next.subagentModel = normalized;
  else delete next.subagentModel;
  mkdirSync(dirname(settingsPath), { recursive: true });
  writePrivateFileAtomicSync(settingsPath, JSON.stringify(next, null, 2));
  return readSubagentSettings(settingsPath);
}

export function writeSubagentProfileOverride(
  profileName: string,
  override: SubagentOverride | null,
  settingsPath = getSubagentSettingsPath(),
): SubagentSettings {
  const key = typeof profileName === "string" ? profileName.trim().toLowerCase() : "";
  if (!key) throw new Error("profileName must be a non-empty string");

  const stored = readStoredSettings(settingsPath);
  const existingOverrides = readSubagentOverrides(stored.subagentOverrides);
  const nextOverrides: Record<string, SubagentOverride> = { ...existingOverrides };

  const model = typeof override?.model === "string" && override.model.trim() ? override.model.trim() : null;
  const thinking = typeof override?.thinking === "string" && override.thinking.trim() ? override.thinking.trim() : null;

  if (override === null || (!model && !thinking)) {
    delete nextOverrides[key];
  } else {
    nextOverrides[key] = {
      ...(model ? { model } : {}),
      ...(thinking ? { thinking } : {}),
    };
  }

  const next: StoredSubagentSettings = { ...stored, version: 1 };
  if (Object.keys(nextOverrides).length > 0) {
    next.subagentOverrides = nextOverrides;
  } else {
    delete next.subagentOverrides;
  }

  mkdirSync(dirname(settingsPath), { recursive: true });
  writePrivateFileAtomicSync(settingsPath, JSON.stringify(next, null, 2));
  return readSubagentSettings(settingsPath);
}

export function writeSubagentOverrides(
  overrides: Record<string, SubagentOverride | null>,
  settingsPath = getSubagentSettingsPath(),
): SubagentSettings {
  if (!overrides || typeof overrides !== "object" || Array.isArray(overrides)) {
    throw new Error("overrides must be an object");
  }
  const stored = readStoredSettings(settingsPath);
  const existingOverrides = readSubagentOverrides(stored.subagentOverrides);
  const nextOverrides: Record<string, SubagentOverride> = { ...existingOverrides };

  for (const [rawKey, override] of Object.entries(overrides)) {
    const key = rawKey.trim().toLowerCase();
    if (!key) continue;
    const model = typeof override?.model === "string" && override.model.trim() ? override.model.trim() : null;
    const thinking = typeof override?.thinking === "string" && override.thinking.trim() ? override.thinking.trim() : null;
    if (override === null || (!model && !thinking)) {
      delete nextOverrides[key];
    } else {
      nextOverrides[key] = {
        ...(model ? { model } : {}),
        ...(thinking ? { thinking } : {}),
      };
    }
  }

  const next: StoredSubagentSettings = { ...stored, version: 1 };
  if (Object.keys(nextOverrides).length > 0) {
    next.subagentOverrides = nextOverrides;
  } else {
    delete next.subagentOverrides;
  }

  mkdirSync(dirname(settingsPath), { recursive: true });
  writePrivateFileAtomicSync(settingsPath, JSON.stringify(next, null, 2));
  return readSubagentSettings(settingsPath);
}
