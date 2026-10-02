"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// lib/session-history-worker-entry.ts
var import_worker_threads = require("worker_threads");
var import_node_crypto = require("node:crypto");

// lib/session-history-page-cache.ts
var HISTORY_CACHE_SCOPE = "pi-history-page-cache:v1:";
var MAX_PAGE_BYTES = 16 * 1024 * 1024;
var MAX_TOTAL_BYTES = 32 * 1024 * 1024;
var MAX_AGE_MS = 24 * 60 * 60 * 1e3;

// lib/session-history-indexer.ts
var fs = __toESM(require("fs"));

// lib/normalize.ts
function isObject(val) {
  return typeof val === "object" && val !== null && !Array.isArray(val);
}
function streamingRawInput(block) {
  if (typeof block.rawInput === "string") return block.rawInput;
  if (typeof block.partialJson === "string") return block.partialJson;
  if (typeof block.partialArgs === "string") return block.partialArgs;
  const customInput = isObject(block.customInput) ? block.customInput : null;
  const property = customInput && typeof customInput.property === "string" ? customInput.property : null;
  const args = isObject(block.arguments) ? block.arguments : null;
  return property && args && typeof args[property] === "string" ? args[property] : void 0;
}
function normalizeToolCallBlock(block, options = {}) {
  if (!isObject(block) || block.type !== "toolCall") return null;
  const normalized = {
    type: "toolCall",
    toolCallId: typeof block.toolCallId === "string" ? block.toolCallId : typeof block.id === "string" ? block.id : "",
    toolName: typeof block.toolName === "string" ? block.toolName : typeof block.name === "string" ? block.name : "",
    input: typeof block.input === "object" && block.input !== null && !Array.isArray(block.input) ? block.input : typeof block.arguments === "object" && block.arguments !== null && !Array.isArray(block.arguments) ? block.arguments : {}
  };
  const rawInput = options.includeStreamingRawInput ? streamingRawInput(block) : void 0;
  return rawInput === void 0 ? normalized : { ...normalized, rawInput };
}
function normalizeAssistantToolCalls(msg, options = {}) {
  if (msg.role !== "assistant") return msg;
  const content = msg.content;
  if (!Array.isArray(content)) return msg;
  const normalized = content.map((block) => {
    const result = normalizeToolCallBlock(block, options);
    return result ?? block;
  });
  return { ...msg, content: normalized };
}
function normalizeToolCalls(msg) {
  return normalizeAssistantToolCalls(msg);
}

// lib/message-display.ts
function getThinkingPreview(thinking) {
  return thinking.trimStart().match(/^[^\r\n]{0,240}/u)?.[0].trimEnd() ?? "";
}

// lib/tool-result-images.ts
var MAX_TOOL_RESULT_IMAGE_BYTES = 10 * 1024 * 1024;
var TOOL_RESULT_IMAGE_MIMES = /* @__PURE__ */ new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/bmp",
  "image/avif"
]);

