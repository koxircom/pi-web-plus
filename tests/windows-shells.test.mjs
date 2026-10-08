import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  discoverWindowsGitBash,
  discoverWindowsPowerShell,
  isWslBashPath,
  prepareWindowsShellEnvironment,
  validateExplicitShellPath,
} = require("../bin/windows-shells.cjs");

test("Unix platforms return null for Windows shell discovery and return env unchanged", () => {
  assert.equal(discoverWindowsGitBash({ platform: "linux" }), null);
  assert.equal(discoverWindowsGitBash({ platform: "darwin" }), null);
  assert.equal(discoverWindowsPowerShell({ platform: "linux" }), null);
  assert.equal(discoverWindowsPowerShell({ platform: "darwin" }), null);

  const env = { PATH: "/usr/bin:/bin" };
  const res = prepareWindowsShellEnvironment({ platform: "linux", env });
  assert.deepEqual(res.env, env);
});

test("Git Bash discovery handles spaces in paths and standard Program Files", () => {
  const fileSystem = new Set([
    "C:\\Program Files\\Git\\bin\\bash.exe",
  ]);
  const isFile = (p) => fileSystem.has(p);

  const env = {
    ProgramFiles: "C:\\Program Files",
    PATH: "C:\\Windows\\System32",
  };

  const found = discoverWindowsGitBash({
    platform: "win32",
    env,
    isFile,
  });

  assert.equal(found, "C:\\Program Files\\Git\\bin\\bash.exe");
});

test("Git Bash discovery finds user installations (LOCALAPPDATA and Scoop)", () => {
  const isFile1 = (p) => p === "C:\\Users\\User\\AppData\\Local\\Programs\\Git\\bin\\bash.exe";
  const found1 = discoverWindowsGitBash({
    platform: "win32",
    env: {
      LOCALAPPDATA: "C:\\Users\\User\\AppData\\Local",
      PATH: "",
    },
    isFile: isFile1,
  });
  assert.equal(found1, "C:\\Users\\User\\AppData\\Local\\Programs\\Git\\bin\\bash.exe");

  const isFile2 = (p) => p === "C:\\Users\\User\\scoop\\apps\\git\\current\\usr\\bin\\bash.exe";
  const found2 = discoverWindowsGitBash({
    platform: "win32",
    env: {
      USERPROFILE: "C:\\Users\\User",
      PATH: "",
    },
    isFile: isFile2,
  });
  assert.equal(found2, "C:\\Users\\User\\scoop\\apps\\git\\current\\usr\\bin\\bash.exe");
});

test("WSL bash in System32 / Sysnative is excluded from automatic Git Bash discovery", () => {
  const fileSystem = new Set([
    "C:\\Windows\\System32\\bash.exe",
    "C:\\Windows\\Sysnative\\bash.exe",
    "C:\\Program Files\\Git\\bin\\bash.exe",
  ]);
  const isFile = (p) => fileSystem.has(p);

  const env = {
    PATH: "C:\\Windows\\System32;C:\\SomethingElse",
    ProgramFiles: "C:\\Program Files",
  };

  const found = discoverWindowsGitBash({
    platform: "win32",
    env,
    isFile,
  });

  assert.equal(found, "C:\\Program Files\\Git\\bin\\bash.exe");
});

test("Missing PATH and SystemRoot fall back safely without throwing", () => {
  const isFile = (p) => p === "C:\\Program Files\\Git\\bin\\bash.exe";
  const found = discoverWindowsGitBash({
    platform: "win32",
    env: {},
    isFile,
  });
  assert.equal(found, "C:\\Program Files\\Git\\bin\\bash.exe");
});

test("Explicit shellPath validates existence and forbids WSL bash", () => {
  const isFile = (p) => p === "C:\\Custom\\Git\\bin\\bash.exe" || p === "C:\\Windows\\System32\\bash.exe";

  // Valid custom path
  const valid = validateExplicitShellPath("C:\\Custom\\Git\\bin\\bash.exe", {
    platform: "win32",
    isFile,
  });
  assert.equal(valid, "C:\\Custom\\Git\\bin\\bash.exe");

  // Non-existent path throws without silent fallback
  assert.throws(
    () => {
      validateExplicitShellPath("C:\\Missing\\bash.exe", {
        platform: "win32",
        isFile,
      });
    },
    /Configured shellPath does not exist/,
  );

  // Explicit WSL bash throws with clear explanation
  assert.throws(
    () => {
      validateExplicitShellPath("C:\\Windows\\System32\\bash.exe", {
        platform: "win32",
        isFile,
      });
    },
    /WSL is not Windows native/,
  );
});

