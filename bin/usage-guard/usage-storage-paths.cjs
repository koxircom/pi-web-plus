"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const MARKER_FILE_NAME = ".pi-usage-storage.json";
const EXPECTED_MARKER_VERSION = 1;
const EXPECTED_MARKER_INSTANCE = "nas";

const REQUIRED_STORAGE_FILES = Object.freeze([
  "pi-usage-events-nas.json",
  "pi-usage-ledger-nas.json",
  "pi-usage-ledger.json",
  "pi-usage-frozen-history.json",
]);

const STORAGE_LOCK_FILES = Object.freeze({
  eventLock: "pi-usage-events-nas.json.lock",
  coordinatorLock: "pi-usage-sync.lock",
});

function resolveHomeDir() {
  return process.env.USERPROFILE || process.env.HOME || os.homedir();
}

function resolveAgentDir() {
  if (typeof process.env.PI_CODING_AGENT_DIR === "string" && process.env.PI_CODING_AGENT_DIR.trim()) {
    return path.resolve(process.env.PI_CODING_AGENT_DIR.trim());
  }
  return path.join(resolveHomeDir(), ".pi", "agent");
}

function resolveDefaultScriptsDir(defaultScriptsDir) {
  if (typeof defaultScriptsDir === "string" && defaultScriptsDir.trim()) {
    return path.resolve(defaultScriptsDir.trim());
  }
  return path.join(resolveAgentDir(), "scripts");
}

/**
 * 严格校验持久数据目录（fail closed）：
 * 1. 必须是绝对路径
 * 2. 目录必须已存在，且自身不能是符号链接
 * 3. 必须包含 .pi-usage-storage.json 标记文件，且为普通文件、非符号链接，内容匹配 { version: 1, instance: 'nas' }
 * 4. 必须已存在四个既有真实普通文件，且均非符号链接
 */
function validateUsageStorageDir(dirPath) {
  if (typeof dirPath !== "string" || !dirPath.trim()) {
    throw new Error("[usage-storage] PI_USAGE_DATA_DIR path cannot be empty");
  }

  const trimmed = dirPath.trim();
  if (!path.isAbsolute(trimmed)) {
    throw new Error(`[usage-storage] PI_USAGE_DATA_DIR must be an absolute path: '${trimmed}'`);
  }

  const normalized = path.resolve(trimmed);

  if (!fs.existsSync(normalized)) {
    throw new Error(`[usage-storage] PI_USAGE_DATA_DIR directory does not exist: '${normalized}'`);
  }

  const dirLstat = fs.lstatSync(normalized);
  if (dirLstat.isSymbolicLink()) {
    throw new Error(`[usage-storage] PI_USAGE_DATA_DIR directory cannot be a symbolic link: '${normalized}'`);
  }
  if (!dirLstat.isDirectory()) {
    throw new Error(`[usage-storage] PI_USAGE_DATA_DIR must be a directory: '${normalized}'`);
  }

  const realDir = fs.realpathSync(normalized);
  if (realDir !== normalized) {
    throw new Error(`[usage-storage] PI_USAGE_DATA_DIR path contains symbolic link ancestors: '${normalized}' -> '${realDir}'`);
  }

  const markerPath = path.join(normalized, MARKER_FILE_NAME);
  if (!fs.existsSync(markerPath)) {
    throw new Error(`[usage-storage] Storage marker missing: '${markerPath}'`);
  }

  const markerLstat = fs.lstatSync(markerPath);
  if (markerLstat.isSymbolicLink()) {
    throw new Error(`[usage-storage] Storage marker cannot be a symbolic link: '${markerPath}'`);
  }
  if (!markerLstat.isFile()) {
    throw new Error(`[usage-storage] Storage marker must be a regular file: '${markerPath}'`);
  }

  let marker;
  try {
    marker = JSON.parse(fs.readFileSync(markerPath, "utf8"));
  } catch (err) {
    throw new Error(`[usage-storage] Failed to parse storage marker JSON in '${markerPath}': ${err.message}`);
  }

  if (
    !marker ||
    typeof marker !== "object" ||
    marker.version !== EXPECTED_MARKER_VERSION ||
    marker.instance !== EXPECTED_MARKER_INSTANCE
  ) {
    throw new Error(
      `[usage-storage] Invalid storage marker in '${markerPath}': expected { version: ${EXPECTED_MARKER_VERSION}, instance: '${EXPECTED_MARKER_INSTANCE}' }, got ${JSON.stringify(marker)}`
    );
  }

  for (const fileName of REQUIRED_STORAGE_FILES) {
    const filePath = path.join(normalized, fileName);
    if (!fs.existsSync(filePath)) {
      throw new Error(`[usage-storage] Required storage file missing: '${filePath}'`);
    }
    const fileLstat = fs.lstatSync(filePath);
    if (fileLstat.isSymbolicLink()) {
      throw new Error(`[usage-storage] Required storage file cannot be a symbolic link: '${filePath}'`);
    }
    if (!fileLstat.isFile()) {
      throw new Error(`[usage-storage] Required storage file must be a regular file: '${filePath}'`);
    }
  }

  return true;
}