// lib/session-context.ts
function traverseAncestorChain(startNode, getParent, tail, excludeStart = false, rawCap) {
  if (!startNode) return [];
  let current = startNode;
  if (excludeStart) {
    current = current.parentId ? getParent(current) : void 0;
  }
  if (!current) return [];
  const chain = [];
  let visible = 0;
  const maxRaw = rawCap ?? (tail > 0 ? rawWindowCap(tail) : Infinity);
  const visited = /* @__PURE__ */ new Set();
  while (current) {
    if (visited.has(current.id)) break;
    visited.add(current.id);
    chain.push(current);
    if (current.countsTowardTail) visible++;
    if (tail > 0 && visible >= tail || chain.length >= maxRaw) break;
    current = current.parentId ? getParent(current) : void 0;
  }
  chain.reverse();
  return chain;
}
function resolveBranchSettingsFromChain(startNode, getParent) {
  if (!startNode) {
    return { thinkingLevel: "off", model: null };
  }
  let thinkingLevel;
  let latestExplicitModel;
  let latestAssistantModel;
  let current = startNode;
  const visited = /* @__PURE__ */ new Set();
  while (current) {
    if (visited.has(current.id)) break;
    visited.add(current.id);
    if (thinkingLevel === void 0 && current.thinkingLevel !== void 0) {
      thinkingLevel = current.thinkingLevel;
    }
    if (latestExplicitModel === void 0 && current.modelChange) {
      latestExplicitModel = current.modelChange;
    }
    if (latestAssistantModel === void 0 && current.assistantModel) {
      latestAssistantModel = current.assistantModel;
    }
    if (thinkingLevel !== void 0 && (latestExplicitModel !== void 0 || latestAssistantModel !== void 0)) {
      if (latestExplicitModel !== void 0) break;
    }
    current = current.parentId ? getParent(current) : void 0;
  }
  return {
    thinkingLevel: thinkingLevel ?? "off",
    model: latestExplicitModel ?? latestAssistantModel ?? null
  };
}
function sessionEntryToMetadata(entry) {
  let modelChange;
  let thinkingLevel;
  let assistantModel;
  if (entry.type === "model_change") {
    modelChange = { provider: entry.provider, modelId: entry.modelId };
  } else if (entry.type === "thinking_level_change") {
    thinkingLevel = entry.thinkingLevel;
  } else if (entry.type === "message" && entry.message?.role === "assistant") {
    const msg = entry.message;
    if (typeof msg.provider === "string" && typeof msg.model === "string") {
      assistantModel = { provider: msg.provider, modelId: msg.model };
    }
  }
  return {
    id: entry.id,
    parentId: entry.parentId,
    countsTowardTail: countsTowardTail(entry),
    thinkingLevel,
    modelChange,
    assistantModel
  };
}
function countsTowardTail(entry) {
  if (entry.type === "compaction") return true;
  if (entry.type !== "message") return false;
  const role = entry.message?.role;
  return role === "user" || role === "assistant";
}
var MIN_RAW_WINDOW_ENTRIES = 200;
var rawWindowCap = (tail) => Math.max(MIN_RAW_WINDOW_ENTRIES, tail * 6);
function sliceActiveBranch(entries, leafId, tail, excludeLeaf = false, byIdMap) {
  if (tail <= 0) return entries;
  const byId = byIdMap ?? new Map(entries.map((e) => [e.id, e]));
  const leaf = leafId ? byId.get(leafId) : entries[entries.length - 1];
  if (!leaf) return [];
  const metaCache = /* @__PURE__ */ new Map();
  const getEntryMeta = (entry) => {
    let cached = metaCache.get(entry.id);
    if (!cached) {
      const meta = sessionEntryToMetadata(entry);
      cached = { ...entry, ...meta };
      metaCache.set(entry.id, cached);
    }
    return cached;
  };
  const startMeta = getEntryMeta(leaf);
  return traverseAncestorChain(
    startMeta,
    (node) => {
      const parent = node.parentId ? byId.get(node.parentId) : void 0;
      return parent ? getEntryMeta(parent) : void 0;
    },
    tail,
    excludeLeaf,
    rawWindowCap(tail)
  ).map((node) => byId.get(node.id));
}
function getSessionSettings(entries, leafId, byIdMap) {
  if (leafId === null) return { thinkingLevel: "off", model: null };
  const byId = byIdMap ?? new Map(entries.map((e) => [e.id, e]));
  const leaf = leafId ? byId.get(leafId) : entries[entries.length - 1];
  if (!leaf) return { thinkingLevel: "off", model: null };
  const metaCache = /* @__PURE__ */ new Map();
  const getMeta = (entry) => {
    let cached = metaCache.get(entry.id);
    if (!cached) {
      cached = sessionEntryToMetadata(entry);
      metaCache.set(entry.id, cached);
    }
    return cached;
  };
  return resolveBranchSettingsFromChain(
    getMeta(leaf),
    (node) => {
      const parent = node.parentId ? byId.get(node.parentId) : void 0;
      return parent ? getMeta(parent) : void 0;
    }
  );
}
function buildSessionContext(entries, leafId, options = {}) {
  const { tail, excludeLeaf, before } = options;
  const effectiveCursor = before !== void 0 && before !== null ? before : leafId === null ? null : leafId ?? void 0;
  const byId = /* @__PURE__ */ new Map();
  for (const e of entries) byId.set(e.id, e);
  const sliced = effectiveCursor === null ? [] : sliceActiveBranch(
    entries,
    effectiveCursor ?? null,
    tail && tail > 0 ? tail : entries.length,
    excludeLeaf,
    byId
  );
  const hasMore = Boolean(tail && tail > 0 && sliced[0]?.parentId);
  const messages = [];
  const entryIds = [];
  for (const entry of sliced) {
    const m = entryToUiMessage(entry, options);
    if (m) {
      messages.push(m);
      entryIds.push(entry.id);
    }
  }
  const settings = getSessionSettings(entries, effectiveCursor, byId);
  return {
    messages,
    entryIds,
    oldestEntryId: sliced[0]?.id ?? null,
    hasMore,
    ...settings
  };
}
function parseEntryTimestamp(timestamp) {
  const parsed = Date.parse(timestamp);
  return Number.isNaN(parsed) ? void 0 : parsed;
}
function parseAssistantTimestamp(timestamp) {
  if (typeof timestamp === "number") {
    return Number.isFinite(timestamp) ? timestamp : void 0;
  }
  if (typeof timestamp === "string") {
    const trimmed = timestamp.trim();
    if (!trimmed) return void 0;
    const parsed = Date.parse(trimmed);
    if (!Number.isNaN(parsed)) return parsed;
    const asNum = Number(trimmed);
    if (Number.isFinite(asNum)) return asNum;
  }
  return void 0;
}
function resolveAssistantCompletedAt(entryTimestamp, messageTimestamp) {
  const completedAt = parseAssistantTimestamp(entryTimestamp);
  if (completedAt === void 0) return void 0;
  const startedAt = parseAssistantTimestamp(messageTimestamp);
  if (startedAt !== void 0 && completedAt < startedAt) {
    return void 0;
  }
  return completedAt;
}
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function base64ImageInfo(block) {
  if (!isRecord(block) || block.type !== "image") return null;
  let data;
  let mime;
  if (typeof block.data === "string") {
    data = block.data;
    mime = typeof block.mimeType === "string" ? block.mimeType : void 0;
  } else if (isRecord(block.source) && block.source.type === "base64" && typeof block.source.data === "string") {
    data = block.source.data;
    mime = typeof block.source.media_type === "string" ? block.source.media_type : void 0;
  }
  if (!data) return null;
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  return { bytes: Math.max(0, Math.floor(data.length * 3 / 4) - padding), mime };
}
function deferToolResultBase64Images(message, sessionId, entryId) {
  if (message.role !== "toolResult") return message;
  let omitted = 0;
  let bytes = 0;
  const mimes = /* @__PURE__ */ new Set();
  const content = message.content.flatMap((block, blockIndex) => {
    const image = base64ImageInfo(block);
    if (!image) return [block];
    if (sessionId && image.mime && TOOL_RESULT_IMAGE_MIMES.has(image.mime) && image.bytes > 0 && image.bytes <= MAX_TOOL_RESULT_IMAGE_BYTES) {
      const source = {
        type: "url",
        media_type: image.mime,
        url: `/api/sessions/${encodeURIComponent(sessionId)}/entries/${encodeURIComponent(entryId)}/tool-result-image?blockIndex=${blockIndex}`
      };
      return [{ type: "image", source }];
    }
    omitted += 1;
    bytes += image.bytes;
    if (image.mime) mimes.add(image.mime);
    return [];
  });
  if (omitted === 0) return { ...message, content };
  const mimeText = mimes.size > 0 ? `: ${[...mimes].join(", ")}` : "";
  content.push({
    type: "text",
    text: `[${omitted} tool result image${omitted === 1 ? "" : "s"} omitted from initial history payload${mimeText}, ~${bytes} bytes]`
  });
  return { ...message, content };
}
function entryToUiMessage(entry, options) {
  switch (entry.type) {
    case "message": {
      if (entry.message.role === "system") return null;
      let message = options.deferToolResultImages ? deferToolResultBase64Images(normalizeToolCalls(entry.message), options.sessionId, entry.id) : normalizeToolCalls(entry.message);
      const legacyContent = message.role === "assistant" ? message.content : void 0;
      if (typeof legacyContent === "string") {
        message = { ...message, content: [{ type: "text", text: legacyContent }] };
      }
      if (message.role === "assistant") {
        const completedAt = resolveAssistantCompletedAt(entry.timestamp, message.timestamp);
        if (completedAt !== void 0) {
          message = { ...message, completedAt };
        }
      }
      if (!options.deferThinking || message.role !== "assistant") return message;
      const content = message.content;
      return {
        ...message,
        content: content.map((block) => block.type === "thinking" && block.thinking.trim() !== "" ? { ...block, thinking: getThinkingPreview(block.thinking), deferred: true } : block)
      };
    }
    case "compaction":
      return {
        role: "custom",
        customType: "compaction",
        content: entry.summary,
        display: true,
        details: {
          tokensBefore: entry.tokensBefore,
          firstKeptEntryId: entry.firstKeptEntryId
        },
        timestamp: parseEntryTimestamp(entry.timestamp)
      };
    case "branch_summary":
      if (!entry.summary) return null;
      return {
        role: "user",
        content: `*The conversation briefly explored another branch and returned with this summary:*

${entry.summary}`,
        timestamp: parseEntryTimestamp(entry.timestamp)
      };
    case "custom_message":
      return {
        role: "custom",
        customType: entry.customType,
        content: entry.content,
        display: entry.display,
        details: entry.details,
        timestamp: parseEntryTimestamp(entry.timestamp)
      };
    default:
      return null;
  }
}

