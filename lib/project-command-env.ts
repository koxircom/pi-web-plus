import {
  createBashToolDefinition,
  createLocalBashOperations,
  createLocalPowerShellOperations,
  createPowerShellToolDefinition,
  getAgentDir,
  type BashOperations,
  type InlineExtension,
  type LoadExtensionsResult,
} from "@earendil-works/pi-coding-agent";
import { createRequire } from "node:module";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const {
  discoverWindowsGitBash,
  prepareWindowsShellEnvironment,
  validateExplicitShellPath,
} = require("../bin/windows-shells.cjs");

// Ensure Windows shell environment is prepared when lib module is used directly
prepareWindowsShellEnvironment();

export const HOST_EXTENSION_NAME = "pi-web-project-command-environment";
export const HOST_EXTENSION_PATH = `<inline:${HOST_EXTENSION_NAME}>`;

export const HOST_POWERSHELL_EXTENSION_NAME = "pi-web-project-command-powershell-environment";
export const HOST_POWERSHELL_EXTENSION_PATH = `<inline:${HOST_POWERSHELL_EXTENSION_NAME}>`;

export function isHostShellExtensionPath(path: string | undefined): boolean {
  return path === HOST_EXTENSION_PATH || path === HOST_POWERSHELL_EXTENSION_PATH;
}

type ProjectShellSettings = {
  getShellCommandPrefix?(): string | undefined;
  getShellPath?(): string | undefined;
};

type ProjectCommandBashOperationsOptions = {
  agentBinDir?: string;
  baseEnvironment?: NodeJS.ProcessEnv;
  localOperations?: BashOperations;
  platform?: NodeJS.Platform;
  shellPath?: string;
};

type ProjectCommandPowerShellOperationsOptions = {
  agentBinDir?: string;
  baseEnvironment?: NodeJS.ProcessEnv;
  localOperations?: ReturnType<typeof createLocalPowerShellOperations>;
  platform?: NodeJS.Platform;
};

function isHostRuntimeVariable(name: string, platform: NodeJS.Platform): boolean {
  const comparableName = platform === "win32" ? name.toUpperCase() : name;
  return comparableName === "PORT"
    || comparableName === "NODE_ENV"
    || comparableName.startsWith("NEXT_")
    // The browser login password guards this server; commands run on behalf of
    // a project (and the model reading their output) have no use for it.
    || comparableName === "PI_WEB_PASSWORD";
}

export function sanitizeProjectCommandEnvironment(
  baseEnvironment: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
): NodeJS.ProcessEnv {
  const environment = { ...baseEnvironment };
  for (const name of Object.keys(environment)) {
    if (isHostRuntimeVariable(name, platform)) delete environment[name];
  }
  return environment;
}

function withAgentBinDirectory(
  environment: NodeJS.ProcessEnv,
  agentBinDir: string,
  platform: NodeJS.Platform,
): NodeJS.ProcessEnv {
  const pathKey = platform === "win32"
    ? Object.keys(environment).find((name) => name.toUpperCase() === "PATH") ?? "PATH"
    : "PATH";
  const pathDelimiter = platform === "win32" ? ";" : ":";
  const currentPath = environment[pathKey] ?? "";
  const pathEntries = currentPath.split(pathDelimiter).filter(Boolean);
  if (!pathEntries.includes(agentBinDir)) {
    environment[pathKey] = [agentBinDir, currentPath].filter(Boolean).join(pathDelimiter);
  }
  return environment;
}

export function createProjectCommandBashOperations(
  options: ProjectCommandBashOperationsOptions = {},
): BashOperations {
  const {
    agentBinDir = join(getAgentDir(), "bin"),
    baseEnvironment = process.env,
    platform = process.platform,
  } = options;

  return {
    exec(command, cwd, executionOptions) {
      let effectiveShellPath = options.shellPath;
      if (platform === "win32") {
        if (effectiveShellPath) {
          effectiveShellPath = validateExplicitShellPath(effectiveShellPath, {
            platform: "win32",
            env: executionOptions.env ?? baseEnvironment,
          });
        } else if (!options.localOperations) {
          prepareWindowsShellEnvironment({ platform, env: process.env });
          const discovered = discoverWindowsGitBash({
            platform: "win32",
            env: executionOptions.env ?? baseEnvironment,
          });
          if (!discovered) {
            throw new Error(
              "Git Bash not found on Windows. Please install Git for Windows or configure shellPath in settings.",
            );
          }
          effectiveShellPath = discovered;
        }
      }

      const operations = options.localOperations
        ?? createLocalBashOperations({ shellPath: effectiveShellPath });

      const environment = withAgentBinDirectory(
        sanitizeProjectCommandEnvironment(executionOptions.env ?? baseEnvironment, platform),
        agentBinDir,
        platform,
      );
      return operations.exec(command, cwd, {
        ...executionOptions,
        env: environment,
      });
    },
  };
}