/**
 * 校验显式传入路径是否与统一配置目标一致，杜绝分叉（fail closed）
 */
function assertMatchingPath(explicitPath, targetPath, paramName = "path") {
  if (!explicitPath) return targetPath;
  const resExplicit = path.resolve(explicitPath);
  const resTarget = path.resolve(targetPath);
  if (resExplicit !== resTarget) {
    throw new Error(
      `[usage-storage] Explicit ${paramName} '${resExplicit}' conflicts with PI_USAGE_DATA_DIR target '${resTarget}'; refusing to fork storage path.`
    );
  }
  return resTarget;
}

/**
 * 解析 Usage 持久化存储环境
 * 未配置 PI_USAGE_DATA_DIR 或 source !== 'nas' 时平滑未启用
 * 配置且 source === 'nas' 时严格校验并返回解析出的各文件目标
 */
function resolveUsageStorage(options = {}) {
  const source = options.source || (process.platform === "win32" ? "windows" : "nas");
  const envDir = process.env.PI_USAGE_DATA_DIR;
  const hasEnv = typeof envDir === "string" && envDir.trim().length > 0;

  if (!hasEnv || source !== "nas") {
    return {
      enabled: false,
      source,
      dataDir: null,
    };
  }

  const trimmedDir = envDir.trim();
  validateUsageStorageDir(trimmedDir);
  const dataDir = path.resolve(trimmedDir);

  return {
    enabled: true,
    source: "nas",
    dataDir,
    eventsFile: path.join(dataDir, "pi-usage-events-nas.json"),
    ledgerNasFile: path.join(dataDir, "pi-usage-ledger-nas.json"),
    globalLedgerFile: path.join(dataDir, "pi-usage-ledger.json"),
    frozenHistoryFile: path.join(dataDir, "pi-usage-frozen-history.json"),
    coordinatorLockFile: path.join(dataDir, STORAGE_LOCK_FILES.coordinatorLock),
    eventLockFile: path.join(dataDir, STORAGE_LOCK_FILES.eventLock),
    markerFile: path.join(dataDir, MARKER_FILE_NAME),
  };
}

/**
 * 为 generateUsageLedger / delete guard / seal worker 提供统一路径解析
 */
function resolveUsagePathsForLedger(options = {}, defaultScriptsDir) {
  const source = options.source || (process.platform === "win32" ? "windows" : "nas");
  const storage = resolveUsageStorage({ source });
  const fallbackDir = resolveDefaultScriptsDir(defaultScriptsDir);

  if (!storage.enabled) {
    const stateFile = options.stateFile || path.join(fallbackDir, `pi-usage-events-${source}.json`);
    const outputFile = options.outputFile || path.join(fallbackDir, `pi-usage-ledger-${source}.json`);
    const lockFile = `${stateFile}.lock`;
    return {
      enabled: false,
      source,
      dataDir: null,
      stateFile,
      outputFile,
      lockFile,
    };
  }

  const stateFile = assertMatchingPath(options.stateFile, storage.eventsFile, "stateFile");
  const outputFile = assertMatchingPath(options.outputFile, storage.ledgerNasFile, "outputFile");
  const lockFile = storage.eventLockFile;

  return {
    enabled: true,
    source: "nas",
    dataDir: storage.dataDir,
    stateFile,
    outputFile,
    lockFile,
  };
}

/**
 * 为 syncGlobalLedger 提供统一路径解析
 */
function resolveUsagePathsForSync(options = {}, defaultDir = __dirname) {
  const storage = resolveUsageStorage({ source: "nas" });
  const dir = options.dir || defaultDir;

  if (!storage.enabled) {
    const frozenFile = options.frozenFile || path.join(dir, "pi-usage-frozen-history.json");
    const publicFile = options.publicFile || path.join(dir, "pi-usage-ledger.json");
    const lockFile = options.lockFile || path.join(dir, "pi-usage-sync.lock");
    return {
      enabled: false,
      dataDir: null,
      codeDir: dir,
      frozenFile,
      publicFile,
      lockFile,
      createCandidateDir: () => fs.mkdtempSync(path.join(os.tmpdir(), "pi-usage-sync-")),
    };
  }

  const frozenFile = assertMatchingPath(options.frozenFile, storage.frozenHistoryFile, "frozenFile");
  const publicFile = assertMatchingPath(options.publicFile, storage.globalLedgerFile, "publicFile");
  const lockFile = assertMatchingPath(options.lockFile, storage.coordinatorLockFile, "lockFile");

  return {
    enabled: true,
    dataDir: storage.dataDir,
    codeDir: dir,
    frozenFile,
    publicFile,
    lockFile,
    createCandidateDir: () => fs.mkdtempSync(path.join(storage.dataDir, ".pi-usage-sync-candidate-")),
  };
}

