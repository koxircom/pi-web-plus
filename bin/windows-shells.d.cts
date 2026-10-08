export interface WindowsShellDiscoveryOptions {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  isFile?: (filePath: string) => boolean;
  explicitShellPath?: string;
}

export interface PrepareWindowsShellEnvironmentOptions {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  isFile?: (filePath: string) => boolean;
}

export interface PrepareWindowsShellEnvironmentResult {
  env: NodeJS.ProcessEnv;
  gitDir?: string;
  powershellDir?: string;
  system32Dir?: string;
}

export function isWslBashPath(filePath?: string): boolean;

export function validateExplicitShellPath(
  shellPath: string,
  options?: WindowsShellDiscoveryOptions,
): string;

export function discoverWindowsGitBash(
  options?: WindowsShellDiscoveryOptions,
): string | null;

export function discoverWindowsPowerShell(
  options?: WindowsShellDiscoveryOptions,
): string | null;

export function prepareWindowsShellEnvironment(
  options?: PrepareWindowsShellEnvironmentOptions,
): PrepareWindowsShellEnvironmentResult;
