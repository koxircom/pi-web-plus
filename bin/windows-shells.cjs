// Windows Shell Discovery & Environment Preparation
// Discovers Git Bash and PowerShell on Windows without recursive scans, where.exe reliance, or private paths.

const fs = require("node:fs");
const path = require("node:path");

function defaultIsFile(filePath) {
  try {
    const stat = fs.statSync(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

function getEnvCaseInsensitive(env, key) {
  if (!env) return undefined;
  const upper = key.toUpperCase();
  for (const k of Object.keys(env)) {
    if (k.toUpperCase() === upper) {
      return env[k];
    }
  }
  return undefined;
}

function getPathKey(env) {
  if (!env) return "PATH";
  for (const k of Object.keys(env)) {
    if (k.toUpperCase() === "PATH") {
      return k;
    }
  }
  return "PATH";
}

function normalizePathForComparison(p) {
  if (!p) return "";
  return path.win32.normalize(p).toLowerCase().replace(/[\\/]+$/, "");
}

function isWslBashPath(filePath) {
  if (!filePath || typeof filePath !== "string") return false;
  const normalized = filePath.replace(/\\/g, "/").toLowerCase();
  return (
    normalized.endsWith("/system32/bash.exe") ||
    normalized.endsWith("/sysnative/bash.exe") ||
    normalized.includes("/windows/system32/bash.exe") ||
    normalized.includes("/windows/sysnative/bash.exe")
  );
}

function validateExplicitShellPath(shellPath, options = {}) {
  const platform = options.platform || process.platform;
  const isFile = options.isFile || defaultIsFile;

  if (!shellPath || typeof shellPath !== "string") {
    throw new Error("Invalid shellPath: must be a non-empty string");
  }

  if (platform === "win32" && isWslBashPath(shellPath)) {
    throw new Error(
      `Configured shell "${shellPath}" is WSL bash.exe. WSL is not Windows native (cross-system execution is prohibited). Please use Git Bash or PowerShell.`
    );
  }

  if (!isFile(shellPath)) {
    throw new Error(`Configured shellPath does not exist: "${shellPath}"`);
  }

  return shellPath;
}

function unquotePathEntry(entry) {
  if (!entry || typeof entry !== "string") return "";
  let trimmed = entry.trim();
  if (
    trimmed.length >= 2 &&
    trimmed.startsWith('"') &&
    trimmed.endsWith('"')
  ) {
    trimmed = trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function isAbsoluteWindowsPath(p) {
  if (!p || typeof p !== "string") return false;
  return (
    path.win32.isAbsolute(p) &&
    (/^[a-zA-Z]:[\\/]/.test(p) || /^\\\\[^\\/]+[\\/]/.test(p))
  );
}

function splitPathEntries(pathValue, platform = "win32") {
  if (!pathValue || typeof pathValue !== "string") return [];
  const delimiter = platform === "win32" ? ";" : ":";
  return pathValue
    .split(delimiter)
    .map((entry) => unquotePathEntry(entry))
    .filter(Boolean);
}

function discoverWindowsGitBash(options = {}) {
  const platform = options.platform || process.platform;
  if (platform !== "win32") return null;

  const env = options.env || process.env;
  const isFile = options.isFile || defaultIsFile;

  if (options.explicitShellPath) {
    return validateExplicitShellPath(options.explicitShellPath, options);
  }

  // 1. Probe PATH for native Git Bash (only bash.exe; git-bash.exe is a GUI launcher, not usable by SDK -c)
  const pathValue = getEnvCaseInsensitive(env, "PATH");
  const pathEntries = splitPathEntries(pathValue, "win32");
  for (const dir of pathEntries) {
    if (!isAbsoluteWindowsPath(dir)) continue;
    const candidate = path.win32.join(dir, "bash.exe");
    if (!isWslBashPath(candidate) && isFile(candidate)) {
      return candidate;
    }
  }

  // 2. Fixed well-known installation locations (no recursive scanning, no where.exe dependency)
  const programFiles = getEnvCaseInsensitive(env, "ProgramFiles") || "C:\\Program Files";
  const programFilesX86 = getEnvCaseInsensitive(env, "ProgramFiles(x86)") || "C:\\Program Files (x86)";
  const localAppData = getEnvCaseInsensitive(env, "LOCALAPPDATA");
  const userProfile = getEnvCaseInsensitive(env, "USERPROFILE") || getEnvCaseInsensitive(env, "HOME");
  const scoop = getEnvCaseInsensitive(env, "SCOOP");
  const programData = getEnvCaseInsensitive(env, "ProgramData") || "C:\\ProgramData";

  const fixedCandidates = [
    // Standard Program Files (64-bit and 32-bit)
    path.win32.join(programFiles, "Git", "bin", "bash.exe"),
    path.win32.join(programFiles, "Git", "usr", "bin", "bash.exe"),
    path.win32.join(programFilesX86, "Git", "bin", "bash.exe"),
    path.win32.join(programFilesX86, "Git", "usr", "bin", "bash.exe"),

    // User LocalAppData
    localAppData && path.win32.join(localAppData, "Programs", "Git", "bin", "bash.exe"),
    localAppData && path.win32.join(localAppData, "Programs", "Git", "usr", "bin", "bash.exe"),

    // Scoop user installations
    userProfile && path.win32.join(userProfile, "scoop", "apps", "git", "current", "bin", "bash.exe"),
    userProfile && path.win32.join(userProfile, "scoop", "apps", "git", "current", "usr", "bin", "bash.exe"),

    // Scoop custom root
    scoop && path.win32.join(scoop, "apps", "git", "current", "bin", "bash.exe"),
    scoop && path.win32.join(scoop, "apps", "git", "current", "usr", "bin", "bash.exe"),

    // Scoop global installations
    path.win32.join(programData, "scoop", "apps", "git", "current", "bin", "bash.exe"),
    path.win32.join(programData, "scoop", "apps", "git", "current", "usr", "bin", "bash.exe"),

    // Hard fallback drive candidates if environment variables are missing
    "C:\\Program Files\\Git\\bin\\bash.exe",
    "C:\\Program Files\\Git\\usr\\bin\\bash.exe",
    "C:\\Program Files (x86)\\Git\\bin\\bash.exe",
    "C:\\Program Files (x86)\\Git\\usr\\bin\\bash.exe",
  ].filter(Boolean);

  const seen = new Set();
  for (const candidate of fixedCandidates) {
    const norm = normalizePathForComparison(candidate);
    if (seen.has(norm)) continue;
    seen.add(norm);

    if (!isWslBashPath(candidate) && isFile(candidate)) {
      return candidate;
    }
  }

  return null;
}

function discoverWindowsPowerShell(options = {}) {
  const platform = options.platform || process.platform;
  if (platform !== "win32") return null;

  const env = options.env || process.env;
  const isFile = options.isFile || defaultIsFile;

  const pathValue = getEnvCaseInsensitive(env, "PATH");
  const pathEntries = splitPathEntries(pathValue, "win32");

  // Priority 1: Modern PowerShell (pwsh.exe) in PATH, then ProgramFiles
  for (const dir of pathEntries) {
    if (!isAbsoluteWindowsPath(dir)) continue;
    const candidate = path.win32.join(dir, "pwsh.exe");
    if (isFile(candidate)) return candidate;
  }

  const programFiles = getEnvCaseInsensitive(env, "ProgramFiles") || "C:\\Program Files";
  const programFilesX86 = getEnvCaseInsensitive(env, "ProgramFiles(x86)") || "C:\\Program Files (x86)";
  const userProfile = getEnvCaseInsensitive(env, "USERPROFILE") || getEnvCaseInsensitive(env, "HOME");
  const scoop = getEnvCaseInsensitive(env, "SCOOP");
  const programData = getEnvCaseInsensitive(env, "ProgramData") || "C:\\ProgramData";

  const pwshCandidates = [
    path.win32.join(programFiles, "PowerShell", "7", "pwsh.exe"),
    path.win32.join(programFilesX86, "PowerShell", "7", "pwsh.exe"),
    userProfile && path.win32.join(userProfile, "scoop", "apps", "pwsh", "current", "pwsh.exe"),
    scoop && path.win32.join(scoop, "apps", "pwsh", "current", "pwsh.exe"),
    path.win32.join(programData, "scoop", "apps", "pwsh", "current", "pwsh.exe"),
    "C:\\Program Files\\PowerShell\\7\\pwsh.exe",
  ].filter(Boolean);

  for (const candidate of pwshCandidates) {
    if (isFile(candidate)) return candidate;
  }

  // Priority 2: Windows PowerShell 5.1 (powershell.exe) in PATH, then SystemRoot
  for (const dir of pathEntries) {
    if (!isAbsoluteWindowsPath(dir)) continue;
    const candidate = path.win32.join(dir, "powershell.exe");
    if (isFile(candidate)) return candidate;
  }

  const systemRoot = getEnvCaseInsensitive(env, "SystemRoot") || getEnvCaseInsensitive(env, "windir") || "C:\\Windows";
  const ps5Candidates = [
    path.win32.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
    path.win32.join(systemRoot, "SysWOW64", "WindowsPowerShell", "v1.0", "powershell.exe"),
    "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
  ];

  for (const candidate of ps5Candidates) {
    if (isFile(candidate)) return candidate;
  }

  // Do not fallback to cmd.exe
  return null;
}

function prepareWindowsShellEnvironment(options = {}) {
  const platform = options.platform || process.platform;
  const env = options.env || process.env;
  if (platform !== "win32") {
    return { env };
  }

  const isFile = options.isFile || defaultIsFile;
  const allPathKeys = Object.keys(env).filter((k) => k.toUpperCase() === "PATH");
  const canonicalPathKey = allPathKeys.includes("Path")
    ? "Path"
    : (allPathKeys[0] || "Path");

  const allOriginalEntries = [];
  const normalizedExisting = new Set();

  for (const k of allPathKeys) {
    const rawVal = env[k] || "";
    const entries = splitPathEntries(rawVal, "win32");
    for (const entry of entries) {
      const norm = normalizePathForComparison(entry);
      if (norm && !normalizedExisting.has(norm)) {
        normalizedExisting.add(norm);
        allOriginalEntries.push(entry);
      }
    }
  }

  const additions = [];
  function addIfMissing(dirPath) {
    if (!dirPath) return;
    const norm = normalizePathForComparison(dirPath);
    if (!normalizedExisting.has(norm)) {
      normalizedExisting.add(norm);
      additions.push(dirPath);
    }
  }

  // 1. System32 (where.exe and essential system binaries)
  const systemRoot = getEnvCaseInsensitive(env, "SystemRoot") || getEnvCaseInsensitive(env, "windir") || "C:\\Windows";
  const system32Dir = path.win32.join(systemRoot, "System32");
  addIfMissing(system32Dir);

  // 2. Discovered PowerShell directory
  const psExe = discoverWindowsPowerShell({ platform, env, isFile });
  let powershellDir;
  if (psExe) {
    powershellDir = path.win32.dirname(psExe);
    addIfMissing(powershellDir);
  }

  // 3. Discovered Git directory (cmd and bin/usr-bin)
  const gitBashExe = discoverWindowsGitBash({ platform, env, isFile });
  let gitDir;
  if (gitBashExe) {
    const gitBinDir = path.win32.dirname(gitBashExe);
    const gitRootDir = path.win32.dirname(gitBinDir);
    const gitCmdDir = path.win32.join(gitRootDir, "cmd");

    if (isFile(path.win32.join(gitCmdDir, "git.exe"))) {
      gitDir = gitCmdDir;
      addIfMissing(gitCmdDir);
    } else {
      gitDir = gitBinDir;
    }
    addIfMissing(gitBinDir);
  }

  if (allPathKeys.length > 1 || additions.length > 0) {
    const newPath = [...allOriginalEntries, ...additions].join(";");
    for (const k of allPathKeys) {
      if (k !== canonicalPathKey) {
        delete env[k];
      }
    }
    env[canonicalPathKey] = newPath;
  }

  return {
    env,
    gitDir,
    powershellDir,
    system32Dir,
  };
}

module.exports = {
  discoverWindowsGitBash,
  discoverWindowsPowerShell,
  isWslBashPath,
  prepareWindowsShellEnvironment,
  validateExplicitShellPath,
};
