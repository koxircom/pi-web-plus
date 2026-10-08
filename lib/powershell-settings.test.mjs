import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const {
  isPowerShellToolEnabled,
  readPowerShellToolEnabled,
  resolveDefaultToolEntries,
  resolveShellTools,
  writePowerShellToolEnabled,
} = await createJiti(import.meta.url).import("./powershell-settings.ts");

test("PowerShell is opt-in on Windows and never selected on other platforms", () => {
  assert.equal(isPowerShellToolEnabled(undefined, "win32"), false);
  assert.equal(isPowerShellToolEnabled(["read", "powershell"], "win32"), true);
  assert.equal(isPowerShellToolEnabled(["read", "bash", "powershell"], "win32"), false);
  assert.equal(isPowerShellToolEnabled(["read", "powershell"], "darwin"), false);
  assert.deepEqual(
    resolveShellTools(["read", "bash", "edit"], ["read", "powershell"], "win32"),
    ["read", "powershell", "edit"],
  );
  assert.deepEqual(
    resolveShellTools(["read", "bash", "edit"], ["read", "powershell"], "darwin"),
    ["read", "bash", "edit"],
  );
});

test("the setting preserves unrelated config and switches defaultTools both ways", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-web-powershell-"));
  const settingsPath = join(root, "settings.json");

  assert.equal(await readPowerShellToolEnabled(settingsPath, "win32"), false);
  await writePowerShellToolEnabled(true, settingsPath, "win32");
  assert.deepEqual(JSON.parse(await readFile(settingsPath, "utf8")), {
    defaultTools: ["read", "powershell", "edit", "write"],
  });

  const configured = JSON.parse(await readFile(settingsPath, "utf8"));
  configured.unrelated = { keep: true };
  await writeFile(settingsPath, JSON.stringify(configured));
  await writePowerShellToolEnabled(false, settingsPath, "win32");
  assert.deepEqual(JSON.parse(await readFile(settingsPath, "utf8")), {
    defaultTools: ["read", "bash", "edit", "write"],
    unrelated: { keep: true },
  });
});

test("enabling PowerShell adds it when a custom defaultTools list has no shell", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-web-powershell-custom-"));
  const settingsPath = join(root, "settings.json");
  await writeFile(settingsPath, JSON.stringify({ defaultTools: ["read", "grep"] }));

  await writePowerShellToolEnabled(true, settingsPath, "win32");
  assert.deepEqual(
    JSON.parse(await readFile(settingsPath, "utf8")).defaultTools,
    ["read", "grep", "powershell"],
  );
});

test("defaultTools entries resolve like pi's +name / -name modifiers", () => {
  assert.deepEqual(resolveDefaultToolEntries([]), []);
  assert.deepEqual(resolveDefaultToolEntries(["read", "grep"]), ["read", "grep"]);
  assert.deepEqual(resolveDefaultToolEntries(["+codemode"]), ["read", "bash", "edit", "write", "codemode"]);
  assert.deepEqual(resolveDefaultToolEntries(["-bash", "+powershell"]), ["read", "edit", "write", "powershell"]);
  assert.deepEqual(resolveDefaultToolEntries(["read", "+grep", "-read"]), ["grep"]);
});

test("the PowerShell switch reads and rewrites a modifier-only defaultTools list", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-web-powershell-modifiers-"));
  const settingsPath = join(root, "settings.json");
  await writeFile(settingsPath, JSON.stringify({ defaultTools: ["-bash", "+powershell"] }));
  assert.equal(await readPowerShellToolEnabled(settingsPath, "win32"), true);

  await writeFile(settingsPath, JSON.stringify({ defaultTools: ["+codemode"] }));
  assert.equal(await readPowerShellToolEnabled(settingsPath, "win32"), false);
  await writePowerShellToolEnabled(true, settingsPath, "win32");
  assert.deepEqual(
    JSON.parse(await readFile(settingsPath, "utf8")).defaultTools,
    ["read", "powershell", "edit", "write", "codemode"],
  );
});

test("invalid defaultTools are rejected without overwriting the settings file", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-web-powershell-invalid-"));
  const settingsPath = join(root, "settings.json");
  const original = JSON.stringify({ defaultTools: "bash", unrelated: true });
  await writeFile(settingsPath, original);

  await assert.rejects(
    writePowerShellToolEnabled(true, settingsPath, "win32"),
    /defaultTools must be an array of strings/,
  );
  assert.equal(await readFile(settingsPath, "utf8"), original);
});