function isProcessAlive(pid) {
  if (!pid || typeof pid !== "number" || !Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === "EPERM";
  }
}

/**
 * 获取独占锁（带孤儿死锁自动识别与自愈）
 */
function acquireUsageLock(lockFile, options = {}) {
  const dir = path.dirname(lockFile);
  fs.mkdirSync(dir, { recursive: true });

  const timeoutMs = typeof options.timeoutMs === "number" ? options.timeoutMs : 5000;
  const retryIntervalMs = typeof options.retryIntervalMs === "number" ? options.retryIntervalMs : 150;
  const staleAgeMs = typeof options.staleAgeMs === "number" ? options.staleAgeMs : 60000;
  const extraData = options.extraData || {};

  const startTime = Date.now();

  while (true) {
    try {
      const fd = fs.openSync(lockFile, "wx", 0o600);
      try {
        const payload = JSON.stringify({
          pid: process.pid,
          time: Date.now(),
          startedAt: new Date().toISOString(),
          host: os.hostname(),
          ...extraData,
        });
        fs.writeFileSync(fd, payload, "utf8");
        fs.fsyncSync(fd);
      } catch (writeErr) {
        try { fs.closeSync(fd); } catch (_) {}
        try { fs.unlinkSync(lockFile); } catch (_) {}
        throw writeErr;
      }
      return fd;
    } catch (err) {
      if (err.code !== "EEXIST") {
        throw new Error(`[usage-lock] Failed to open lock ${lockFile}: ${err.message}`);
      }
    }

    try {
      let stat = null;
      try {
        stat = fs.statSync(lockFile);
      } catch (e) {
        if (e.code === "ENOENT") continue;
        throw e;
      }

      let parsed = null;
      try {
        parsed = JSON.parse(fs.readFileSync(lockFile, "utf8"));
      } catch (_) {}

      const now = Date.now();
      const lockTime = parsed?.time || (parsed?.startedAt ? Date.parse(parsed.startedAt) : null) || (stat ? stat.mtimeMs : now);
      const lockAgeMs = Math.max(0, now - lockTime);
      const lockPid = typeof parsed?.pid === "number" ? parsed.pid : null;

      const isDeadPid = lockPid && !isProcessAlive(lockPid) && lockAgeMs > 1500;
      const isOverdue = lockAgeMs > staleAgeMs;

      if (isDeadPid || isOverdue) {
        console.warn(`[usage-lock] Stale lock detected on ${lockFile} (pid: ${lockPid}, age: ${Math.round(lockAgeMs / 1000)}s, deadPid: ${Boolean(isDeadPid)}), recovering lock...`);
        try {
          fs.unlinkSync(lockFile);
        } catch (unlinkErr) {
          if (unlinkErr.code !== "ENOENT") throw unlinkErr;
        }
        continue;
      }
    } catch (_) {}

    const elapsed = Date.now() - startTime;
    if (elapsed >= timeoutMs) {
      throw new Error(`[usage-lock] Lock acquisition timed out (${Math.round(elapsed / 1000)}s) on ${lockFile}`);
    }

    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.min(retryIntervalMs, timeoutMs - elapsed));
  }
}

/**
 * 释放独占锁（安全校验只释放属于当前进程的锁）
 */
function releaseUsageLock(lockFile, fd = null) {
  if (fd !== null) {
    try { fs.closeSync(fd); } catch (_) {}
  }
  try {
    if (!fs.existsSync(lockFile)) return;
    try {
      const raw = fs.readFileSync(lockFile, "utf8");
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.pid === "number" && parsed.pid !== process.pid) {
        return;
      }
    } catch (_) {}
    fs.unlinkSync(lockFile);
  } catch (_) {}
}

module.exports = {
  MARKER_FILE_NAME,
  EXPECTED_MARKER_VERSION,
  EXPECTED_MARKER_INSTANCE,
  REQUIRED_STORAGE_FILES,
  STORAGE_LOCK_FILES,
  resolveHomeDir,
  resolveAgentDir,
  resolveDefaultScriptsDir,
  validateUsageStorageDir,
  assertMatchingPath,
  resolveUsageStorage,
  resolveUsagePathsForLedger,
  resolveUsagePathsForSync,
  isProcessAlive,
  acquireUsageLock,
  releaseUsageLock,
};