export function createProjectCommandPowerShellOperations(
  options: ProjectCommandPowerShellOperationsOptions = {},
): ReturnType<typeof createLocalPowerShellOperations> {
  const {
    agentBinDir = join(getAgentDir(), "bin"),
    baseEnvironment = process.env,
    platform = process.platform,
  } = options;

  if (platform === "win32") {
    prepareWindowsShellEnvironment({ platform, env: baseEnvironment });
  }

  const operations = options.localOperations
    ?? (platform === "win32" ? createLocalPowerShellOperations() : undefined);

  return {
    exec(command, cwd, executionOptions) {
      if (!operations) {
        throw new Error("The powershell tool is only available on Windows.");
      }
      const environment = withAgentBinDirectory(
        sanitizeProjectCommandEnvironment(executionOptions.env ?? baseEnvironment, platform),
        agentBinDir,
        platform,
      );
      return operations.exec(command, cwd, {
        ...executionOptions,
        env: environment,
      });
    },
  };
}

export function createProjectCommandBashExtension(options: {
  cwd: string;
  settings: ProjectShellSettings;
}): InlineExtension {
  return {
    name: HOST_EXTENSION_NAME,
    hidden: true,
    factory: (pi) => {
      const displayDefinition = createBashToolDefinition(options.cwd);
      pi.registerTool({
        ...displayDefinition,
        execute(toolCallId, params, signal, onUpdate, context) {
          const executionDefinition = createBashToolDefinition(options.cwd, {
            commandPrefix: options.settings.getShellCommandPrefix ? options.settings.getShellCommandPrefix() : undefined,
            operations: createProjectCommandBashOperations({
              shellPath: options.settings.getShellPath ? options.settings.getShellPath() : undefined,
            }),
          });
          return executionDefinition.execute(toolCallId, params, signal, onUpdate, context);
        },
      });
    },
  };
}

export function createProjectCommandPowerShellExtension(options: {
  cwd: string;
  settings?: ProjectShellSettings;
}): InlineExtension {
  return {
    name: HOST_POWERSHELL_EXTENSION_NAME,
    hidden: true,
    factory: (pi) => {
      const displayDefinition = createPowerShellToolDefinition(options.cwd);
      pi.registerTool({
        ...displayDefinition,
        execute(toolCallId, params, signal, onUpdate, context) {
          const executionDefinition = createPowerShellToolDefinition(options.cwd, {
            operations: createProjectCommandPowerShellOperations(),
          });
          return executionDefinition.execute(toolCallId, params, signal, onUpdate, context);
        },
      });
    },
  };
}

export function preferUserBashExtension(base: LoadExtensionsResult): LoadExtensionsResult {
  const hostExtensionIndex = base.extensions.findIndex((extension) => extension.path === HOST_EXTENSION_PATH);
  if (hostExtensionIndex < 0) return base;

  const userBashOwner = base.extensions
    .slice(0, hostExtensionIndex)
    .find((extension) => extension.tools.has("bash"));
  if (!userBashOwner) return base;

  return {
    ...base,
    extensions: base.extensions.filter((_, index) => index !== hostExtensionIndex),
    errors: base.errors.filter((error) => !(
      error.path === HOST_EXTENSION_PATH
      && error.error === `Tool "bash" conflicts with ${userBashOwner.path}`
    )),
  };
}

export function preferUserPowerShellExtension(base: LoadExtensionsResult): LoadExtensionsResult {
  const hostExtensionIndex = base.extensions.findIndex((extension) => extension.path === HOST_POWERSHELL_EXTENSION_PATH);
  if (hostExtensionIndex < 0) return base;

  const userPowerShellOwner = base.extensions
    .slice(0, hostExtensionIndex)
    .find((extension) => extension.tools.has("powershell"));
  if (!userPowerShellOwner) return base;

  return {
    ...base,
    extensions: base.extensions.filter((_, index) => index !== hostExtensionIndex),
    errors: base.errors.filter((error) => !(
      error.path === HOST_POWERSHELL_EXTENSION_PATH
      && error.error === `Tool "powershell" conflicts with ${userPowerShellOwner.path}`
    )),
  };
}

export function preferUserShellExtensions(base: LoadExtensionsResult): LoadExtensionsResult {
  return preferUserPowerShellExtension(preferUserBashExtension(base));
}