// lib/session-history-indexer.ts
var HistoryConflictError = class extends Error {
  constructor(message) {
    super(message);
    this.statusCode = 409;
    this.retryable = true;
    this.name = "HistoryConflictError";
  }
};
var HistoryBudgetExceededError = class extends Error {
  constructor(message) {
    super(message);
    this.statusCode = 503;
    this.retryable = true;
    this.name = "HistoryBudgetExceededError";
  }
};
var CursorNotFoundError = class extends Error {
  constructor(cursor) {
    super(`Cursor not found in session file: ${cursor}`);
    this.statusCode = 404;
    this.name = "CursorNotFoundError";
  }
};
var UnsupportedSessionVersionError = class extends Error {
  constructor(message) {
    super(message);
    this.statusCode = 500;
    this.name = "UnsupportedSessionVersionError";
  }
};
var MAX_CACHED_FILES = 4;
var MAX_TOTAL_METADATA_ENTRIES = 1e5;
var MAX_LINE_BYTES = 32 * 1024 * 1024;
var MAX_PAGE_BYTES2 = 64 * 1024 * 1024;
function extractFingerprint(stat) {
  return {
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    ino: stat.ino,
    dev: stat.dev,
    ctimeMs: stat.ctimeMs
  };
}
var SessionHistoryIndexer = class _SessionHistoryIndexer {
  constructor() {
    this.cache = /* @__PURE__ */ new Map();
    this.totalBytesRead = 0;
  }
  static {
    this.bytesReadInstrument = 0;
  }
  getCacheSize() {
    return this.cache.size;
  }
  getTotalBytesRead() {
    return this.totalBytesRead;
  }
  resetBytesRead() {
    this.totalBytesRead = 0;
  }
  getTotalMetadataCount() {
    let sum = 0;
    for (const item of this.cache.values()) {
      sum += item.entries.length;
    }
    return sum;
  }
  clearCache() {
    this.cache.clear();
  }
  isSameFingerprint(a, b) {
    return a.size === b.size && a.mtimeMs === b.mtimeMs && a.ino === b.ino && a.dev === b.dev && a.ctimeMs === b.ctimeMs;
  }
  evictLruIfNeeded(incomingCount, incomingFilePath) {
    if (incomingCount > MAX_TOTAL_METADATA_ENTRIES) {
      throw new HistoryBudgetExceededError(
        `Session history metadata budget exceeded (${incomingCount} > ${MAX_TOTAL_METADATA_ENTRIES})`
      );
    }
    while (this.cache.size >= MAX_CACHED_FILES && !this.cache.has(incomingFilePath) || this.getTotalMetadataCount() + incomingCount > MAX_TOTAL_METADATA_ENTRIES) {
      let oldestKey = null;
      let oldestTime = Infinity;
      for (const [key, item] of this.cache.entries()) {
        if (key === incomingFilePath) continue;
        if (item.lastAccessed < oldestTime) {
          oldestTime = item.lastAccessed;
          oldestKey = key;
        }
      }
      if (!oldestKey) break;
      this.cache.delete(oldestKey);
    }
    if (this.getTotalMetadataCount() + incomingCount > MAX_TOTAL_METADATA_ENTRIES) {
      throw new HistoryBudgetExceededError(
        `Session history metadata budget exceeded (${this.getTotalMetadataCount() + incomingCount} > ${MAX_TOTAL_METADATA_ENTRIES})`
      );
    }
  }
  /**
   * Scan JSONL file in bounded streaming chunks and build index.
   */
  getOrBuildIndex(filePath) {
    const existing = this.cache.get(filePath);
    if (existing) {
      let currentStat;
      try {
        currentStat = fs.statSync(filePath);
      } catch (err) {
        this.cache.delete(filePath);
        throw err;
      }
      const currentFingerprint = extractFingerprint(currentStat);
      if (this.isSameFingerprint(existing.fingerprint, currentFingerprint)) {
        existing.lastAccessed = performance.now();
        return existing;
      }
      this.cache.delete(filePath);
    }
    const index = this.scanFile(filePath);
    if (!index) throw new HistoryConflictError(`Session file modified during indexing: ${filePath}`);
    this.evictLruIfNeeded(index.entries.length, filePath);
    this.cache.set(filePath, index);
    return index;
  }
  scanFile(filePath) {
    let fd;
    try {
      fd = fs.openSync(filePath, "r");
    } catch (err) {
      const e = err;
      if (e.code === "ENOENT") {
        const customErr = new Error(`Session file not found: ${filePath}`);
        customErr.code = "ENOENT";
        throw customErr;
      }
      throw err;
    }
    try {
      const statStartFd = fs.fstatSync(fd);
      let statStartPath;
      try {
        statStartPath = fs.statSync(filePath);
      } catch {
        return null;
      }
      if (statStartFd.ino !== statStartPath.ino || statStartFd.dev !== statStartPath.dev || statStartFd.ctimeMs !== statStartPath.ctimeMs) {
        return null;
      }
      const startFingerprint = extractFingerprint(statStartFd);
      const CHUNK_SIZE = 64 * 1024;
      const buffer = Buffer.allocUnsafe(CHUNK_SIZE);
      let fileOffset = 0;
      let lineChunks = [];
      let currentLineBytes = 0;
      const entries = [];
      const byId = /* @__PURE__ */ new Map();
      let sessionVersion = 1;
      let lineIndex = 0;
      let headerCwd;
      let headerSeen = false;
      while (fileOffset < statStartFd.size) {
        const toRead = Math.min(CHUNK_SIZE, statStartFd.size - fileOffset);
        const bytesRead = fs.readSync(fd, buffer, 0, toRead, fileOffset);
        if (bytesRead === 0) break;
        _SessionHistoryIndexer.bytesReadInstrument += bytesRead;
        this.totalBytesRead += bytesRead;
        const currentChunk = buffer.subarray(0, bytesRead);
        let chunkStart = 0;
        for (let i = currentChunk.indexOf(10); i !== -1; i = currentChunk.indexOf(10, i + 1)) {
          const linePart = currentChunk.subarray(chunkStart, i);
          if (currentLineBytes + linePart.length > MAX_LINE_BYTES) {
            throw new HistoryBudgetExceededError("Session file line length exceeded 32MiB budget");
          }
          let fullLineBuf;
          if (lineChunks.length === 0) {
            fullLineBuf = linePart;
          } else {
            lineChunks.push(linePart);
            fullLineBuf = Buffer.concat(lineChunks);
            lineChunks = [];
            currentLineBytes = 0;
          }
          const lineByteOffset = fileOffset + chunkStart - (fullLineBuf.length - linePart.length);
          this.processLine(
            fullLineBuf,
            lineByteOffset,
            fullLineBuf.length,
            entries,
            byId,
            lineIndex,
            (v, cwd) => {
              sessionVersion = v;
              headerCwd = cwd;
              headerSeen = true;
            },
            headerSeen
          );
          lineIndex++;
          chunkStart = i + 1;
        }
        if (chunkStart < bytesRead) {
          const remainder = currentChunk.subarray(chunkStart, bytesRead);
          lineChunks.push(Buffer.from(remainder));
          currentLineBytes += remainder.length;
          if (currentLineBytes > MAX_LINE_BYTES) {
            throw new HistoryBudgetExceededError(
              `Session file line length exceeded 32MiB budget (${currentLineBytes} > ${MAX_LINE_BYTES})`
            );
          }
        }
        fileOffset += bytesRead;
      }
      if (lineChunks.length > 0) {
        const finalBuf = lineChunks.length === 1 ? lineChunks[0] : Buffer.concat(lineChunks);
        const lineByteOffset = fileOffset - finalBuf.length;
        this.processLine(
          finalBuf,
          lineByteOffset,
          finalBuf.length,
          entries,
          byId,
          lineIndex,
          (v, cwd) => {
            sessionVersion = v;
            headerCwd = cwd;
            headerSeen = true;
          },
          headerSeen
        );
      }
      if (!headerSeen) throw new Error("Session file has no valid session header");
      const statEndFd = fs.fstatSync(fd);
      let statEndPath;
      try {
        statEndPath = fs.statSync(filePath);
      } catch {
        return null;
      }
      const endFingerprint = extractFingerprint(statEndFd);
      if (!this.isSameFingerprint(startFingerprint, endFingerprint)) {
        return null;
      }
      const pathFingerprint = extractFingerprint(statEndPath);
      if (!this.isSameFingerprint(endFingerprint, pathFingerprint)) {
        return null;
      }
      return {
        filePath,
        fingerprint: endFingerprint,
        entries,
        byId,
        lastAccessed: performance.now(),
        version: sessionVersion,
        headerCwd
      };
    } finally {
      fs.closeSync(fd);
    }
  }
  processLine(lineBuf, offset, length, entries, byId, lineIndex, setHeaderInfo, headerAlreadySeen) {
    let lineStr = lineBuf.toString("utf8");
    if (lineStr.endsWith("\r")) {
      lineStr = lineStr.slice(0, -1);
    }
    const trimmed = lineStr.trim();
    if (!trimmed) return;
    let parsed;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return;
    }
    if (!parsed || typeof parsed !== "object") return;
    if (!headerAlreadySeen) {
      if (parsed.type !== "session" || typeof parsed.id !== "string") {
        throw new Error("First valid entry in session file must be a session header");
      }
      let version = 1;
      if (typeof parsed.version === "number") {
        version = parsed.version;
      }
      if (version > 3) {
        throw new UnsupportedSessionVersionError(
          `Session file version ${version} exceeds supported maximum version 3`
        );
      }
      const cwd = typeof parsed.cwd === "string" ? parsed.cwd : void 0;
      setHeaderInfo(version, cwd);
      return;
    }
    if (typeof parsed.id !== "string" || !parsed.id) {
      return;
    }
    if (entries.length >= MAX_TOTAL_METADATA_ENTRIES) {
      throw new HistoryBudgetExceededError(
        `Session history metadata entry budget exceeded (${entries.length + 1} > ${MAX_TOTAL_METADATA_ENTRIES})`
      );
    }
    const type = typeof parsed.type === "string" ? parsed.type : "message";
    const parentId = typeof parsed.parentId === "string" ? parsed.parentId : null;
    const metadata = sessionEntryToMetadata({ ...parsed, type, parentId });
    const meta = { ...metadata, offset, length, type };
    entries.push(meta);
    byId.set(meta.id, meta);
  }
  /**
   * Read context for active branch via seek reads.
   * Produces final JSON string directly in Worker.
   */
  async queryContext(filePath, options) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await this.querySnapshot(filePath, options);
      } catch (error) {
        if (!(error instanceof HistoryConflictError)) throw error;
        this.cache.delete(filePath);
        if (attempt === 1) throw error;
      }
    }
    throw new HistoryConflictError("Session changed repeatedly during history read");
  }
  async querySnapshot(filePath, options) {
    const index = this.getOrBuildIndex(filePath);
    if (index.version < 2) {
      throw new UnsupportedSessionVersionError("Session v1 requires migration to stable entry IDs before indexed history reads");
    }
    if (index.version === 2) {
      let rawContent;
      let fd2;
      try {
        fd2 = fs.openSync(filePath, "r");
      } catch (err) {
        const e = err;
        if (e.code === "ENOENT") {
          const customErr = new Error(`Session file not found: ${filePath}`);
          customErr.code = "ENOENT";
          throw customErr;
        }
        throw err;
      }
      try {
        const statBefore = fs.fstatSync(fd2);
        if (!this.isSameFingerprint(extractFingerprint(statBefore), index.fingerprint)) {
          throw new HistoryConflictError("Legacy session changed after indexing");
        }
        if (statBefore.size > MAX_PAGE_BYTES2) throw new HistoryBudgetExceededError("Legacy session exceeds 64MiB read budget");
        const buf = Buffer.allocUnsafe(statBefore.size);
        const bytesRead = fs.readSync(fd2, buf, 0, statBefore.size, 0);
        _SessionHistoryIndexer.bytesReadInstrument += bytesRead;
        this.totalBytesRead += bytesRead;
        const statAfter = fs.fstatSync(fd2);
        if (bytesRead !== statBefore.size || !this.isSameFingerprint(extractFingerprint(statBefore), extractFingerprint(statAfter)) || !this.isSameFingerprint(extractFingerprint(statAfter), extractFingerprint(fs.statSync(filePath)))) {
          throw new HistoryConflictError(`Legacy session file changed during read: ${filePath}`);
        }
        rawContent = buf.subarray(0, bytesRead).toString("utf8");
      } finally {
        fs.closeSync(fd2);
      }
      const lines = rawContent.split("\n");
      const rawEntries = [];
      for (const l of lines) {
        const trimmed = l.trim();
        if (!trimmed) continue;
        try {
          rawEntries.push(JSON.parse(trimmed));
        } catch {
        }
      }
      const { SessionManager } = await import("@earendil-works/pi-coding-agent");
      const sm = SessionManager.inMemory(index.headerCwd || process.cwd(), void 0, rawEntries);
      const entries = sm.getEntries();
      const cursor = options.before ?? options.leafId;
      if (options.requireCursor && cursor && !entries.some((entry) => entry.id === cursor)) {
        throw new CursorNotFoundError(cursor);
      }
      const context2 = buildSessionContext(entries, options.leafId, {
        tail: options.tail,
        excludeLeaf: Boolean(options.before),
        before: options.before,
        deferThinking: options.deferThinking,
        deferToolResultImages: options.deferToolResultImages,
        sessionId: options.sessionId
      });
      return JSON.stringify({
        context: context2,
        tail: options.tail ?? 50,
        before: options.before ?? null
      });
    }
    const { leafId, tail = 50, before, deferThinking, deferToolResultImages, sessionId, requireCursor } = options;
    const effectiveCursor = before !== void 0 && before !== null ? before : leafId === null ? null : leafId ?? void 0;
    if (requireCursor && effectiveCursor && !index.byId.has(effectiveCursor)) {
      throw new CursorNotFoundError(effectiveCursor);
    }
    const startNode = effectiveCursor ? index.byId.get(effectiveCursor) : effectiveCursor === null ? void 0 : index.entries[index.entries.length - 1];
    const byId = index.byId;
    const branchSettings = resolveBranchSettingsFromChain(
      startNode,
      (node) => node.parentId ? byId.get(node.parentId) : void 0
    );
    const pageMetaChain = effectiveCursor === null ? [] : traverseAncestorChain(
      startNode,
      (node) => node.parentId ? byId.get(node.parentId) : void 0,
      tail,
      Boolean(before),
      rawWindowCap(tail)
    );
    let totalPageBytes = 0;
    for (const meta of pageMetaChain) {
      totalPageBytes += meta.length;
    }
    if (totalPageBytes > MAX_PAGE_BYTES2) {
      throw new HistoryBudgetExceededError(
        `Session page bytes exceed 64MiB budget (${totalPageBytes} > ${MAX_PAGE_BYTES2})`
      );
    }
    if (pageMetaChain.length === 0) {
      const emptyContext = {
        messages: [],
        entryIds: [],
        oldestEntryId: null,
        hasMore: false,
        thinkingLevel: branchSettings.thinkingLevel,
        model: branchSettings.model
      };
      return JSON.stringify({
        context: emptyContext,
        tail,
        before: before ?? null
      });
    }
    const pageEntries = [];
    const fd = fs.openSync(filePath, "r");
    try {
      const beforeFd = extractFingerprint(fs.fstatSync(fd));
      let beforePath;
      try {
        beforePath = extractFingerprint(fs.statSync(filePath));
      } catch {
        throw new HistoryConflictError("Session path replaced before seek read");
      }
      if (!this.isSameFingerprint(beforeFd, index.fingerprint) || !this.isSameFingerprint(beforeFd, beforePath)) {
        throw new HistoryConflictError("Session changed after indexing");
      }
      for (const meta of pageMetaChain) {
        let buf = Buffer.allocUnsafe(meta.length);
        const hooked = this.seekReadHook?.(meta.offset, meta.length);
        const bytesRead = hooked ? (buf = hooked).length : fs.readSync(fd, buf, 0, meta.length, meta.offset);
        _SessionHistoryIndexer.bytesReadInstrument += bytesRead;
        this.totalBytesRead += bytesRead;
        if (bytesRead !== meta.length) {
          throw new HistoryConflictError("Short session page read");
        }
        let entry;
        try {
          entry = JSON.parse(buf.toString("utf8"));
        } catch {
          throw new HistoryConflictError("Session entry changed during seek read");
        }
        if (!entry || entry.id !== meta.id || entry.parentId !== meta.parentId) {
          throw new HistoryConflictError("Session entry identity changed during seek read");
        }
        pageEntries.push(entry);
      }
      const afterFd = extractFingerprint(fs.fstatSync(fd));
      let afterPath;
      try {
        afterPath = extractFingerprint(fs.statSync(filePath));
      } catch {
        throw new HistoryConflictError("Session path replaced during seek read");
      }
      if (!this.isSameFingerprint(beforeFd, afterFd) || !this.isSameFingerprint(afterFd, afterPath)) {
        throw new HistoryConflictError("Session changed during seek read");
      }
    } finally {
      fs.closeSync(fd);
    }
    const contextOptions = {
      deferThinking,
      deferToolResultImages,
      sessionId,
      tail,
      excludeLeaf: Boolean(before),
      before: before ?? null
    };
    const messages = [];
    const entryIds = [];
    for (const entry of pageEntries) {
      const m = entryToUiMessage(entry, contextOptions);
      if (m) {
        messages.push(m);
        entryIds.push(entry.id);
      }
    }
    const oldestEntryId = pageEntries[0]?.id ?? null;
    const hasMore = Boolean(tail && tail > 0 && pageMetaChain[0]?.parentId);
    const context = {
      messages,
      entryIds,
      oldestEntryId,
      hasMore,
      thinkingLevel: branchSettings.thinkingLevel,
      model: branchSettings.model
    };
    return JSON.stringify({
      context,
      tail,
      before: before ?? null
    });
  }
};