test("PowerShell discovery priority: PATH pwsh -> ProgramFiles pwsh -> PATH powershell -> SystemRoot powershell", () => {
  // Scenario 1: pwsh in PATH wins
  const files1 = new Set([
    "D:\\Tools\\pwsh.exe",
    "C:\\Program Files\\PowerShell\\7\\pwsh.exe",
    "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
  ]);
  const found1 = discoverWindowsPowerShell({
    platform: "win32",
    env: {
      PATH: "D:\\Tools",
      ProgramFiles: "C:\\Program Files",
      SystemRoot: "C:\\Windows",
    },
    isFile: (p) => files1.has(p),
  });
  assert.equal(found1, "D:\\Tools\\pwsh.exe");

  // Scenario 2: ProgramFiles pwsh 7 wins over Windows PowerShell
  const files2 = new Set([
    "C:\\Program Files\\PowerShell\\7\\pwsh.exe",
    "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
  ]);
  const found2 = discoverWindowsPowerShell({
    platform: "win32",
    env: {
      PATH: "C:\\Windows\\System32",
      ProgramFiles: "C:\\Program Files",
      SystemRoot: "C:\\Windows",
    },
    isFile: (p) => files2.has(p),
  });
  assert.equal(found2, "C:\\Program Files\\PowerShell\\7\\pwsh.exe");

  // Scenario 3: Windows PowerShell 5.1 in SystemRoot when pwsh absent
  const files3 = new Set([
    "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
  ]);
  const found3 = discoverWindowsPowerShell({
    platform: "win32",
    env: {
      PATH: "",
      SystemRoot: "C:\\Windows",
    },
    isFile: (p) => files3.has(p),
  });
  assert.equal(found3, "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe");

  // Scenario 4: Does not fall back to cmd.exe
  const files4 = new Set(["C:\\Windows\\System32\\cmd.exe"]);
  const found4 = discoverWindowsPowerShell({
    platform: "win32",
    env: { PATH: "C:\\Windows\\System32" },
    isFile: (p) => files4.has(p),
  });
  assert.equal(found4, null);
});

test("prepareWindowsShellEnvironment appends System32, PowerShell and Git directories idempotently", () => {
  const fileSystem = new Set([
    "C:\\Program Files\\PowerShell\\7\\pwsh.exe",
    "C:\\Program Files\\Git\\bin\\bash.exe",
    "C:\\Program Files\\Git\\cmd\\git.exe",
  ]);
  const isFile = (p) => fileSystem.has(p);

  const env = {
    Path: "D:\\Project\\bin",
    ProgramFiles: "C:\\Program Files",
    SystemRoot: "C:\\Windows",
  };

  const res1 = prepareWindowsShellEnvironment({
    platform: "win32",
    env,
    isFile,
  });

  const pathVal1 = res1.env.Path;
  assert.ok(pathVal1.startsWith("D:\\Project\\bin"));
  assert.ok(pathVal1.includes("C:\\Windows\\System32"));
  assert.ok(pathVal1.includes("C:\\Program Files\\PowerShell\\7"));
  assert.ok(pathVal1.includes("C:\\Program Files\\Git\\cmd"));

  // Idempotency check: repeated calls do not duplicate entries
  const res2 = prepareWindowsShellEnvironment({
    platform: "win32",
    env: res1.env,
    isFile,
  });

  assert.equal(res2.env.Path, pathVal1);
});

test("Git Bash discovery ignores git-bash.exe and only accepts bash.exe", () => {
  const fileSystem = new Set([
    "C:\\Program Files\\Git\\git-bash.exe",
  ]);
  const isFile = (p) => fileSystem.has(p);

  const env = {
    PATH: "C:\\Program Files\\Git",
    ProgramFiles: "C:\\Program Files",
  };

  const found = discoverWindowsGitBash({
    platform: "win32",
    env,
    isFile,
  });

  assert.equal(found, null);
});

test("Git Bash discovery ignores relative PATH entries and strips outer quotes from absolute entries", () => {
  // 1. Relative paths are ignored, not cwd hijacked
  const fileSystemRelative = new Set([
    "./relative/bash.exe",
    "relative\\bash.exe",
    ".\\bash.exe",
    "bash.exe",
  ]);
  const foundRelative = discoverWindowsGitBash({
    platform: "win32",
    env: { PATH: ".;relative;.\\relative", ProgramFiles: "D:\\Empty" },
    isFile: (p) => fileSystemRelative.has(p),
  });
  assert.equal(foundRelative, null);

  // 2. Quoted absolute entry is unquoted and found
  const fileSystemQuoted = new Set([
    "C:\\Program Files\\Git\\bin\\bash.exe",
  ]);
  const foundQuoted = discoverWindowsGitBash({
    platform: "win32",
    env: { PATH: '"C:\\Program Files\\Git\\bin"' },
    isFile: (p) => fileSystemQuoted.has(p),
  });
  assert.equal(foundQuoted, "C:\\Program Files\\Git\\bin\\bash.exe");
});

test("prepareWindowsShellEnvironment unifies multiple PATH keys and preserves all non-duplicate original entries even without additions", () => {
  const env = {
    Path: "D:\\One;D:\\Two",
    PATH: "D:\\Two;D:\\Three",
  };

  const res = prepareWindowsShellEnvironment({
    platform: "win32",
    env,
    isFile: () => false,
  });

  const keys = Object.keys(res.env).filter((k) => k.toUpperCase() === "PATH");
  assert.equal(keys.length, 1);
  const entries = res.env[keys[0]].split(";");
  assert.ok(entries.length >= 3);
  assert.equal(entries[0], "D:\\One");
  assert.equal(entries[1], "D:\\Two");
  assert.equal(entries[2], "D:\\Three");
});

