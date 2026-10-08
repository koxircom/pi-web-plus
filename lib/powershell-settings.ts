import { createRequire } from "node:module";
import {
  defaultToolEntries,
  getGlobalSettingsPath,
  readGlobalSettings,
  updateGlobalSettings,
} from "./global-settings-file";

const require = createRequire(import.meta.url);
const {
  discoverWindowsGitBash,
  discoverWindowsPowerShell,
} = require("../bin/windows-shells.cjs");

const DEFAULT_TOOLS = ["read", "bash", "edit", "write"];
const SHELL_TOOLS = new Set(["bash", "powershell"]);

export type ShellAvailability = {
  hasBash?: boolean;
  hasPowerShell?: boolean;
};

export type ShellSelectionOptions = {
  availability?: ShellAvailability;
  platform?: NodeJS.Platform;
  shellPath?: string;
};

function isToolModifier(entry: string): boolean {
  return entry.startsWith("+") || entry.startsWith("-");
}

function hasExplicitShellSelection(defaultTools: readonly string[]): boolean {
  const plain = defaultTools.filter((t) => !isToolModifier(t));
  if (plain.length > 0 || defaultTools.length === 0) {
    return true;
  }
  return defaultTools.some((t) => {
    const name = t.slice(1);
    return SHELL_TOOLS.has(name);
  });
}

export function isPowerShellToolEnabled(
  defaultTools: readonly string[] | undefined,
  options?: NodeJS.Platform | ShellSelectionOptions,
): boolean {
  const platform = typeof options === "string" ? options : options?.platform ?? process.platform;
  if (platform !== "win32") return false;

  const availability = typeof options === "object" ? options.availability : undefined;
  const shellPath = typeof options === "object" ? options.shellPath : undefined;

  if (defaultTools !== undefined && hasExplicitShellSelection(defaultTools)) {
    const finalTools = resolveDefaultToolEntries(defaultTools);
    const hasBash = finalTools.includes("bash");
    const hasPowerShell = finalTools.includes("powershell");

    if (hasBash) return false;
    if (hasPowerShell) return true;
    return false;
  }

  // SDK shellPath belongs to Bash; never silently discard a configured
  // executable merely because its filename resembles PowerShell.
  if (shellPath) return false;

  let hasBash = availability?.hasBash;
  let hasPowerShell = availability?.hasPowerShell;
  if (hasBash === undefined) {
    hasBash = Boolean(discoverWindowsGitBash({ platform: "win32" }));
  }
  if (hasPowerShell === undefined) {
    hasPowerShell = Boolean(discoverWindowsPowerShell({ platform: "win32" }));
  }

  if (hasBash) return false;
  if (hasPowerShell) return true;
  return false;
}

export function replaceShellTool(
  toolNames: readonly string[],
  usePowerShell: boolean,
): string[] {
  const shell = usePowerShell ? "powershell" : "bash";
  const result: string[] = [];
  for (const name of toolNames) {
    const next = SHELL_TOOLS.has(name) ? shell : name;
    if (!result.includes(next)) result.push(next);
  }
  return result;
}

export function resolveShellTools(
  toolNames: readonly string[],
  defaultTools: readonly string[] | undefined,
  options?: NodeJS.Platform | ShellSelectionOptions,
): string[] {
  if (toolNames.length === 0) return [];
  return replaceShellTool(toolNames, isPowerShellToolEnabled(defaultTools, options));
}

export function getPowerShellSettingsPath(agentDir?: string): string {
  return getGlobalSettingsPath(agentDir);
}

/**
 * The tools a `defaultTools` list selects, by pi's rule (0.99): plain names replace the
 * defaults, then each `+name` adds and each `-name` removes a tool, in list order.
 */
export function resolveDefaultToolEntries(entries: readonly string[]): string[] {
  const plain = entries.filter((entry) => !isToolModifier(entry));
  const tools = plain.length > 0 || entries.length === 0 ? plain : [...DEFAULT_TOOLS];
  for (const entry of entries) {
    if (!isToolModifier(entry)) continue;
    const name = entry.slice(1);
    const index = tools.indexOf(name);
    if (entry.startsWith("+") && index === -1 && name) tools.push(name);
    else if (entry.startsWith("-") && index !== -1) tools.splice(index, 1);
  }
  return tools;
}

/**
 * The resolved tool list, never the raw entries: appending a plain name to a list of only
 * `+name`/`-name` entries would turn it into a plain list that drops pi's default tools.
 */
function configuredTools(settings: Record<string, unknown>): string[] | undefined {
  const entries = defaultToolEntries(settings);
  return entries === undefined ? undefined : resolveDefaultToolEntries(entries);
}

export async function readPowerShellToolEnabled(
  settingsPath = getPowerShellSettingsPath(),
  options?: NodeJS.Platform | ShellSelectionOptions,
): Promise<boolean> {
  const platform = typeof options === "string" ? options : options?.platform ?? process.platform;
  return readGlobalSettings(settingsPath, (settings) => {
    const rawEntries = defaultToolEntries(settings);
    const selection = typeof options === "object" ? options : { platform };
    return isPowerShellToolEnabled(rawEntries, {
      ...selection,
      shellPath: selection.shellPath ?? (typeof settings.shellPath === "string" ? settings.shellPath : undefined),
    });
  });
}

export async function writePowerShellToolEnabled(
  enabled: boolean,
  settingsPath = getPowerShellSettingsPath(),
  platform: NodeJS.Platform = process.platform,
): Promise<boolean> {
  if (platform !== "win32") throw new Error("PowerShell tool settings are only available on Windows");

  await updateGlobalSettings(settingsPath, (settings) => {
    const currentTools = configuredTools(settings) ?? DEFAULT_TOOLS;
    const nextTools = replaceShellTool(currentTools, enabled);
    if (!currentTools.some((name) => SHELL_TOOLS.has(name))) {
      nextTools.push(enabled ? "powershell" : "bash");
    }
    settings.defaultTools = nextTools;
  });
  return enabled;
}
