#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const DEFAULT_STATE_FILE = "/root/.pi/agent/state/pi-web-enhancement-locks.json";
const DEFAULT_MODULES_DIR = "/root/.pi/agent/scripts/enhancements/modules";
const DEFAULT_PRIMARY_BUNDLE_PATH = "/root/.pi/agent/scripts/pi-web-enhancements.js";
const STANDALONE_EDITION = "koxir-standalone-1.0.0";
const STANDALONE_VERSION = "1.0.0";
const UNCOMPLETED_TAG_NAME = "Pi未完成";
const UNCOMPLETED_TAG_COLOR = "#facc15";
const MAX_NOTE_LENGTH = 280;
const MAX_STORED_MESSAGES = 200;
const MAX_STORED_SESSION_NAMES = 500;
const LOCK_HANDOFF_RECOVERY_PROMPT = [
  "请先审查已有任务上下文、最新文件内容和当前锁状态，再继续原任务。",
  "不得重放原始写入、覆盖其他会话的新改动或越过任何确认边界；完成后请主动释放本模块锁。",
].join(" ");

const MODULE_SPECS = [
  {
    index: 1,
    key: "module:01",
    id: "01-bootstrap-and-core-state",
    file: "01-bootstrap-and-core-state.js",
  },
  {
    index: 2,
    key: "module:02",
    id: "02-plugin-registry-and-settings-schema",
    file: "02-plugin-registry-and-settings-schema.js",
  },
  {
    index: 3,
    key: "module:03",
    id: "03-session-cache-and-sync-engine",
    file: "03-session-cache-and-sync-engine.js",
  },
  {
    index: 4,
    key: "module:04",
    id: "04-sidebar-and-session-management",
    file: "04-sidebar-and-session-management.js",
  },
  {
    index: 5,
    key: "module:05",
    id: "05-composer-and-input-workflow",
    file: "05-composer-and-input-workflow.js",
  },
  {
    index: 6,
    key: "module:06",
    id: "06-chat-view-and-tool-cards",
    file: "06-chat-view-and-tool-cards.js",
  },
  {
    index: 7,
    key: "module:07",
    id: "07-kernel-scheduler-and-observers",
    file: "07-kernel-scheduler-and-observers.js",
  },
  {
    index: 8,
    key: "module:08",
    id: "08-settings-panels-and-lifecycle",
    file: "08-settings-panels-and-lifecycle.js",
  },
];

const MODULE_BY_KEY = new Map(MODULE_SPECS.map((spec) => [spec.key, spec]));
const MODULE_BY_FILE = new Map(MODULE_SPECS.map((spec) => [spec.file, spec]));
const MODULE_BY_ID = new Map(MODULE_SPECS.map((spec) => [spec.id, spec]));

function sha256Hex(input) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function sleepSync(ms) {
  const duration = Math.max(1, Math.min(1000, Math.trunc(Number(ms) || 10)));
  try {
    const sab = new SharedArrayBuffer(4);
    const view = new Int32Array(sab);
    Atomics.wait(view, 0, 0, duration);
  } catch {
    const deadline = Date.now() + duration;
    while (Date.now() < deadline) {
      // fallback busy wait if SharedArrayBuffer is unavailable
    }
  }
}

function sanitizeMetadataText(value, fallback = "") {
  if (typeof value !== "string") return fallback;
  const cleaned = value
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return fallback;
  return [...cleaned].slice(0, MAX_NOTE_LENGTH).join("");
}

function normalizeSessionName(value, sessionId) {
  const name = sanitizeMetadataText(value, "");
  const looksLikeSessionId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(name);
  return name && name !== sessionId && !looksLikeSessionId ? name : "";
}

function sessionDisplayName(state, sessionId, fallbackName) {
  return (
    normalizeSessionName(state?.sessionNames?.[sessionId], sessionId) ||
    normalizeSessionName(fallbackName, sessionId) ||
    "未命名会话（标题尚未生成）"
  );
}

function rememberSessionNameInState(state, sessionId, value, nowIso, markDirty) {
  const name = normalizeSessionName(value, sessionId);
  if (!sessionId || !name) return false;

  let changed = false;
  if (!state.sessionNames || typeof state.sessionNames !== "object" || Array.isArray(state.sessionNames)) {
    state.sessionNames = {};
  }
  if (state.sessionNames[sessionId] !== name) {
    state.sessionNames[sessionId] = name;
    changed = true;
  }
  const update = (record, key) => {
    if (record && record[key] !== name) {
      record[key] = name;
      changed = true;
    }
  };
  if (state.globalBuildLock?.ownerSessionId === sessionId) {
    update(state.globalBuildLock, "ownerSessionName");
  }
  for (const lock of Object.values(state.moduleLocks || {})) {
    if (!lock) continue;
    if (lock.ownerSessionId === sessionId) update(lock, "ownerSessionName");
    for (const request of lock.requests || []) {
      if (request?.fromSessionId === sessionId) update(request, "fromSessionName");
      if (request?.toSessionId === sessionId) update(request, "toSessionName");
      if (request?.grantedFromSessionId === sessionId) update(request, "grantedFromSessionName");
      if (request?.grantedToSessionId === sessionId) update(request, "grantedToSessionName");
    }
  }
  for (const message of state.messages || []) {
    if (!message) continue;
    if (message.fromSessionId === sessionId) update(message, "fromSessionName");
    if (message.toSessionId === sessionId) update(message, "toSessionName");
    if (message.ownerSessionId === sessionId) update(message, "ownerSessionName");
    if (message.handoffToSessionId === sessionId) update(message, "handoffToSessionName");
  }
  while (Object.keys(state.sessionNames).length > MAX_STORED_SESSION_NAMES) {
    const oldestSessionId = Object.keys(state.sessionNames).find((knownId) => knownId !== sessionId);
    if (!oldestSessionId) break;
    delete state.sessionNames[oldestSessionId];
    changed = true;
  }
  if (changed) markDirty();
  return changed;
}

let cachedStateStoreModule = null;
function getStateStoreModule() {
  if (!cachedStateStoreModule) {
    try {
      cachedStateStoreModule = require("./pi-enhancement-state-store.cjs");
    } catch {
      try {
        cachedStateStoreModule = require("/root/.pi/agent/scripts/pi-enhancement-state-store.cjs");
      } catch {}
    }
  }
  return cachedStateStoreModule;
}

function resolveAgentDir(options = {}) {
  if (typeof options.agentDir === "string" && options.agentDir.trim()) {
    return options.agentDir.trim();
  }
  const stateFile = resolveStateFile(options);
  return path.dirname(path.dirname(stateFile));
}

function ensureUncompletedTagDefinition(options = {}) {
  try {
    const sMod = getStateStoreModule();
    if (!sMod || typeof sMod.createStateStore !== "function") return null;
    const agentDir = resolveAgentDir(options);
    const store = sMod.createStateStore({ agentDir });
    const { state } = store.read();
    if (!state || !Array.isArray(state.sessionTagsDefinitions)) {
      return null;
    }
    const trimmedTarget = UNCOMPLETED_TAG_NAME.trim().toLowerCase();
    const existing = state.sessionTagsDefinitions.find(
      (t) => t && typeof t.name === "string" && t.name.trim().toLowerCase() === trimmedTarget
    );
    if (existing) {
      return existing;
    }

    const newTagId = `tag_${Date.now().toString(36)}_${crypto.randomBytes(3).toString("hex")}`;
    const newTagDef = {
      id: newTagId,
      name: UNCOMPLETED_TAG_NAME,
      color: UNCOMPLETED_TAG_COLOR,
      createdAt: Date.now(),
    };
    store.commit([
      {
        opId: `tag_create_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`,
        type: "tag_create",
        tag: newTagDef,
      },
    ]);
    return newTagDef;
  } catch (err) {
    console.error("[pi-web-enhancement-locks] ensureUncompletedTagDefinition failed:", err && err.message ? err.message : err);
    return null;
  }
}

function syncModelsJsonSessionTag(agentDir, sessionId, tagDef, isAdd) {
  try {
    const modelsPath = path.join(agentDir, "models.json");
    if (!fs.existsSync(modelsPath)) return;
    const content = fs.readFileSync(modelsPath, "utf8");
    const json = JSON.parse(content);
    if (!json || typeof json !== "object") return;
    let modified = false;

    if (Array.isArray(json.sessionTagsDefinitions)) {
      const hasDef = json.sessionTagsDefinitions.some((t) => t && t.id === tagDef.id);
      if (!hasDef) {
        json.sessionTagsDefinitions.push({
          id: tagDef.id,
          name: tagDef.name,
          color: tagDef.color,
          createdAt: tagDef.createdAt || Date.now(),
        });
        modified = true;
      }
    }

    if (json.sessionTagMappings && typeof json.sessionTagMappings === "object" && !Array.isArray(json.sessionTagMappings)) {
      const currentList = Array.isArray(json.sessionTagMappings[sessionId])
        ? [...json.sessionTagMappings[sessionId]]
        : [];
      if (isAdd) {
        if (!currentList.includes(tagDef.id)) {
          currentList.push(tagDef.id);
          json.sessionTagMappings[sessionId] = currentList;
          json.sessionTagsRevision = Date.now();
          modified = true;
        }
      } else {
        if (currentList.includes(tagDef.id)) {
          const filtered = currentList.filter((id) => id !== tagDef.id);
          if (filtered.length === 0) {
            delete json.sessionTagMappings[sessionId];
          } else {
            json.sessionTagMappings[sessionId] = filtered;
          }
          json.sessionTagsRevision = Date.now();
          modified = true;
        }
      }
    }

    if (modified) {
      fs.writeFileSync(modelsPath, JSON.stringify(json, null, 2), "utf8");
    }
  } catch {}
}

function setSessionUncompletedTag(sessionId, isUncompleted, options = {}) {
  const sid = typeof sessionId === "string" ? sessionId.trim() : "";
  if (!sid) return Promise.resolve(false);

  try {
    const tagDef = ensureUncompletedTagDefinition(options);
    if (!tagDef || !tagDef.id) return Promise.resolve(false);

    const sMod = getStateStoreModule();
    if (!sMod || typeof sMod.createStateStore !== "function") return Promise.resolve(false);
    const agentDir = resolveAgentDir(options);
    const store = sMod.createStateStore({ agentDir });
    const { state } = store.read();
    if (!state || !state.sessionTagMappings || typeof state.sessionTagMappings !== "object") {
      return Promise.resolve(false);
    }

    const currentList = Array.isArray(state.sessionTagMappings[sid])
      ? state.sessionTagMappings[sid]
      : [];
    const hasTag = currentList.includes(tagDef.id);

    if (isUncompleted && !hasTag) {
      if (options.canonicalOnly !== true) syncModelsJsonSessionTag(agentDir, sid, tagDef, true);
      return store
        .commit([
          {
            opId: `session_tag_add_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`,
            type: "session_tag_add",
            sessionId: sid,
            tagId: tagDef.id,
          },
        ])
        .then(
          () => true,
          (err) => {
            console.error("[pi-web-enhancement-locks] session_tag_add commit error:", err && err.message ? err.message : err);
            return false;
          }
        );
    }

    if (!isUncompleted && hasTag) {
      if (options.canonicalOnly !== true) syncModelsJsonSessionTag(agentDir, sid, tagDef, false);
      return store
        .commit([
          {
            opId: `session_tag_remove_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`,
            type: "session_tag_remove",
            sessionId: sid,
            tagId: tagDef.id,
          },
        ])
        .then(
          () => true,
          (err) => {
            console.error("[pi-web-enhancement-locks] session_tag_remove commit error:", err && err.message ? err.message : err);
            return false;
          }
        );
    }

    return Promise.resolve(false);
  } catch (err) {
    console.error("[pi-web-enhancement-locks] setSessionUncompletedTag error:", err && err.message ? err.message : err);
    return Promise.resolve(false);
  }
}