// lib/session-history-worker-entry.ts
if (!import_worker_threads.parentPort) {
  throw new Error("session-history-worker must be run inside a Worker thread.");
}
var indexer = new SessionHistoryIndexer();
var cancelledIds = /* @__PURE__ */ new Set();
import_worker_threads.parentPort.on("message", async (msg) => {
  if (!msg || typeof msg.id !== "number") return;
  if (msg.type === "cancel") {
    cancelledIds.add(msg.id);
    return;
  }
  if (msg.type === "queryContext" && msg.filePath) {
    if (cancelledIds.has(msg.id)) {
      cancelledIds.delete(msg.id);
      return;
    }
    try {
      const jsonString = await indexer.queryContext(msg.filePath, msg.options || {});
      if (cancelledIds.has(msg.id)) {
        cancelledIds.delete(msg.id);
        return;
      }
      const fingerprint = msg.options?.includeFingerprint && Buffer.byteLength(jsonString, "utf8") <= MAX_PAGE_BYTES ? (0, import_node_crypto.createHash)("sha256").update(HISTORY_CACHE_SCOPE).update(jsonString, "utf8").digest("hex") : null;
      const response = {
        id: msg.id,
        success: true,
        // A HEAD never transfers the multi-MiB body back onto the main thread.
        jsonString: msg.options?.fingerprintOnly ? "" : jsonString,
        fingerprint
      };
      import_worker_threads.parentPort.postMessage(response);
    } catch (rawErr) {
      if (cancelledIds.has(msg.id)) {
        cancelledIds.delete(msg.id);
        return;
      }
      const err = rawErr;
      let statusCode = err?.statusCode;
      if (!statusCode) {
        if (rawErr instanceof HistoryConflictError) statusCode = 409;
        else if (rawErr instanceof HistoryBudgetExceededError) statusCode = 503;
        else if (rawErr instanceof CursorNotFoundError) statusCode = 404;
        else if (rawErr instanceof UnsupportedSessionVersionError) statusCode = 500;
        else statusCode = 500;
      }
      const response = {
        id: msg.id,
        success: false,
        error: {
          message: err?.message || String(rawErr),
          name: err?.name || "Error",
          statusCode,
          retryable: Boolean(err?.retryable),
          code: err?.code
        }
      };
      import_worker_threads.parentPort.postMessage(response);
    }
  }
});