test("fresh install defaultTools without explicit choice falls back: nativeBash > nativePowerShell", () => {
  // Fresh install (undefined defaultTools):
  // 1. Both available: prefers nativeBash (isPowerShell = false)
  assert.equal(
    isPowerShellToolEnabled(undefined, {
      platform: "win32",
      availability: { hasBash: true, hasPowerShell: true },
    }),
    false,
  );

  // 2. No Git Bash, but PowerShell available: falls back to PowerShell
  assert.equal(
    isPowerShellToolEnabled(undefined, {
      platform: "win32",
      availability: { hasBash: false, hasPowerShell: true },
    }),
    true,
  );

  // 3. Both missing: false
  assert.equal(
    isPowerShellToolEnabled(undefined, {
      platform: "win32",
      availability: { hasBash: false, hasPowerShell: false },
    }),
    false,
  );

  // Explicit ['bash'] is NEVER converted to PowerShell even when Bash missing
  assert.equal(
    isPowerShellToolEnabled(["read", "bash", "edit", "write"], {
      platform: "win32",
      availability: { hasBash: false, hasPowerShell: true },
    }),
    false,
  );

  // Explicit ['powershell'] is NEVER converted to bash even when Bash is available
  assert.equal(
    isPowerShellToolEnabled(["read", "powershell", "edit", "write"], {
      platform: "win32",
      availability: { hasBash: true, hasPowerShell: true },
    }),
    true,
  );

  // Explicit shellPath overrides fallback
  assert.equal(
    isPowerShellToolEnabled(undefined, {
      platform: "win32",
      shellPath: "C:\\Program Files\\PowerShell\\7\\pwsh.exe",
      availability: { hasBash: true, hasPowerShell: true },
    }),
    false,
  );
  assert.equal(
    isPowerShellToolEnabled(undefined, {
      platform: "win32",
      shellPath: "C:\\Program Files\\Git\\bin\\bash.exe",
      availability: { hasBash: false, hasPowerShell: true },
    }),
    false,
  );

  // Modifier-only ['+codemode'] does not drop read/edit/write and selects PowerShell when only PS is available
  const resolved = resolveShellTools(
    ["read", "bash", "edit", "write", "codemode"],
    ["+codemode"],
    {
      platform: "win32",
      availability: { hasBash: false, hasPowerShell: true },
    },
  );
  assert.deepEqual(resolved, ["read", "powershell", "edit", "write", "codemode"]);

  // Empty [] (Chat only / readonly) never adds a shell tool
  const emptyResolved = resolveShellTools([], [], {
    platform: "win32",
    availability: { hasBash: false, hasPowerShell: true },
  });
  assert.deepEqual(emptyResolved, []);

  // Linux/darwin never select PowerShell even if injected
  assert.equal(
    isPowerShellToolEnabled(undefined, {
      platform: "linux",
      availability: { hasBash: false, hasPowerShell: true },
    }),
    false,
  );
});

test("readPowerShellToolEnabled returns actual default value while write preserves original semantics", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-web-powershell-probe-"));
  const settingsPath = join(root, "settings.json");
  // Fresh install with empty settings file:
  await writeFile(settingsPath, JSON.stringify({}));

  // With only PowerShell available, read reflects the actual fallback default
  const readVal = await readPowerShellToolEnabled(settingsPath, {
    platform: "win32",
    availability: { hasBash: false, hasPowerShell: true },
  });
  assert.equal(readVal, true);

  // The settings file was NOT written/polluted by reading
  assert.deepEqual(JSON.parse(await readFile(settingsPath, "utf8")), {});

  const explicitSettings = { shellPath: "D:\\Custom Shell\\pwsh.exe", unrelated: true };
  await writeFile(settingsPath, JSON.stringify(explicitSettings));
  assert.equal(await readPowerShellToolEnabled(settingsPath, {
    platform: "win32",
    availability: { hasBash: false, hasPowerShell: true },
  }), false, "Global shellPath must not be silently discarded by the displayed default");
  assert.deepEqual(JSON.parse(await readFile(settingsPath, "utf8")), explicitSettings);
});

test("isPowerShellToolEnabled respects exact resolution and prevents unintended PowerShell fallback", () => {
  // 1. ['-bash'] removes bash, must NOT enable PowerShell
  assert.equal(
    isPowerShellToolEnabled(["-bash"], {
      platform: "win32",
      availability: { hasBash: false, hasPowerShell: true },
    }),
    false,
  );

  // 2. ['+powershell', '-powershell'] resolves to no PowerShell, must NOT enable PowerShell
  assert.equal(
    isPowerShellToolEnabled(["+powershell", "-powershell"], {
      platform: "win32",
      availability: { hasBash: false, hasPowerShell: true },
    }),
    false,
  );

  // 3. ['bash', 'powershell'] both present: Bash priority, must NOT downgrade to PowerShell
  assert.equal(
    isPowerShellToolEnabled(["bash", "powershell"], {
      platform: "win32",
      availability: { hasBash: false, hasPowerShell: true },
    }),
    false,
  );

  // 4. plain readonly ['read']: no shell, must NOT enable PowerShell
  assert.equal(
    isPowerShellToolEnabled(["read"], {
      platform: "win32",
      availability: { hasBash: false, hasPowerShell: true },
    }),
    false,
  );

  // 5. Explicit shellPath (e.g. D:\Tools\custom.exe) blocks silent fallback to PowerShell
  assert.equal(
    isPowerShellToolEnabled(undefined, {
      platform: "win32",
      shellPath: "D:\\Tools\\custom.exe",
      availability: { hasBash: false, hasPowerShell: true },
    }),
    false,
  );
});