function checkSessionHasPendingLockRequests(sessionId, options = {}) {
  const sid = typeof sessionId === "string" ? sessionId.trim() : "";
  if (!sid) return false;

  try {
    const stateFile = resolveStateFile(options);
    if (!fs.existsSync(stateFile)) return false;
    const raw = fs.readFileSync(stateFile, "utf8");
    const state = JSON.parse(raw);
    if (!state || typeof state !== "object" || !state.moduleLocks) return false;

    for (const lock of Object.values(state.moduleLocks)) {
      if (!lock || !Array.isArray(lock.requests)) continue;
      for (const req of lock.requests) {
        if (req && req.fromSessionId === sid && req.status === "pending") {
          return true;
        }
      }
    }
    return false;
  } catch {
    return false;
  }
}

function checkSessionHoldsAnyModuleLocks(sessionId, options = {}) {
  const sid = typeof sessionId === "string" ? sessionId.trim() : "";
  if (!sid) return false;

  try {
    const stateFile = resolveStateFile(options);
    if (!fs.existsSync(stateFile)) return false;
    const raw = fs.readFileSync(stateFile, "utf8");
    const state = JSON.parse(raw);
    if (!state || typeof state !== "object" || !state.moduleLocks) return false;

    for (const lock of Object.values(state.moduleLocks)) {
      if (lock && lock.ownerSessionId === sid) {
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

function decorateRequestWithSessionNames(request, state) {
  if (!request) return request;
  const decorated = structuredClone(request);
  if (decorated.fromSessionId) {
    decorated.fromSessionName = sessionDisplayName(state, decorated.fromSessionId, decorated.fromSessionName);
  }
  if (decorated.toSessionId) {
    decorated.toSessionName = sessionDisplayName(state, decorated.toSessionId, decorated.toSessionName);
  }
  if (decorated.grantedFromSessionId) {
    decorated.grantedFromSessionName = sessionDisplayName(
      state,
      decorated.grantedFromSessionId,
      decorated.grantedFromSessionName
    );
  }
  if (decorated.grantedToSessionId) {
    decorated.grantedToSessionName = sessionDisplayName(
      state,
      decorated.grantedToSessionId,
      decorated.grantedToSessionName
    );
  }
  return decorated;
}

function decorateLockWithSessionNames(lock, state) {
  if (!lock) return lock;
  const decorated = structuredClone(lock);
  if (decorated.ownerSessionId) {
    decorated.ownerSessionName = sessionDisplayName(state, decorated.ownerSessionId, decorated.ownerSessionName);
  }
  if (Array.isArray(decorated.requests)) {
    decorated.requests = decorated.requests.map((request) => decorateRequestWithSessionNames(request, state));
  }
  return decorated;
}

function decorateMessageWithSessionNames(message, state) {
  if (!message) return message;
  const decorated = structuredClone(message);
  for (const [idKey, nameKey] of [
    ["fromSessionId", "fromSessionName"],
    ["toSessionId", "toSessionName"],
    ["ownerSessionId", "ownerSessionName"],
    ["handoffToSessionId", "handoffToSessionName"],
  ]) {
    if (decorated[idKey]) {
      decorated[nameKey] = sessionDisplayName(state, decorated[idKey], decorated[nameKey]);
    }
  }
  decorated.summary = formatLockMessageSummary(decorated, state);
  return decorated;
}

function formatLockMessageSummary(message, state) {
  const moduleLabel = `\`${message.moduleKey}\` (${message.moduleFile})`;
  const fromName = sessionDisplayName(state, message.fromSessionId, message.fromSessionName);
  const toName = sessionDisplayName(state, message.toSessionId, message.toSessionName);
  const version = message.version || STANDALONE_VERSION;

  if (message.type === "lock_request") {
    return [
      `### 🔒 [协作锁请求]`,
      ``,
      `- **目标模块**：${moduleLabel}`,
      `- **申请会话**：「${fromName}」`,
      `- **当前持有**：「${toName}」`,
      `- **版本规范**：v${version}`,
    ].join("\n");
  }

  if (message.type === "lock_granted") {
    const previousOwnerDesc = message.fromSessionId ? `「${fromName}」` : "系统等待队列";
    return [
      `### 🤝 [协作锁接力]`,
      ``,
      `- **获得模块**：${moduleLabel}`,
      `- **交接来源**：${previousOwnerDesc}`,
      `- **接力会话**：「${toName}」`,
      `- **分配机制**：FIFO 自动排队交接`,
      `- **完成闭环**：继续原任务；实际部署与验收完成后，以 release + taskCompleted=true 清除【Pi未完成】。拿锁或回合结束不代表任务完成。`,
    ].join("\n");
  }

  if (message.type === "lock_reply") {
    if (message.handoffToSessionId) {
      const handoffName = sessionDisplayName(state, message.handoffToSessionId, message.handoffToSessionName);
      const queueStatus = message.requestStillQueued
        ? "你仍在队列中，轮到你时将自动唤醒。"
        : "本次请求不在等待队列中。";
      return [
        `### 💬 [协作锁回复]`,
        ``,
        `- **目标模块**：${moduleLabel}`,
        `- **转交状态**：已按 FIFO 转交给「${handoffName}」`,
        `- **队列状态**：${queueStatus}`,
      ].join("\n");
    }

    const decisionLabel = message.released
      ? "已释放锁"
      : message.decision === "accepted" || message.decision === "accept"
        ? "已接受"
        : message.decision === "rejected" || message.decision === "reject"
          ? "已拒绝"
          : "已回复";
    return [
      `### 💬 [协作锁回复]`,
      ``,
      `- **目标模块**：${moduleLabel}`,
      `- **回复会话**：「${fromName}」`,
      `- **决策结果**：\`${decisionLabel}\``,
    ].join("\n");
  }

  return message.summary || "";
}

function defaultIsPidAlive(pid) {
  const num = Number(pid);
  if (!Number.isInteger(num) || num <= 0) return false;
  try {
    process.kill(num, 0);
    return true;
  } catch (err) {
    if (err && err.code === "EPERM") return true;
    return false;
  }
}

function resolveStateFile(options = {}) {
  const raw =
    options.stateFile ||
    process.env.PI_ENHANCEMENT_LOCKS_FILE ||
    DEFAULT_STATE_FILE;
  return path.resolve(String(raw));
}

function resolveModulesDir(options = {}) {
  const raw =
    options.modulesDir ||
    process.env.PI_ENHANCEMENT_MODULES_DIR ||
    DEFAULT_MODULES_DIR;
  return path.resolve(String(raw));
}

function normalizeModuleKey(input) {
  if (input === undefined || input === null) return null;
  if (typeof input === "number" && Number.isInteger(input) && input >= 1 && input <= 8) {
    return `module:0${input}`;
  }
  const raw = String(input).trim();
  if (!raw) return null;

  if (MODULE_BY_KEY.has(raw)) return raw;
  if (MODULE_BY_FILE.has(raw)) return MODULE_BY_FILE.get(raw).key;
  if (MODULE_BY_ID.has(raw)) return MODULE_BY_ID.get(raw).key;

  const base = path.basename(raw.replace(/\\/g, "/"));
  if (MODULE_BY_FILE.has(base)) return MODULE_BY_FILE.get(base).key;
  if (MODULE_BY_ID.has(base)) return MODULE_BY_ID.get(base).key;

  const match =
    /^(?:module\s*[:_-]?\s*)?0?([1-8])$/i.exec(raw) ||
    /^0([1-8])-[a-z0-9-]+(?:\.js)?$/i.exec(base);
  if (match) {
    return `module:0${match[1]}`;
  }
  return null;
}

function getModuleSpec(input) {
  const key = normalizeModuleKey(input);
  return key ? MODULE_BY_KEY.get(key) || null : null;
}

function resolveModuleFromFilePath(filePath, options = {}) {
  if (typeof filePath !== "string" || !filePath.trim()) return null;
  const cwd = options.cwd ? path.resolve(String(options.cwd)) : process.cwd();
  const modulesDir = resolveModulesDir(options);
  const normalizedInput = filePath.trim().replace(/\\/g, "/");
  const resolvedPath = path.resolve(cwd, normalizedInput);
  const resolvedDir = path.dirname(resolvedPath);

  if (resolvedDir !== modulesDir) {
    return null;
  }
  const baseName = path.basename(resolvedPath);
  const spec = MODULE_BY_FILE.get(baseName);
  if (!spec) return null;

  return {
    moduleKey: spec.key,
    spec,
    filePath: resolvedPath,
  };
}

function computeModuleSha256(moduleKeyOrSpec, options = {}) {
  const spec =
    typeof moduleKeyOrSpec === "object" && moduleKeyOrSpec && moduleKeyOrSpec.file
      ? moduleKeyOrSpec
      : getModuleSpec(moduleKeyOrSpec);
  if (!spec) {
    throw new Error(`Invalid enhancement module identifier: ${String(moduleKeyOrSpec)}`);
  }
  const modulesDir = resolveModulesDir(options);
  const filePath = path.join(modulesDir, spec.file);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return sha256Hex(fs.readFileSync(filePath));
}

function createInitialState(nowIso = new Date().toISOString()) {
  return {
    schemaVersion: 1,
    edition: STANDALONE_EDITION,
    version: STANDALONE_VERSION,
    updatedAt: nowIso,
    globalBuildLock: null,
    moduleLocks: {},
    messages: [],
    sessionNames: {},
  };
}

function validateAndNormalizeState(parsed, stateFile) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    const err = new Error(`Invalid lock state structure in ${stateFile}: root must be an object`);
    err.code = "ENHANCEMENT_LOCK_STATE_CORRUPT";
    throw err;
  }
  if (parsed.schemaVersion !== 1) {
    const err = new Error(
      `Unsupported lock state schemaVersion in ${stateFile}: ${String(parsed.schemaVersion)}`
    );
    err.code = "ENHANCEMENT_LOCK_STATE_CORRUPT";
    throw err;
  }
  if (
    typeof parsed.moduleLocks !== "object" ||
    parsed.moduleLocks === null ||
    Array.isArray(parsed.moduleLocks)
  ) {
    const err = new Error(`Invalid moduleLocks in ${stateFile}`);
    err.code = "ENHANCEMENT_LOCK_STATE_CORRUPT";
    throw err;
  }
  if (!Array.isArray(parsed.messages)) {
    const err = new Error(`Invalid messages array in ${stateFile}`);
    err.code = "ENHANCEMENT_LOCK_STATE_CORRUPT";
    throw err;
  }
  // SemVer invariant: always keep 1.0.0 without auto-bumping
  parsed.edition = STANDALONE_EDITION;
  parsed.version = STANDALONE_VERSION;
  if (parsed.globalBuildLock === undefined) {
    parsed.globalBuildLock = null;
  }
  if (!parsed.sessionNames || typeof parsed.sessionNames !== "object" || Array.isArray(parsed.sessionNames)) {
    parsed.sessionNames = {};
  }
  return parsed;
}

function readStateFromDisk(stateFile) {
  if (!fs.existsSync(stateFile)) {
    return createInitialState();
  }
  let raw;
  try {
    raw = fs.readFileSync(stateFile, "utf8");
  } catch (readErr) {
    const err = new Error(`Failed to read lock state file ${stateFile}: ${readErr.message}`);
    err.code = "ENHANCEMENT_LOCK_STATE_READ_ERROR";
    throw err;
  }
  if (!raw || !raw.trim()) {
    const err = new Error(`Corrupted (empty) lock state file: ${stateFile}`);
    err.code = "ENHANCEMENT_LOCK_STATE_CORRUPT";
    throw err;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (parseErr) {
    const err = new Error(`Corrupted JSON in lock state file ${stateFile}: ${parseErr.message}`);
    err.code = "ENHANCEMENT_LOCK_STATE_CORRUPT";
    throw err;
  }
  return validateAndNormalizeState(parsed, stateFile);
}

function writeStateToDiskAtomic(stateFile, state) {
  const dir = path.dirname(stateFile);
  fs.mkdirSync(dir, { recursive: true });
  state.edition = STANDALONE_EDITION;
  state.version = STANDALONE_VERSION;
  state.updatedAt = new Date().toISOString();
  if (Array.isArray(state.messages) && state.messages.length > MAX_STORED_MESSAGES) {
    state.messages = state.messages.slice(-MAX_STORED_MESSAGES);
  }

  const tmpFile = `${stateFile}.${process.pid}.${Date.now()}.${crypto.randomBytes(6).toString("hex")}.tmp`;
  const payload = JSON.stringify(state, null, 2) + "\n";
  try {
    fs.writeFileSync(tmpFile, payload, { encoding: "utf8", mode: 0o600 });
    fs.renameSync(tmpFile, stateFile);
  } catch (err) {
    try {
      if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
    } catch {}
    throw err;
  }
}

// Reentrant tracking per stateFile within the same process
const activeProcessMutexes = new Set();

function withStateMutex(options, callback) {
  const stateFile = resolveStateFile(options);
  const mutexFile = `${stateFile}.mutex`;
  const isPidAlive = typeof options.isPidAlive === "function" ? options.isPidAlive : defaultIsPidAlive;
  const mutexTimeoutMs = Number.isFinite(options.mutexTimeoutMs) ? Number(options.mutexTimeoutMs) : 5000;
  const retryIntervalMs = Number.isFinite(options.mutexRetryMs) ? Number(options.mutexRetryMs) : 15;

  const isReentrant = activeProcessMutexes.has(mutexFile);
  let fd = null;
  const mutexToken = `${process.pid}:${Date.now()}:${crypto.randomBytes(4).toString("hex")}`;

  if (!isReentrant) {
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    const deadline = Date.now() + Math.max(50, mutexTimeoutMs);

    while (true) {
      try {
        fd = fs.openSync(mutexFile, "wx", 0o600);
        const mutexPayload = JSON.stringify({
          pid: process.pid,
          token: mutexToken,
          createdAt: new Date().toISOString(),
        });
        fs.writeFileSync(fd, mutexPayload, "utf8");
        break;
      } catch (err) {
        if (!err || err.code !== "EEXIST") {
          throw new Error(`Failed to create lock mutex ${mutexFile}: ${err ? err.message : String(err)}`);
        }
        // Check if existing mutex belongs to a confirmed-dead process
        let canBreakStaleMutex = false;
        try {
          const rawMutex = fs.readFileSync(mutexFile, "utf8").trim();
          if (rawMutex) {
            const parsedMutex = JSON.parse(rawMutex);
            if (Number.isInteger(parsedMutex.pid) && !isPidAlive(parsedMutex.pid)) {
              canBreakStaleMutex = true;
            }
          }
        } catch {
          // Could be mid-write or already removed; wait and retry
        }

        if (canBreakStaleMutex) {
          try {
            fs.unlinkSync(mutexFile);
            continue;
          } catch {}
        }

        if (Date.now() >= deadline) {
          const timeoutErr = new Error(
            `Timed out waiting (${mutexTimeoutMs}ms) for exclusive state mutex ${mutexFile}`
          );
          timeoutErr.code = "ENHANCEMENT_LOCK_MUTEX_TIMEOUT";
          throw timeoutErr;
        }
        sleepSync(retryIntervalMs);
      }
    }
    activeProcessMutexes.add(mutexFile);
  }

  try {
    const state = readStateFromDisk(stateFile);
    const nowIso = new Date().toISOString();
    const pruned = pruneDeadProcessLocks(state, { isPidAlive, nowIso, options });
    let shouldWrite = pruned.changed;

    const markDirty = () => {
      shouldWrite = true;
    };

    const result = callback(state, { markDirty, nowIso, stateFile, pruned, isPidAlive });
    if (shouldWrite) {
      writeStateToDiskAtomic(stateFile, state);
    }
    return result;
  } finally {
    if (!isReentrant) {
      activeProcessMutexes.delete(mutexFile);
      if (fd !== null) {
        try {
          fs.closeSync(fd);
        } catch {}
      }
      try {
        if (fs.existsSync(mutexFile)) {
          const currentRaw = fs.readFileSync(mutexFile, "utf8").trim();
          if (!currentRaw || currentRaw.includes(mutexToken)) {
            fs.unlinkSync(mutexFile);
          }
        }
      } catch {}
    }
  }
}

/** Check a queued requester's process without treating uncertain liveness as death. */
function rememberSessionName(options = {}) {
  const sessionId = typeof options.sessionId === "string" ? options.sessionId.trim() : "";
  const sessionName = normalizeSessionName(options.sessionName, sessionId);
  if (!sessionId || !sessionName) return { updated: false };

  return withStateMutex(options, (state, { markDirty, nowIso }) => ({
    updated: rememberSessionNameInState(state, sessionId, sessionName, nowIso, markDirty),
    sessionName,
  }));
}

function isRequesterProcessAlive(request, isPidAlive) {
  const pid = Number(request && request.fromPid);
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    return Boolean(isPidAlive(pid));
  } catch {
    // An inability to prove death is not permission to skip a requester.
    return true;
  }
}

/**
 * Promote exactly one FIFO requester while the caller already owns state mutex.
 * Pending requests whose PID is confirmed dead are marked skipped and never notified.
 */
function promoteNextLiveModuleRequester(state, moduleKey, lock, { isPidAlive, nowIso }) {
  if (!lock || !Array.isArray(lock.requests)) {
    return { changed: false, handedOff: false, request: null };
  }

  let changed = false;
  let nextRequest = null;
  for (const request of lock.requests) {
    if (!request || request.status !== "pending" || !request.fromSessionId) continue;
    if (!isRequesterProcessAlive(request, isPidAlive)) {
      request.status = "skipped";
      request.skipReason = "requester_pid_dead";
      request.updatedAt = nowIso;
      changed = true;
      continue;
    }
    nextRequest = request;
    break;
  }

  if (!nextRequest) {
    return { changed, handedOff: false, request: null };
  }

  const previousOwnerSessionId = lock.ownerSessionId;
  nextRequest.status = "granted";
  nextRequest.grantedAt = nowIso;
  nextRequest.grantedFromSessionId = previousOwnerSessionId || null;
  nextRequest.grantedToSessionId = nextRequest.fromSessionId;
  nextRequest.updatedAt = nowIso;
  lock.ownerSessionId = nextRequest.fromSessionId;
  lock.ownerSessionName = sessionDisplayName(state, nextRequest.fromSessionId, nextRequest.fromSessionName);
  lock.ownerPid = Number(nextRequest.fromPid);
  lock.acquiredAt = nowIso;
  lock.updatedAt = nowIso;

  const moduleFile = lock.moduleFile || getModuleSpec(moduleKey)?.file || moduleKey;
  state.messages.push({
    messageId: `msg-${crypto.randomUUID()}`,
    type: "lock_granted",
    moduleKey,
    moduleFile,
    requestId: nextRequest.requestId || null,
    fromSessionId: previousOwnerSessionId || null,
    toSessionId: nextRequest.fromSessionId,
    ownerSessionId: nextRequest.fromSessionId,
    ownerPid: Number(nextRequest.fromPid),
    version: STANDALONE_VERSION,
    edition: STANDALONE_EDITION,
    summary: "",
    status: "granted",
    createdAt: nowIso,
    deliveredAt: null,
  });
  state.messages[state.messages.length - 1].summary = formatLockMessageSummary(
    state.messages[state.messages.length - 1],
    state
  );

  return { changed: true, handedOff: true, request: nextRequest };
}

/**
 * Clean up locks ONLY when the owner process or session is confirmed to have exited.
 * Never expire a lock held by an actively running process/session based on arbitrary TTL.
 */
function pruneDeadProcessLocks(state, { isPidAlive, nowIso }) {
  let changed = false;
  const expiredModuleLocks = [];

  if (state.globalBuildLock && typeof state.globalBuildLock === "object") {
    const buildOwnerPid = state.globalBuildLock.ownerPid;
    if (!isPidAlive(buildOwnerPid)) {
      state.globalBuildLock = null;
      changed = true;
    }
  }

  if (state.moduleLocks && typeof state.moduleLocks === "object") {
    for (const [moduleKey, lock] of Object.entries(state.moduleLocks)) {
      if (!lock || typeof lock !== "object") {
        delete state.moduleLocks[moduleKey];
        changed = true;
        continue;
      }
      const isDead = !isPidAlive(lock.ownerPid);
      if (isDead) {
        const handoff = promoteNextLiveModuleRequester(state, moduleKey, lock, {
          isPidAlive,
          nowIso,
        });
        if (handoff.changed) changed = true;
        if (handoff.handedOff) {
          expiredModuleLocks.push({ lock, handoff });
        } else {
          expiredModuleLocks.push(lock);
          delete state.moduleLocks[moduleKey];
          changed = true;
        }
      }
    }
  }

  return { changed, expiredModuleLocks };
}

function formatConflictReason({ moduleKey, lock, request, globalBuildLock, sessionId }) {
  if (globalBuildLock) {
    const ownerLabel = globalBuildLock.ownerSessionId
      ? globalBuildLock.ownerSessionName || "未命名会话（标题尚未生成）"
      : "CLI";
    const isSameSession = Boolean(
      sessionId &&
        globalBuildLock.ownerSessionId &&
        globalBuildLock.ownerSessionId === sessionId
    );
    const holderRelation = isSameSession
      ? "当前会话自身持有全局构建锁（非其他会话锁住）"
      : globalBuildLock.ownerSessionId
        ? `其他会话「${ownerLabel}」持有全局构建锁`
        : "CLI 进程持有全局构建锁";
    return [
      `❌ 【Pi Web 增强全局构建锁占用 (global_build_locked)】`,
      `- 目标模块: ${moduleKey}`,
      `- 当前状态: 全局构建/静态部署正在进行中 (${globalBuildLock.operation || "build"})，持有期间禁止获取模块锁或修改模块文件`,
      `- 锁类型说明: 当前为全局构建/部署锁（${holderRelation}），并非模块锁，因此不会登记模块协商请求 (module request)`,
      `- 全局构建持锁会话: ${isSameSession ? "当前会话" : `「${ownerLabel}」`}`,
      `- 全局构建持锁进程 (ownerPid): ${globalBuildLock.ownerPid}`,
      `- 发行版与版本: ${globalBuildLock.edition || STANDALONE_EDITION} (v${globalBuildLock.version || STANDALONE_VERSION})`,
      `- 请等待当前构建/静态部署完成后再修改模块，或使用 pi_web_enhancement_lock (action="status") 查看状态。`,
    ].join("\n");
  }

  const lines = [
    `❌ 【Pi Web 增强模块跨会话协作锁拦截】`,
    `- 目标模块: ${moduleKey} (${lock.moduleFile})`,
    `- 持有者会话: 「${lock.ownerSessionName || "未命名会话（标题尚未生成）"}」`,
    `- 持有者进程 (ownerPid): ${lock.ownerPid}`,
    `- 发行版与版本: ${lock.edition || STANDALONE_EDITION} (v${lock.version || STANDALONE_VERSION})`,
    `- 基线 SHA256: ${lock.baselineSha256 || "unknown"}`,
    `- 当前 SHA256: ${lock.currentSha256 || lock.baselineSha256 || "unknown"}`,
    `- 加锁时间: ${lock.acquiredAt}`,
  ];
  if (request) {
    lines.push(
      `- 已自动登记协商请求: requestId=${request.requestId}（申请会话：「${request.fromSessionName || "未命名会话（标题尚未生成）"}」）`
    );
  }
  lines.push(
    ``,
    `🛠️ 【协作锁工具 pi_web_enhancement_lock 用法】：`,
    `- 查看锁状态: pi_web_enhancement_lock({ action: "status", module: "${moduleKey}" })`,
    `- 申请获取锁: pi_web_enhancement_lock({ action: "acquire", module: "${moduleKey}", message: "修改原因说明" })`,
    `- 发送协商请求: pi_web_enhancement_lock({ action: "request", module: "${moduleKey}", message: "请求协作或让出锁说明" })`,
    `- 锁主人回复请求: pi_web_enhancement_lock({ action: "reply", module: "${moduleKey}", requestId: "${request?.requestId || "<requestId>"}", decision: "accept" | "reject" | "release", release: true, message: "回复说明" })`,
    `- 已入队会话无需反复提交写入；释放锁后系统将按 FIFO 自动交接并唤醒下一会话，请先检查新文件再继续原任务。`,
    `- 释放本会话锁: pi_web_enhancement_lock({ action: "release", module: "${moduleKey}" }) 或 ({ action: "release", releaseAll: true })`
  );
  return lines.join("\n");
}

function acquireModuleLock(options = {}) {
  const sessionId = typeof options.sessionId === "string" ? options.sessionId.trim() : "";
  if (!sessionId) {
    const err = new Error("Valid sessionId is required to acquire a Pi Web enhancement module lock");
    err.code = "ENHANCEMENT_LOCK_MISSING_SESSION";
    throw err;
  }

  let spec = null;
  if (options.moduleKey || options.module) {
    spec = getModuleSpec(options.moduleKey || options.module);
  } else if (options.filePath) {
    const resolved = resolveModuleFromFilePath(options.filePath, options);
    spec = resolved ? resolved.spec : null;
  }

  if (!spec) {
    const err = new Error(
      `Invalid or unsupported enhancement module target: ${String(options.moduleKey || options.module || options.filePath)}`
    );
    err.code = "ENHANCEMENT_LOCK_INVALID_MODULE";
    throw err;
  }

  const moduleKey = spec.key;
  const pid = Number.isInteger(options.pid) && options.pid > 0 ? options.pid : process.pid;
  const sessionName = normalizeSessionName(options.sessionName, sessionId);
  const note = sanitizeMetadataText(options.note || options.message || "");
  const requestReason = sanitizeMetadataText(
    options.requestReason || options.message || options.note || "请求编辑该增强模块"
  );
  const autoRequest = options.autoRequest !== false;
  const providedOpToken =
    typeof options.operationToken === "string" && options.operationToken.trim()
      ? options.operationToken.trim()
      : null;
  const fileSha = computeModuleSha256(spec, options);

  const res = withStateMutex(options, (state, { markDirty, nowIso }) => {
    if (sessionName) rememberSessionNameInState(state, sessionId, sessionName, nowIso, markDirty);
    // Block any normal module lock acquisition (without matching operationToken) while a live global build/deploy lock is held, even for the same sessionId
    if (
      state.globalBuildLock &&
      (!providedOpToken || state.globalBuildLock.operationToken !== providedOpToken)
    ) {
      return {
        acquired: false,
        conflict: true,
        reasonCode: "global_build_locked",
        moduleKey,
        globalBuildLock: {
          ...structuredClone(state.globalBuildLock),
          ownerSessionName: state.globalBuildLock.ownerSessionId
            ? sessionDisplayName(state, state.globalBuildLock.ownerSessionId, state.globalBuildLock.ownerSessionName)
            : null,
        },
        reason: formatConflictReason({
          moduleKey,
          sessionId,
          globalBuildLock: {
            ...state.globalBuildLock,
            ownerSessionName: state.globalBuildLock.ownerSessionId
              ? sessionDisplayName(state, state.globalBuildLock.ownerSessionId, state.globalBuildLock.ownerSessionName)
              : null,
          },
        }),
      };
    }

    const existing = state.moduleLocks[moduleKey];

    // Case 1: Held by another live session
    if (existing && existing.ownerSessionId !== sessionId) {
      if (fileSha && existing.currentSha256 !== fileSha) {
        existing.currentSha256 = fileSha;
        markDirty();
      }

      let requestRecord = null;
      if (autoRequest) {
        if (!Array.isArray(existing.requests)) {
          existing.requests = [];
        }
        const existingPending = existing.requests.find(
          (r) => r && r.fromSessionId === sessionId && r.status === "pending"
        );
        if (existingPending) {
          existingPending.fromPid = pid;
          existingPending.fromSessionName = sessionDisplayName(state, sessionId, sessionName);
          existingPending.toSessionName = sessionDisplayName(state, existing.ownerSessionId, existing.ownerSessionName);
          existingPending.reason = requestReason;
          existingPending.updatedAt = nowIso;
          requestRecord = existingPending;
        } else {
          requestRecord = {
            requestId: `req-${crypto.randomUUID()}`,
            moduleKey,
            moduleFile: spec.file,
            fromSessionId: sessionId,
            fromSessionName: sessionDisplayName(state, sessionId, sessionName),
            fromPid: pid,
            toSessionId: existing.ownerSessionId,
            toSessionName: sessionDisplayName(state, existing.ownerSessionId, existing.ownerSessionName),
            reason: requestReason,
            status: "pending",
            createdAt: nowIso,
            updatedAt: nowIso,
          };
          existing.requests.push(requestRecord);
        }

        const msgEntry = {
          messageId: `msg-${crypto.randomUUID()}`,
          type: "lock_request",
          moduleKey,
          moduleFile: spec.file,
          requestId: requestRecord.requestId,
          fromSessionId: sessionId,
          fromSessionName: sessionDisplayName(state, sessionId, sessionName),
          toSessionId: existing.ownerSessionId,
          toSessionName: sessionDisplayName(state, existing.ownerSessionId, existing.ownerSessionName),
          version: STANDALONE_VERSION,
          edition: STANDALONE_EDITION,
          reason: requestReason,
          summary: "",
          status: "pending",
          createdAt: nowIso,
          deliveredAt: null,
        };
        msgEntry.summary = formatLockMessageSummary(msgEntry, state);
        state.messages.push(msgEntry);
        existing.updatedAt = nowIso;
        markDirty();
      }

      const clonedLock = structuredClone(existing);
      clonedLock.ownerSessionName = sessionDisplayName(state, existing.ownerSessionId, existing.ownerSessionName);
      const clonedReq = requestRecord ? structuredClone(requestRecord) : null;
      return {
        acquired: false,
        conflict: true,
        reasonCode: "module_locked_by_other_session",
        moduleKey,
        lock: clonedLock,
        request: clonedReq,
        reason: formatConflictReason({
          moduleKey,
          lock: clonedLock,
          request: clonedReq,
        }),
      };
    }

    // Case 2: Already held by the same session (reentrant)
    if (existing && existing.ownerSessionId === sessionId) {
      existing.ownerPid = pid;
      existing.version = STANDALONE_VERSION;
      existing.edition = STANDALONE_EDITION;
      if (fileSha) {
        existing.currentSha256 = fileSha;
      }
      if (note) {
        existing.note = note;
      }
      existing.updatedAt = nowIso;
      markDirty();
      return {
        acquired: true,
        reentrant: true,
        conflict: false,
        moduleKey,
        lock: structuredClone(existing),
      };
    }

    // Case 3: Unlocked -> acquire fresh lock
    const newLock = {
      moduleKey,
      moduleFile: spec.file,
      ownerSessionId: sessionId,
      ownerSessionName: sessionDisplayName(state, sessionId, sessionName),
      ownerPid: pid,
      edition: STANDALONE_EDITION,
      version: STANDALONE_VERSION,
      baselineSha256: fileSha,
      currentSha256: fileSha,
      acquiredAt: nowIso,
      updatedAt: nowIso,
      note,
      requests: [],
    };
    state.moduleLocks[moduleKey] = newLock;
    markDirty();

    return {
      acquired: true,
      reentrant: false,
      conflict: false,
      moduleKey,
      lock: structuredClone(newLock),
    };
  });

  if (!res.acquired && autoRequest) {
    try {
      setSessionUncompletedTag(sessionId, true, options);
    } catch (tagErr) {
      console.error("[acquireModuleLock setSessionUncompletedTag error]:", tagErr);
    }
  }
  return res;
}

function requestModuleLock(options = {}) {
  const sessionId = typeof options.sessionId === "string" ? options.sessionId.trim() : "";
  if (!sessionId) {
    throw new Error("Valid sessionId is required to request a module lock");
  }
  const spec = getModuleSpec(options.moduleKey || options.module || options.filePath);
  if (!spec) {
    throw new Error(`Invalid enhancement module: ${String(options.moduleKey || options.module)}`);
  }
  const moduleKey = spec.key;
  const pid = Number.isInteger(options.pid) && options.pid > 0 ? options.pid : process.pid;
  const sessionName = normalizeSessionName(options.sessionName, sessionId);
  const reason = sanitizeMetadataText(
    options.message || options.reason || options.note || "请求协商释放该模块锁"
  );

  const res = withStateMutex(options, (state, { markDirty, nowIso }) => {
    if (sessionName) rememberSessionNameInState(state, sessionId, sessionName, nowIso, markDirty);
    const existing = state.moduleLocks[moduleKey];
    if (!existing) {
      return {
        requested: false,
        idle: true,
        ownedBySelf: false,
        moduleKey,
        lock: null,
        summary: `模块 ${moduleKey} (${spec.file}) 当前未被任何会话锁定，可直接调用 acquire 获取。`,
      };
    }
    if (existing.ownerSessionId === sessionId) {
      return {
        requested: false,
        idle: false,
        ownedBySelf: true,
        moduleKey,
        lock: structuredClone(existing),
        summary: `模块 ${moduleKey} (${spec.file}) 已由当前会话「${sessionDisplayName(state, sessionId, sessionName)}」持有，无需重复请求。`,
      };
    }

    if (!Array.isArray(existing.requests)) {
      existing.requests = [];
    }
    let requestRecord = existing.requests.find(
      (r) => r && r.fromSessionId === sessionId && r.status === "pending"
    );
    if (requestRecord) {
      requestRecord.fromPid = pid;
      requestRecord.fromSessionName = sessionDisplayName(state, sessionId, sessionName);
      requestRecord.toSessionName = sessionDisplayName(state, existing.ownerSessionId, existing.ownerSessionName);
      requestRecord.reason = reason;
      requestRecord.updatedAt = nowIso;
    } else {
      requestRecord = {
        requestId: `req-${crypto.randomUUID()}`,
        moduleKey,
        moduleFile: spec.file,
        fromSessionId: sessionId,
        fromSessionName: sessionDisplayName(state, sessionId, sessionName),
        fromPid: pid,
        toSessionId: existing.ownerSessionId,
        toSessionName: sessionDisplayName(state, existing.ownerSessionId, existing.ownerSessionName),
        reason,
        status: "pending",
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      existing.requests.push(requestRecord);
    }

    const messageEntry = {
      messageId: `msg-${crypto.randomUUID()}`,
      type: "lock_request",
      moduleKey,
      moduleFile: spec.file,
      requestId: requestRecord.requestId,
      fromSessionId: sessionId,
      fromSessionName: sessionDisplayName(state, sessionId, sessionName),
      toSessionId: existing.ownerSessionId,
      toSessionName: sessionDisplayName(state, existing.ownerSessionId, existing.ownerSessionName),
      version: STANDALONE_VERSION,
      edition: STANDALONE_EDITION,
      reason,
      summary: "",
      status: "pending",
      createdAt: nowIso,
      deliveredAt: null,
    };
    messageEntry.summary = formatLockMessageSummary(messageEntry, state);
    state.messages.push(messageEntry);
    existing.updatedAt = nowIso;
    markDirty();

    return {
      requested: true,
      idle: false,
      ownedBySelf: false,
      moduleKey,
      lock: structuredClone(existing),
      request: structuredClone(requestRecord),
      messageEntry: structuredClone(messageEntry),
      summary: `已向模块 ${moduleKey} 持有者「${sessionDisplayName(state, existing.ownerSessionId, existing.ownerSessionName)}」发送协商请求 (requestId=${requestRecord.requestId})。`,
    };
  });

  if (res && res.requested) {
    try {
      setSessionUncompletedTag(sessionId, true, options);
    } catch {}
  }
  return res;
}

function replyModuleLockRequest(options = {}) {
  const sessionId = typeof options.sessionId === "string" ? options.sessionId.trim() : "";
  if (!sessionId) {
    throw new Error("Valid sessionId is required to reply to a module lock request");
  }
  const sessionName = normalizeSessionName(options.sessionName, sessionId);

  const res = withStateMutex(options, (state, { markDirty, nowIso, isPidAlive }) => {
    if (sessionName) rememberSessionNameInState(state, sessionId, sessionName, nowIso, markDirty);
    let spec = null;
    if (options.moduleKey || options.module) {
      spec = getModuleSpec(options.moduleKey || options.module);
    } else if (options.requestId) {
      for (const lock of Object.values(state.moduleLocks)) {
        if (
          lock &&
          Array.isArray(lock.requests) &&
          lock.requests.some((r) => r && r.requestId === options.requestId)
        ) {
          spec = getModuleSpec(lock.moduleKey);
          break;
        }
      }
    }

    if (!spec) {
      throw new Error(
        `Unable to resolve target module for reply (module=${String(options.moduleKey || options.module || "")}, requestId=${String(options.requestId || "")})`
      );
    }

    const moduleKey = spec.key;
    const existing = state.moduleLocks[moduleKey];
    if (!existing) {
      return {
        replied: false,
        released: false,
        moduleKey,
        error: `模块 ${moduleKey} 当前未被锁定，无法回复请求。`,
      };
    }

    if (existing.ownerSessionId !== sessionId) {
      return {
        replied: false,
        released: false,
        moduleKey,
        lock: structuredClone(existing),
        error: `只有模块 ${moduleKey} 的持有者「${sessionDisplayName(state, existing.ownerSessionId, existing.ownerSessionName)}」才能回复或释放该锁。`,
      };
    }

    const requests = Array.isArray(existing.requests) ? existing.requests : [];
    let targetReq = null;
    if (options.requestId) {
      targetReq = requests.find((r) => r && r.requestId === options.requestId) || null;
    } else if (options.toSessionId) {
      targetReq =
        requests.find(
          (r) => r && r.fromSessionId === options.toSessionId && r.status === "pending"
        ) ||
        requests.find((r) => r && r.fromSessionId === options.toSessionId) ||
        null;
    } else {
      targetReq =
        requests.find((r) => r && r.status === "pending") ||
        [...requests].reverse()[0] ||
        null;
    }

    const targetSessionId =
      (targetReq && targetReq.fromSessionId) ||
      (typeof options.toSessionId === "string" ? options.toSessionId.trim() : "");
    if (!targetSessionId) {
      return {
        replied: false,
        released: false,
        moduleKey,
        lock: structuredClone(existing),
        error: `模块 ${moduleKey} 没有找到待回复的请求记录，请指定 requestId 或 toSessionId。`,
      };
    }

    const rawDecision = String(options.decision || (options.release ? "release" : "info")).toLowerCase();
    const shouldRelease = Boolean(options.release || rawDecision === "release");
    const statusLabel = shouldRelease
      ? "released"
      : rawDecision === "accept" || rawDecision === "accepted"
        ? "accepted"
        : rawDecision === "reject" || rawDecision === "rejected"
          ? "rejected"
          : "replied";
    const replyText = sanitizeMetadataText(
      options.message ||
        options.note ||
        (shouldRelease
          ? "锁持有者已同意并释放该模块锁"
          : statusLabel === "rejected"
            ? "锁持有者拒绝本次请求；如仍需修改请重新申请"
            : "锁持有者已收到协商请求")
    );

    if (targetReq) {
      // Acknowledgement/acceptance is not completion: keep the requester in
      // the FIFO until a grant, an explicit rejection, or its own shutdown.
      if (targetReq.status !== "pending" || statusLabel === "rejected") {
        targetReq.status = statusLabel;
      }
      targetReq.replyMessage = replyText;
      targetReq.repliedAt = nowIso;
      targetReq.updatedAt = nowIso;
    }

    const messageEntry = {
      messageId: `msg-${crypto.randomUUID()}`,
      type: "lock_reply",
      moduleKey,
      moduleFile: spec.file,
      requestId: targetReq ? targetReq.requestId : null,
      fromSessionId: sessionId,
      fromSessionName: sessionDisplayName(state, sessionId, sessionName),
      toSessionId: targetSessionId,
      toSessionName: sessionDisplayName(state, targetSessionId, targetReq?.fromSessionName),
      version: STANDALONE_VERSION,
      edition: STANDALONE_EDITION,
      decision: statusLabel,
      released: shouldRelease,
      replyText,
      summary: "",
      status: statusLabel,
      createdAt: nowIso,
      deliveredAt: null,
    };
    state.messages.push(messageEntry);

    let handoff = { changed: false, handedOff: false, request: null };
    if (shouldRelease) {
      handoff = promoteNextLiveModuleRequester(state, moduleKey, existing, {
        isPidAlive,
        nowIso,
      });
      if (!handoff.handedOff) {
        delete state.moduleLocks[moduleKey];
      } else if (handoff.request.fromSessionId !== targetSessionId) {
        messageEntry.handoffToSessionId = handoff.request.fromSessionId;
        messageEntry.handoffToSessionName = sessionDisplayName(
          state,
          handoff.request.fromSessionId,
          handoff.request.fromSessionName
        );
        messageEntry.requestStillQueued = targetReq?.status === "pending";
      }
    } else {
      existing.updatedAt = nowIso;
    }

    messageEntry.summary = formatLockMessageSummary(messageEntry, state);
    markDirty();
    return {
      replied: true,
      released: shouldRelease,
      moduleKey,
      toSessionId: targetSessionId,
      toSessionName: sessionDisplayName(state, targetSessionId, targetReq?.fromSessionName),
      request: targetReq ? structuredClone(targetReq) : null,
      messageEntry: structuredClone(messageEntry),
      handoff: handoff.handedOff
        ? {
            toSessionId: handoff.request.fromSessionId,
            requestId: handoff.request.requestId || null,
          }
        : null,
      lock: state.moduleLocks[moduleKey] ? structuredClone(state.moduleLocks[moduleKey]) : null,
    };
  });

  return res;
}

function releaseModuleLock(options = {}) {
  const sessionId = typeof options.sessionId === "string" ? options.sessionId.trim() : "";
  if (!sessionId) {
    return {
      released: true,
      noop: true,
      releasedModules: [],
      notifiedSessions: [],
    };
  }

  const releaseAll = Boolean(options.releaseAll || (!options.moduleKey && !options.module && !options.filePath));
  const note = sanitizeMetadataText(options.note || options.message || "会话主动释放模块锁");

  const res = withStateMutex(options, (state, { markDirty, nowIso, isPidAlive }) => {
    const releasedModules = [];
    const notifiedSessions = [];

    // Pi Web sessions can share one server PID. A closed waiting session must
    // leave the FIFO even though its process remains alive for other sessions.
    if (options.cancelRequests === true) {
      for (const lock of Object.values(state.moduleLocks)) {
        if (!lock || !Array.isArray(lock.requests)) continue;
        for (const req of lock.requests) {
          if (req && req.fromSessionId === sessionId && req.status === "pending") {
            req.status = "cancelled";
            req.updatedAt = nowIso;
            markDirty();
          }
        }
      }
    }

    if (releaseAll) {
      for (const [moduleKey, lock] of Object.entries(state.moduleLocks)) {
        if (lock && lock.ownerSessionId === sessionId) {
          const handoff = promoteNextLiveModuleRequester(state, moduleKey, lock, {
            isPidAlive,
            nowIso,
          });
          if (!handoff.handedOff) {
            delete state.moduleLocks[moduleKey];
          } else {
            notifiedSessions.push(handoff.request.fromSessionId);
          }
          releasedModules.push(moduleKey);
          markDirty();
        }
      }
      return {
        released: true,
        noop: releasedModules.length === 0,
        releasedModules,
        notifiedSessions,
      };
    }

    const spec = getModuleSpec(options.moduleKey || options.module || options.filePath);
    if (!spec) {
      throw new Error(`Invalid enhancement module: ${String(options.moduleKey || options.module)}`);
    }
    const moduleKey = spec.key;
    const existing = state.moduleLocks[moduleKey];

    if (!existing) {
      return {
        released: true,
        noop: true,
        releasedModules: [],
        notifiedSessions: [],
      };
    }

    if (existing.ownerSessionId !== sessionId) {
      return {
        released: false,
        conflict: true,
        moduleKey,
        lock: structuredClone(existing),
        error: `模块 ${moduleKey} 当前由「${sessionDisplayName(state, existing.ownerSessionId, existing.ownerSessionName)}」持有，当前会话无权越权释放。`,
      };
    }

    const handoff = promoteNextLiveModuleRequester(state, moduleKey, existing, {
      isPidAlive,
      nowIso,
    });
    if (handoff.handedOff) {
      notifiedSessions.push(handoff.request.fromSessionId);
    } else {
      delete state.moduleLocks[moduleKey];
    }
    releasedModules.push(moduleKey);
    markDirty();

    return {
      released: true,
      noop: false,
      releasedModules,
      notifiedSessions,
    };
  });

  return res;
}

/**
 * Cancel pending lock requests and undelivered granted requests/messages for a session.
 * Does NOT release actively held locks (does not mutate state.moduleLocks ownership).
 * Does NOT affect other sessions.
 * Returns { cancelledCount, cancelledRequests, cancelledMessages }
 */
function cancelSessionLockRequests(options = {}) {
  const sessionId = typeof options.sessionId === "string" ? options.sessionId.trim() : "";
  const emptyResult = { cancelledCount: 0, cancelledRequests: 0, cancelledMessages: 0 };
  if (!sessionId || !fs.existsSync(resolveStateFile(options))) return emptyResult;

  return withStateMutex(options, (state, { markDirty, nowIso }) => {
    let cancelledRequests = 0;
    let cancelledMessages = 0;
    const undeliveredRequestIds = new Set();

    // 1. Mark unacknowledged lock_granted messages for this session as cancelled
    if (Array.isArray(state.messages)) {
      for (const msg of state.messages) {
        if (!msg || msg.type !== "lock_granted") continue;
        const targetSid = (msg.toSessionId || msg.ownerSessionId || "").trim();
        if (targetSid === sessionId && !msg.deliveredAt && msg.status !== "cancelled") {
          msg.status = "cancelled";
          msg.updatedAt = nowIso;
          if (msg.requestId) {
            undeliveredRequestIds.add(msg.requestId);
          }
          cancelledMessages++;
          markDirty();
        }
      }
    }

    // 2. Mark pending requests and undelivered granted requests for this session as cancelled
    if (state.moduleLocks && typeof state.moduleLocks === "object") {
      for (const lock of Object.values(state.moduleLocks)) {
        if (!lock || !Array.isArray(lock.requests)) continue;
        for (const req of lock.requests) {
          if (!req || req.fromSessionId !== sessionId) continue;
          if (req.status === "pending") {
            req.status = "cancelled";
            req.updatedAt = nowIso;
            cancelledRequests++;
            markDirty();
          } else if (req.status === "granted" && undeliveredRequestIds.has(req.requestId)) {
            req.status = "cancelled";
            req.updatedAt = nowIso;
            cancelledRequests++;
            markDirty();
          }
        }
      }
    }

    const cancelledCount = cancelledRequests + cancelledMessages;
    return {
      cancelledCount,
      cancelledRequests,
      cancelledMessages,
    };
  });
}

function refreshOwnedModuleHashes(options = {}) {
  const sessionId = typeof options.sessionId === "string" ? options.sessionId.trim() : "";
  if (!sessionId) return { updated: [] };

  return withStateMutex(options, (state, { markDirty, nowIso }) => {
    const updated = [];
    for (const [moduleKey, lock] of Object.entries(state.moduleLocks)) {
      if (lock && lock.ownerSessionId === sessionId) {
        const latestSha = computeModuleSha256(moduleKey, options);
        if (latestSha && latestSha !== lock.currentSha256) {
          lock.currentSha256 = latestSha;
          lock.updatedAt = nowIso;
          if (options.advanceBaseline === true) {
            lock.baselineSha256 = latestSha;
          }
          updated.push(moduleKey);
          markDirty();
        } else if (latestSha && options.advanceBaseline === true && lock.baselineSha256 !== latestSha) {
          lock.baselineSha256 = latestSha;
          lock.updatedAt = nowIso;
          updated.push(moduleKey);
          markDirty();
        }
      }
    }
    return { updated };
  });
}

function peekSessionMessages(options = {}) {
  const sessionId = typeof options.sessionId === "string" ? options.sessionId.trim() : "";
  if (!sessionId) return [];

  try {
    const stateFile = resolveStateFile(options);
    if (!fs.existsSync(stateFile)) return [];
    const raw = fs.readFileSync(stateFile, "utf8");
    if (!raw.includes(sessionId)) return [];
    const state = JSON.parse(raw);
    if (!Array.isArray(state.messages) || !state.messages.some((m) => m && m.toSessionId === sessionId && !m.deliveredAt)) {
      return [];
    }
    const pending = [];
    for (const msg of state.messages) {
      if (msg && msg.toSessionId === sessionId && !msg.deliveredAt) {
        pending.push(decorateMessageWithSessionNames(msg, state));
      }
    }
    return pending;
  } catch {
    return [];
  }
}

function ackSessionMessages(options = {}) {
  const sessionId = typeof options.sessionId === "string" ? options.sessionId.trim() : "";
  if (!sessionId) return { ackedMessageIds: [] };

  const rawIds = options.messageIds ?? options.messageId;
  const messageIdList = Array.isArray(rawIds)
    ? rawIds
    : typeof rawIds === "string" && rawIds.trim()
      ? [rawIds.trim()]
      : [];
  if (messageIdList.length === 0) return { ackedMessageIds: [] };

  const targetIds = new Set(messageIdList.map((id) => String(id).trim()).filter(Boolean));
  if (targetIds.size === 0) return { ackedMessageIds: [] };

  try {
    const stateFile = resolveStateFile(options);
    if (!fs.existsSync(stateFile)) return { ackedMessageIds: [] };
    const raw = fs.readFileSync(stateFile, "utf8");
    if (!raw.includes(sessionId)) return { ackedMessageIds: [] };
  } catch {
    return { ackedMessageIds: [] };
  }

  return withStateMutex(options, (state, { markDirty, nowIso }) => {
    const acked = [];
    if (!Array.isArray(state.messages)) {
      return { ackedMessageIds: [] };
    }

    for (const msg of state.messages) {
      if (
        msg &&
        msg.toSessionId === sessionId &&
        !msg.deliveredAt &&
        msg.messageId &&
        targetIds.has(String(msg.messageId).trim())
      ) {
        msg.deliveredAt = nowIso;
        acked.push(msg.messageId);
      }
    }

    if (acked.length > 0) {
      markDirty();
    }
    return { ackedMessageIds: acked };
  });
}

function consumeSessionMessages(options = {}) {
  const sessionId = typeof options.sessionId === "string" ? options.sessionId.trim() : "";
  if (!sessionId) return [];

  // 只读预检短路：若状态文件不存在或根本没有属于当前会话的未投递消息，直接返回，绝对不获取写锁与写磁盘！
  try {
    const stateFile = resolveStateFile(options);
    if (!fs.existsSync(stateFile)) return [];
    const raw = fs.readFileSync(stateFile, "utf8");
    if (!raw.includes(sessionId)) return [];
    const state = JSON.parse(raw);
    if (!Array.isArray(state.messages) || !state.messages.some(m => m && m.toSessionId === sessionId && !m.deliveredAt)) {
      return [];
    }
  } catch {
    return [];
  }

  return withStateMutex(options, (state, { markDirty, nowIso }) => {
    const delivered = [];
    for (const msg of state.messages) {
      if (msg && msg.toSessionId === sessionId && !msg.deliveredAt) {
        msg.deliveredAt = nowIso;
        delivered.push(decorateMessageWithSessionNames(msg, state));
      }
    }
    if (delivered.length > 0) {
      markDirty();
    }
    return delivered;
  });
}

function getLockStatus(options = {}) {
  const sessionId = typeof options.sessionId === "string" ? options.sessionId.trim() : null;
  const targetSpec =
    options.moduleKey || options.module
      ? getModuleSpec(options.moduleKey || options.module)
      : null;

  return withStateMutex(options, (state, { markDirty, nowIso }) => {
    for (const [moduleKey, lock] of Object.entries(state.moduleLocks)) {
      if (!lock) continue;
      const latestSha = computeModuleSha256(moduleKey, options);
      if (latestSha && latestSha !== lock.currentSha256) {
        lock.currentSha256 = latestSha;
        lock.updatedAt = nowIso;
        markDirty();
      }
    }

    const moduleLocks = targetSpec
      ? state.moduleLocks[targetSpec.key]
        ? { [targetSpec.key]: decorateLockWithSessionNames(state.moduleLocks[targetSpec.key], state) }
        : {}
      : Object.fromEntries(
          Object.entries(state.moduleLocks).map(([key, lock]) => [key, decorateLockWithSessionNames(lock, state)])
        );

    const pendingRequestsForSession = [];
    for (const lock of Object.values(state.moduleLocks)) {
      if (!lock || !Array.isArray(lock.requests)) continue;
      for (const req of lock.requests) {
        if (
          req &&
          req.status === "pending" &&
          (!sessionId || lock.ownerSessionId === sessionId || req.fromSessionId === sessionId)
        ) {
          pendingRequestsForSession.push(decorateRequestWithSessionNames(req, state));
        }
      }
    }

    const undeliveredMessages = sessionId
      ? state.messages
          .filter((m) => m && m.toSessionId === sessionId && !m.deliveredAt)
          .map((m) => decorateMessageWithSessionNames(m, state))
      : [];

    return {
      schemaVersion: state.schemaVersion,
      edition: STANDALONE_EDITION,
      version: STANDALONE_VERSION,
      updatedAt: state.updatedAt,
      sessionId,
      currentSessionName: sessionId ? sessionDisplayName(state, sessionId) : null,
      globalBuildLock: state.globalBuildLock
        ? {
            ...structuredClone(state.globalBuildLock),
            ownerSessionName: state.globalBuildLock.ownerSessionId
              ? sessionDisplayName(state, state.globalBuildLock.ownerSessionId, state.globalBuildLock.ownerSessionName)
              : null,
          }
        : null,
      moduleLocks,
      pendingRequests: pendingRequestsForSession,
      undeliveredMessages,
    };
  });
}

function inspectManifestModuleDiffs(options = {}) {
  const modulesDir = resolveModulesDir(options);
  const manifestPath = path.join(modulesDir, "manifest.json");
  if (!fs.existsSync(manifestPath)) {
    return { hasManifest: false, modifiedModules: [] };
  }
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch (err) {
    const parseErr = new Error(`Failed to parse module manifest ${manifestPath}: ${err.message}`);
    parseErr.code = "ENHANCEMENT_MANIFEST_CORRUPT";
    throw parseErr;
  }
  if (!manifest || !Array.isArray(manifest.modules)) {
    return { hasManifest: false, modifiedModules: [] };
  }

  const modifiedModules = [];
  for (const spec of MODULE_SPECS) {
    const entry = manifest.modules.find((m) => m && (m.file === spec.file || m.index === spec.index));
    const modulePath = path.join(modulesDir, spec.file);
    if (!entry || !fs.existsSync(modulePath)) continue;
    const actualSha = sha256Hex(fs.readFileSync(modulePath));
    if (actualSha !== entry.sha256) {
      modifiedModules.push({
        moduleKey: spec.key,
        moduleFile: spec.file,
        manifestSha256: entry.sha256,
        actualSha256: actualSha,
      });
    }
  }
  return { hasManifest: true, modifiedModules };
}

function verifySnapshotManifestForLock(snapshotManifestPath, canonicalModulesDir) {
  if (typeof snapshotManifestPath !== "string" || !snapshotManifestPath.trim()) {
    const err = new Error("[snapshot-verify] snapshotManifestPath 必须是非空字符串");
    err.code = "SNAPSHOT_PATH_INVALID";
    throw err;
  }
  const resolvedManifestPath = path.resolve(snapshotManifestPath);
  if (!fs.existsSync(resolvedManifestPath)) {
    const err = new Error(`[snapshot-verify] 快照 manifest 文件不存在: ${resolvedManifestPath}`);
    err.code = "SNAPSHOT_NOT_FOUND";
    throw err;
  }
  const realManifestPath = fs.realpathSync(resolvedManifestPath);
  const resolvedCanonicalDir = path.resolve(canonicalModulesDir || DEFAULT_MODULES_DIR);
  let realCanonicalDir = resolvedCanonicalDir;
  try {
    if (fs.existsSync(resolvedCanonicalDir)) {
      realCanonicalDir = fs.realpathSync(resolvedCanonicalDir);
    }
  } catch (_) {}

  // 严格断言：快照路径不在 canonical 源目录，且不可用 symlink 指回 canonical
  if (
    realManifestPath === realCanonicalDir ||
    realManifestPath.startsWith(`${realCanonicalDir}${path.sep}`)
  ) {
    const err = new Error(
      `[snapshot-verify] 快照 manifest 路径位于 canonical 源目录或通过软链接指向 canonical (${realManifestPath})，拒绝使用`
    );
    err.code = "SNAPSHOT_PATH_CANONICAL_CONFLICT";
    throw err;
  }

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(realManifestPath, "utf8"));
  } catch (parseErr) {
    const err = new Error(`[snapshot-verify] 快照 manifest 解析失败: ${parseErr.message}`);
    err.code = "SNAPSHOT_MANIFEST_INVALID_JSON";
    throw err;
  }

  // 验证快照身份字段
  if (!manifest || typeof manifest !== "object") {
    const err = new Error("[snapshot-verify] 快照 manifest 不是有效对象");
    err.code = "SNAPSHOT_MANIFEST_INVALID";
    throw err;
  }
  const snapshotId = manifest.snapshotId || manifest.candidateId;
  if (!snapshotId || typeof snapshotId !== "string" || !snapshotId.trim()) {
    const err = new Error("[snapshot-verify] 快照缺少有效的快照身份字段 snapshotId/candidateId");
    err.code = "SNAPSHOT_ID_MISSING";
    throw err;
  }
  if (!manifest.edition || typeof manifest.edition !== "string") {
    const err = new Error("[snapshot-verify] 快照缺少有效 edition 字段");
    err.code = "SNAPSHOT_EDITION_MISSING";
    throw err;
  }
  const expectedBundleSha = manifest.bundleSha256 || manifest.rawSha256;
  if (!expectedBundleSha || typeof expectedBundleSha !== "string" || !/^[0-9a-f]{64}$/i.test(expectedBundleSha)) {
    const err = new Error("[snapshot-verify] 快照缺少有效的 64 位 bundleSha256/rawSha256 字段");
    err.code = "SNAPSHOT_SHA_MISSING";
    throw err;
  }
  if (!Array.isArray(manifest.modules) || manifest.modules.length !== MODULE_SPECS.length) {
    const err = new Error(
      `[snapshot-verify] 快照 modules 数量不匹配，期望 ${MODULE_SPECS.length}，实际 ${manifest.modules?.length}`
    );
    err.code = "SNAPSHOT_MODULES_COUNT_MISMATCH";
    throw err;
  }

  // 确定 snapshot 模块目录
  const manifestDir = path.dirname(realManifestPath);
  let snapshotModulesDir = manifestDir;
  if (fs.existsSync(path.join(manifestDir, "01-bootstrap-and-core-state.js"))) {
    snapshotModulesDir = manifestDir;
  } else if (fs.existsSync(path.join(manifestDir, "modules", "01-bootstrap-and-core-state.js"))) {
    snapshotModulesDir = path.join(manifestDir, "modules");
  } else if (manifest.modulesDir && fs.existsSync(manifest.modulesDir)) {
    snapshotModulesDir = path.resolve(manifest.modulesDir);
  } else {
    const err = new Error(`[snapshot-verify] 无法定位快照包含的 8 模块目录: ${manifestDir}`);
    err.code = "SNAPSHOT_MODULES_DIR_MISSING";
    throw err;
  }

  let realSnapshotModulesDir = snapshotModulesDir;
  try {
    realSnapshotModulesDir = fs.realpathSync(snapshotModulesDir);
  } catch (_) {}
  if (
    realSnapshotModulesDir === realCanonicalDir ||
    realSnapshotModulesDir.startsWith(`${realCanonicalDir}${path.sep}`)
  ) {
    const err = new Error(
      `[snapshot-verify] 快照 modulesDir 位于 canonical 源目录或指向 canonical: ${realSnapshotModulesDir}`
    );
    err.code = "SNAPSHOT_MODULES_DIR_CANONICAL";
    throw err;
  }

  const moduleBuffers = [];
  for (let i = 0; i < MODULE_SPECS.length; i++) {
    const spec = MODULE_SPECS[i];
    const modEntry = manifest.modules[i];
    if (!modEntry || (modEntry.file !== spec.file && modEntry.name !== spec.file)) {
      const err = new Error(`[snapshot-verify] 快照第 ${i + 1} 模块配置不匹配: 期望 ${spec.file}`);
      err.code = "SNAPSHOT_MODULE_ENTRY_MISMATCH";
      throw err;
    }
    const modPath = path.join(realSnapshotModulesDir, spec.file);
    if (!fs.existsSync(modPath)) {
      const err = new Error(`[snapshot-verify] 快照缺少模块文件: ${modPath}`);
      err.code = "SNAPSHOT_MODULE_FILE_MISSING";
      throw err;
    }
    const realModPath = fs.realpathSync(modPath);
    if (
      realModPath === realCanonicalDir ||
      realModPath.startsWith(`${realCanonicalDir}${path.sep}`)
    ) {
      const err = new Error(`[snapshot-verify] 快照模块文件指向 canonical 目录: ${realModPath}`);
      err.code = "SNAPSHOT_MODULE_LINKED_TO_CANONICAL";
      throw err;
    }
    const buf = fs.readFileSync(realModPath);
    const actualSha = sha256Hex(buf);
    if (actualSha !== modEntry.sha256) {
      const err = new Error(
        `[snapshot-verify] 快照模块 ${spec.file} SHA 不符: manifest=${modEntry.sha256}, actual=${actualSha}`
      );
      err.code = "SNAPSHOT_MODULE_SHA_MISMATCH";
      throw err;
    }
    moduleBuffers.push(buf);
  }

  const concatBuffer = Buffer.concat(moduleBuffers);
  const concatSha = sha256Hex(concatBuffer);
  if (concatSha !== expectedBundleSha) {
    const err = new Error(
      `[snapshot-verify] 快照 8 模块拼合 SHA256 (${concatSha}) 与 manifest 记录 (${expectedBundleSha}) 不符`
    );
    err.code = "SNAPSHOT_CONCAT_SHA_MISMATCH";
    throw err;
  }

  // 若快照目录下存在 raw bundle 文件（例如 pi-web-enhancements.js），验证其内容
  const candidateRawPaths = [
    path.join(manifestDir, "pi-web-enhancements.js"),
    path.join(path.dirname(manifestDir), "pi-web-enhancements.js"),
  ];
  for (const rawP of candidateRawPaths) {
    if (fs.existsSync(rawP)) {
      const rawBuf = fs.readFileSync(rawP);
      if (Buffer.compare(rawBuf, concatBuffer) !== 0) {
        const err = new Error(`[snapshot-verify] 快照 raw 文件 ${rawP} 与 8 模块拼合内容不一致`);
        err.code = "SNAPSHOT_RAW_MISMATCH";
        throw err;
      }
      break;
    }
  }

  // 验证 gateReceipt：需 mandatory passed + candidateRawSHA + modulesHashSummary 完全匹配，缺 summary 必须拒绝
  const receipt = manifest.gateReceipt;
  if (!receipt || typeof receipt !== "object") {
    const err = new Error(`[snapshot-verify] 快照缺少 gateReceipt 门禁记录，拒绝认证`);
    err.code = "SNAPSHOT_GATE_RECEIPT_MISSING";
    throw err;
  }
  if (receipt.browserRegressionPassed !== true) {
    const err = new Error(`[snapshot-verify] 快照 gateReceipt 浏览器门禁未通过`);
    err.code = "SNAPSHOT_GATE_NOT_PASSED";
    throw err;
  }
  if (!receipt.modulesHashSummary || typeof receipt.modulesHashSummary !== "string") {
    const err = new Error(`[snapshot-verify] 快照 gateReceipt 缺少 modulesHashSummary，拒绝认证`);
    err.code = "SNAPSHOT_GATE_SUMMARY_MISSING";
    throw err;
  }
  if (!receipt.candidateRawSha || receipt.candidateRawSha !== expectedBundleSha) {
    const err = new Error(`[snapshot-verify] 快照 gateReceipt.candidateRawSha 与快照 rawSha 不一致`);
    err.code = "SNAPSHOT_GATE_RAW_MISMATCH";
    throw err;
  }
  const actualSummary = MODULE_SPECS.map((s, idx) => `${s.file}:${manifest.modules[idx].sha256}`).join(";");
  if (receipt.modulesHashSummary !== actualSummary) {
    const err = new Error(`[snapshot-verify] 快照 gateReceipt.modulesHashSummary 与快照模块实际 hash 不匹配`);
    err.code = "SNAPSHOT_GATE_SUMMARY_MISMATCH";
    throw err;
  }

  return {
    verified: true,
    manifest,
    realManifestPath,
    realSnapshotModulesDir,
    bundleSha256: concatSha,
    moduleBuffers,
    concatBuffer,
  };
}

function acquireGlobalBuildLock(options = {}) {
  const rawSessionId =
    options.sessionId !== undefined ? options.sessionId : process.env.PI_SESSION_ID || null;
  const sessionId = typeof rawSessionId === "string" && rawSessionId.trim() ? rawSessionId.trim() : null;
  const pid = Number.isInteger(options.pid) && options.pid > 0 ? options.pid : process.pid;
  const operation = sanitizeMetadataText(options.operation || "build", "build");
  const requestedToken =
    (typeof options.operationToken === "string" && options.operationToken.trim()) ||
    (typeof process.env.PI_ENH_BUILD_OP_TOKEN === "string" &&
      process.env.PI_ENH_BUILD_OP_TOKEN.trim()) ||
    `op-${crypto.randomUUID()}`;
  const waitTimeoutMs = Number.isFinite(options.waitTimeoutMs) ? Math.max(0, Number(options.waitTimeoutMs)) : 0;
  const pollIntervalMs = Number.isFinite(options.pollIntervalMs) ? Math.max(10, Number(options.pollIntervalMs)) : 40;
  const enforceUnlockedDiffCheck = true;

  const canonicalModulesDir = options.canonicalModulesDir || DEFAULT_MODULES_DIR;
  let certifiedSnapshot = null;
  if (options.snapshotManifestPath) {
    certifiedSnapshot = verifySnapshotManifestForLock(options.snapshotManifestPath, canonicalModulesDir);
  }
  const isCertifiedSnapshot = Boolean(certifiedSnapshot);

  const deadline = Date.now() + waitTimeoutMs;

  while (true) {
    const attempt = withStateMutex(options, (state, { markDirty, nowIso }) => {
      // Refresh currentSha256 on active module locks:
      // snapshot 模式使用 canonicalModulesDir 且仅刷新当前持有的模块锁，不用别人的 baseline；
      // legacy 模式优先尊重 options.modulesDir，保证测试 tempfixtures 隔离性
      if (isCertifiedSnapshot) {
        for (const [moduleKey, lock] of Object.entries(state.moduleLocks)) {
          if (!lock || !sessionId || lock.ownerSessionId !== sessionId) continue;
          const latestSha = computeModuleSha256(moduleKey, { ...options, modulesDir: canonicalModulesDir });
          if (latestSha && latestSha !== lock.currentSha256) {
            lock.currentSha256 = latestSha;
            lock.updatedAt = nowIso;
            markDirty();
          }
        }
      } else {
        const legacyModulesDir = options.modulesDir || options.canonicalModulesDir || DEFAULT_MODULES_DIR;
        for (const [moduleKey, lock] of Object.entries(state.moduleLocks)) {
          if (!lock) continue;
          const latestSha = computeModuleSha256(moduleKey, { ...options, modulesDir: legacyModulesDir });
          if (latestSha && latestSha !== lock.currentSha256) {
            lock.currentSha256 = latestSha;
            lock.updatedAt = nowIso;
            markDirty();
          }
        }
      }

      // 1. Reentrant check with identical operationToken
      if (
        state.globalBuildLock &&
        state.globalBuildLock.operationToken === requestedToken
      ) {
        state.globalBuildLock.depth = (Number(state.globalBuildLock.depth) || 1) + 1;
        state.globalBuildLock.updatedAt = nowIso;
        markDirty();
        return {
          acquired: true,
          reentrant: true,
          operationToken: requestedToken,
          depth: state.globalBuildLock.depth,
          lock: structuredClone(state.globalBuildLock),
        };
      }

      // 2. Check if another global build lock is currently active
      if (state.globalBuildLock) {
        return {
          acquired: false,
          conflictType: "global_build_locked",
          globalBuildLock: structuredClone(state.globalBuildLock),
        };
      }

      // 3. Check module locks held by other sessions (or any session if caller has no sessionId)
      const activeLocks = Object.values(state.moduleLocks).filter(Boolean);
      const foreignLocks = activeLocks
        .filter((lock) => !sessionId || lock.ownerSessionId !== sessionId)
        .map((lock) => ({
          ...lock,
          ownerSessionName: sessionDisplayName(state, lock.ownerSessionId, lock.ownerSessionName),
        }));
      if (!isCertifiedSnapshot && foreignLocks.length > 0) {
        return {
          acquired: false,
          conflictType: "foreign_module_locks",
          foreignLocks: structuredClone(foreignLocks),
        };
      }

      // 4. Fail-closed check for unlocked module modifications (e.g. direct bash edits bypassing locks)
      if (!isCertifiedSnapshot && enforceUnlockedDiffCheck && operation !== "split") {
        const legacyModulesDir = options.modulesDir || options.canonicalModulesDir || DEFAULT_MODULES_DIR;
        const diffReport = inspectManifestModuleDiffs({ ...options, modulesDir: legacyModulesDir });
        if (diffReport.hasManifest && diffReport.modifiedModules.length > 0) {
          const unlockedDirtyModules = diffReport.modifiedModules.filter((mod) => {
            const lock = state.moduleLocks[mod.moduleKey];
            return !lock || !sessionId || lock.ownerSessionId !== sessionId;
          });
          if (unlockedDirtyModules.length > 0) {
            return {
              acquired: false,
              conflictType: "unlocked_modified_modules",
              unlockedDirtyModules,
            };
          }
        }
      }

      // 5. All checks passed -> acquire exclusive global build lock
      const moduleShas = {};
      for (const spec of MODULE_SPECS) {
        const sha = computeModuleSha256(spec, options);
        if (sha) moduleShas[spec.key] = sha;
      }

      const buildLock = {
        operationToken: requestedToken,
        operation,
        ownerSessionId: sessionId,
        ownerSessionName: sessionId ? sessionDisplayName(state, sessionId) : null,
        ownerPid: pid,
        edition: STANDALONE_EDITION,
        version: STANDALONE_VERSION,
        depth: 1,
        ownedModules: activeLocks.map((l) => l.moduleKey),
        moduleShas,
        snapshotManifestPath: isCertifiedSnapshot ? options.snapshotManifestPath : null,
        isCertifiedSnapshot,
        acquiredAt: nowIso,
        updatedAt: nowIso,
      };
      state.globalBuildLock = buildLock;
      markDirty();

      return {
        acquired: true,
        reentrant: false,
        operationToken: requestedToken,
        depth: 1,
        lock: structuredClone(buildLock),
      };
    });

    if (attempt.acquired) {
      return attempt;
    }

    if (Date.now() >= deadline) {
      if (attempt.conflictType === "global_build_locked") {
        const g = attempt.globalBuildLock;
        const err = new Error(
          `[build-lock] 全局构建/部署锁冲突：当前已有构建任务正在运行 (operation=${g.operation}, 持有者=${g.ownerSessionId ? `「${g.ownerSessionName || "未命名会话（标题尚未生成）"}」` : "CLI"}, ownerPid=${g.ownerPid}, version=${g.version || STANDALONE_VERSION})。`
        );
        err.code = "ENHANCEMENT_GLOBAL_BUILD_LOCKED";
        err.globalBuildLock = g;
        throw err;
      }

      if (attempt.conflictType === "foreign_module_locks") {
        const details = attempt.foreignLocks
          .map(
            (l) =>
              `${l.moduleKey} (${l.moduleFile}) -> 持有者=${l.ownerSessionId ? `「${l.ownerSessionName || "未命名会话（标题尚未生成）"}」` : "未知会话"}, ownerPid=${l.ownerPid}, version=${l.version || STANDALONE_VERSION}, baselineSha=${(l.baselineSha256 || "").slice(0, 12)}, currentSha=${(l.currentSha256 || "").slice(0, 12)}`
          )
          .join("; ");
        const err = new Error(
          `[build-lock] 拒绝从混合状态构建或发布：检测到其他会话仍持有模块锁。持锁详情: ${details}`
        );
        err.code = "ENHANCEMENT_FOREIGN_MODULE_LOCK";
        err.conflicts = attempt.foreignLocks;
        throw err;
      }

      if (attempt.conflictType === "unlocked_modified_modules") {
        const details = attempt.unlockedDirtyModules
          .map(
            (m) =>
              `${m.moduleKey} (${m.moduleFile}: manifest=${m.manifestSha256.slice(0, 12)} != actual=${m.actualSha256.slice(0, 12)})`
          )
          .join("; ");
        const err = new Error(
          `[build-lock] Fail-closed 拦截：检测到模块文件已修改但未由当前构建会话持有对应模块锁: ${details}。请先通过协作锁工具 acquire 获取对应模块锁后再构建。`
        );
        err.code = "ENHANCEMENT_UNLOCKED_MODIFICATION";
        err.unlockedModules = attempt.unlockedDirtyModules;
        throw err;
      }

      const err = new Error("[build-lock] 无法获取全局构建锁");
      err.code = "ENHANCEMENT_BUILD_LOCK_FAILED";
      throw err;
    }

    sleepSync(pollIntervalMs);
  }
}

function releaseGlobalBuildLock(options = {}) {
  const operationToken =
    (typeof options.operationToken === "string" && options.operationToken.trim()) ||
    (typeof process.env.PI_ENH_BUILD_OP_TOKEN === "string" &&
      process.env.PI_ENH_BUILD_OP_TOKEN.trim()) ||
    null;

  return withStateMutex(options, (state, { markDirty, nowIso }) => {
    const active = state.globalBuildLock;
    if (!active) {
      return { released: true, noop: true, depth: 0 };
    }
    if (operationToken && active.operationToken !== operationToken) {
      return {
        released: false,
        noop: false,
        error: `Operation token mismatch: active=${active.operationToken}, provided=${operationToken}`,
      };
    }

    const currentDepth = Number(active.depth) || 1;
    if (currentDepth > 1) {
      active.depth = currentDepth - 1;
      active.updatedAt = nowIso;
      markDirty();
      return {
        released: false,
        reentrantRelease: true,
        depth: active.depth,
        operationToken: active.operationToken,
      };
    }

    const ownerSessionId = active.ownerSessionId;
    const isSnapshotRelease = Boolean(active.isCertifiedSnapshot || options.snapshotManifestPath);
    state.globalBuildLock = null;

    if (!isSnapshotRelease && options.advanceOwnedBaselines && ownerSessionId) {
      const targetModulesDir = options.modulesDir || options.canonicalModulesDir || DEFAULT_MODULES_DIR;
      for (const [moduleKey, lock] of Object.entries(state.moduleLocks)) {
        if (lock && lock.ownerSessionId === ownerSessionId) {
          const latestSha = computeModuleSha256(moduleKey, { ...options, modulesDir: targetModulesDir });
          if (latestSha) {
            lock.currentSha256 = latestSha;
            lock.baselineSha256 = latestSha;
            lock.updatedAt = nowIso;
          }
        }
      }
    }

    markDirty();
    return {
      released: true,
      reentrantRelease: false,
      depth: 0,
      operationToken: active.operationToken,
    };
  });
}

function withGlobalBuildLock(optionsOrFn, maybeFn) {
  const options = typeof optionsOrFn === "function" ? {} : optionsOrFn || {};
  const fn = typeof optionsOrFn === "function" ? optionsOrFn : maybeFn;
  if (typeof fn !== "function") {
    throw new Error("withGlobalBuildLock requires a callback function");
  }

  const prevEnvToken = process.env.PI_ENH_BUILD_OP_TOKEN;
  const acquired = acquireGlobalBuildLock(options);
  const operationToken = acquired.operationToken;
  process.env.PI_ENH_BUILD_OP_TOKEN = operationToken;

  let isAsync = false;
  let succeeded = false;

  const finalize = (ok) => {
    if (prevEnvToken === undefined) {
      delete process.env.PI_ENH_BUILD_OP_TOKEN;
    } else {
      process.env.PI_ENH_BUILD_OP_TOKEN = prevEnvToken;
    }
    releaseGlobalBuildLock({
      ...options,
      operationToken,
      advanceOwnedBaselines: Boolean(ok),
    });
  };

  try {
    const result = fn({
      operationToken,
      reentrant: acquired.reentrant,
      depth: acquired.depth,
      lock: acquired.lock,
    });
    if (result && typeof result.then === "function") {
      isAsync = true;
      return result.then(
        (val) => {
          finalize(true);
          return val;
        },
        (err) => {
          finalize(false);
          throw err;
        }
      );
    }
    succeeded = true;
    return result;
  } finally {
    if (!isAsync) {
      finalize(succeeded);
    }
  }
}

function formatToolUsageGuide() {
  return [
    `📖 【Pi Web 增强跨会话协作锁协议 (v${STANDALONE_VERSION})】`,
    `- status : 查看模块锁、全局构建锁、持有者会话名称、基线与当前 SHA、待处理请求`,
    `- acquire: 获取指定模块锁 (module:01 ~ module:08)；内置 edit/write 修改模块文件时会自动触发`,
    `- request: 当目标模块被其他会话持有时，向持有者发送协商请求 (经过状态队列 + fs.watch 实时通知对方)`,
    `- reply  : 锁持有者回复协商请求 (decision="accept"|"reject"|"release"|"info"，可設 release=true 同时释放锁)`,
    `- release: 释放本会话持有的指定模块锁或全部模块锁 (releaseAll=true)，按 FIFO 自动交接并唤醒下一会话`,
    `- taskCompleted=true：仅原业务任务、必要部署与验收真正完成后，在 release 时显式确认；无待处理请求/持锁时才移除【Pi未完成】。取消、关闭、获锁及单回合结束不算完成。`,
  ].join("\n");
}

function runCli(argv = process.argv.slice(2)) {
  const action = String(argv[0] || "status").toLowerCase();
  const sessionId = process.env.PI_SESSION_ID || "";
  const moduleArg = argv[1] && !argv[1].startsWith("--") ? argv[1] : undefined;
  const messageArg = argv.slice(2).filter((a) => !a.startsWith("--")).join(" ") || undefined;
  const releaseAll = argv.includes("--all");
  const releaseFlag = argv.includes("--release");

  if (action === "status") {
    const res = getLockStatus({ sessionId: sessionId || undefined, module: moduleArg });
    console.log(JSON.stringify(res, null, 2));
    return;
  }
  if (action === "acquire") {
    const res = acquireModuleLock({ sessionId, module: moduleArg, message: messageArg });
    console.log(JSON.stringify(res, null, 2));
    if (!res.acquired) process.exitCode = 1;
    return;
  }
  if (action === "request") {
    const res = requestModuleLock({ sessionId, module: moduleArg, message: messageArg });
    console.log(JSON.stringify(res, null, 2));
    return;
  }
  if (action === "reply") {
    const res = replyModuleLockRequest({
      sessionId,
      module: moduleArg,
      message: messageArg,
      release: releaseFlag,
    });
    console.log(JSON.stringify(res, null, 2));
    if (!res.replied) process.exitCode = 1;
    return;
  }
  if (action === "release") {
    const res = releaseModuleLock({
      sessionId,
      module: moduleArg,
      releaseAll,
      message: messageArg,
    });
    console.log(JSON.stringify(res, null, 2));
    if (!res.released) process.exitCode = 1;
    return;
  }
  throw new Error(`Unknown CLI action: ${action}. Supported: status, acquire, request, reply, release`);
}

module.exports = {
  DEFAULT_STATE_FILE,
  DEFAULT_MODULES_DIR,
  DEFAULT_PRIMARY_BUNDLE_PATH,
  STANDALONE_EDITION,
  STANDALONE_VERSION,
  MODULE_SPECS,
  normalizeModuleKey,
  getModuleSpec,
  resolveModuleFromFilePath,
  computeModuleSha256,
  defaultIsPidAlive,
  resolveStateFile,
  resolveModulesDir,
  withStateMutex,
  acquireModuleLock,
  requestModuleLock,
  replyModuleLockRequest,
  releaseModuleLock,
  refreshOwnedModuleHashes,
  peekSessionMessages,
  ackSessionMessages,
  consumeSessionMessages,
  rememberSessionName,
  getLockStatus,
  inspectManifestModuleDiffs,
  verifySnapshotManifestForLock,
  acquireGlobalBuildLock,
  releaseGlobalBuildLock,
  withGlobalBuildLock,
  formatConflictReason,
  formatLockMessageSummary,
  formatToolUsageGuide,
  UNCOMPLETED_TAG_NAME,
  UNCOMPLETED_TAG_COLOR,
  ensureUncompletedTagDefinition,
  setSessionUncompletedTag,
  cancelSessionLockRequests,
  checkSessionHasPendingLockRequests,
  checkSessionHoldsAnyModuleLocks,
};

if (require.main === module) {
  try {
    runCli();
  } catch (err) {
    console.error("[pi-web-enhancement-locks] ERROR:", err && err.message ? err.message : err);
    process.exit(1);
  }
}
