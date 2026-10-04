import * as fs from "fs";
import type { SessionEntry, SessionContext, AgentMessage } from "./types";
import {
  entryToUiMessage,
  rawWindowCap,
  type BuildSessionContextOptions,
  buildSessionContext,
  traverseAncestorChain,
  resolveBranchSettingsFromChain,
  type BranchNodeMetadata,
  sessionEntryToMetadata,
} from "./session-context";

type SessionManagerModule = typeof import("@earendil-works/pi-coding-agent");
const importSessionManagerNative = new Function("specifier", "return import(specifier)") as (specifier: string) => Promise<SessionManagerModule>;

export class HistoryConflictError extends Error {
  statusCode = 409;
  retryable = true;
  constructor(message: string) {
    super(message);
    this.name = "HistoryConflictError";
  }
}

export class HistoryBudgetExceededError extends Error {
  statusCode = 503;
  retryable = true;
  constructor(message: string) {
    super(message);
    this.name = "HistoryBudgetExceededError";
  }
}

export class CursorNotFoundError extends Error {
  statusCode = 404;
  constructor(cursor: string) {
    super(`Cursor not found in session file: ${cursor}`);
    this.name = "CursorNotFoundError";
  }
}

export class UnsupportedSessionVersionError extends Error {
  statusCode = 500;
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedSessionVersionError";
  }
}

export interface FileFingerprint {
  size: number;
  mtimeMs: number;
  ino: number;
  dev: number;
  ctimeMs: number;
}

export interface EntryMeta extends BranchNodeMetadata {
  id: string;
  parentId: string | null;
  offset: number;
  length: number;
  type: string;
  role?: string;
  countsTowardTail: boolean;
  modelChange?: { provider: string; modelId: string };
  thinkingLevel?: string;
  assistantModel?: { provider: string; modelId: string };
}

export interface FileIndex {
  filePath: string;
  fingerprint: FileFingerprint;
  entries: EntryMeta[];
  byId: Map<string, EntryMeta>;
  lastAccessed: number;
  version: number;
  headerCwd?: string;
}

const MAX_CACHED_FILES = 4;
const MAX_TOTAL_METADATA_ENTRIES = 100_000;
const MAX_LINE_BYTES = 32 * 1024 * 1024; // 32MiB
const MAX_PAGE_BYTES = 64 * 1024 * 1024; // 64MiB

function extractFingerprint(stat: fs.Stats): FileFingerprint {
  return {
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    ino: stat.ino,
    dev: stat.dev,
    ctimeMs: stat.ctimeMs,
  };
}

export class SessionHistoryIndexer {
  private cache = new Map<string, FileIndex>();
  public static bytesReadInstrument = 0;
  private totalBytesRead = 0;
  public seekReadHook?: (offset: number, length: number) => Buffer | null;

  public getCacheSize(): number {
    return this.cache.size;
  }

  public getTotalBytesRead(): number {
    return this.totalBytesRead;
  }

  public resetBytesRead(): void {
    this.totalBytesRead = 0;
  }

  public getTotalMetadataCount(): number {
    let sum = 0;
    for (const item of this.cache.values()) {
      sum += item.entries.length;
    }
    return sum;
  }

  public clearCache(): void {
    this.cache.clear();
  }

  public isSameFingerprint(a: FileFingerprint, b: FileFingerprint): boolean {
    return (
      a.size === b.size &&
      a.mtimeMs === b.mtimeMs &&
      a.ino === b.ino &&
      a.dev === b.dev &&
      a.ctimeMs === b.ctimeMs
    );
  }

  private evictLruIfNeeded(incomingCount: number, incomingFilePath: string): void {
    if (incomingCount > MAX_TOTAL_METADATA_ENTRIES) {
      throw new HistoryBudgetExceededError(
        `Session history metadata budget exceeded (${incomingCount} > ${MAX_TOTAL_METADATA_ENTRIES})`,
      );
    }

    while (
      (this.cache.size >= MAX_CACHED_FILES && !this.cache.has(incomingFilePath)) ||
      this.getTotalMetadataCount() + incomingCount > MAX_TOTAL_METADATA_ENTRIES
    ) {
      let oldestKey: string | null = null;
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
        `Session history metadata budget exceeded (${this.getTotalMetadataCount() + incomingCount} > ${MAX_TOTAL_METADATA_ENTRIES})`,
      );
    }
  }

  /**
   * Scan JSONL file in bounded streaming chunks and build index.
   */
  public getOrBuildIndex(filePath: string): FileIndex {
    const existing = this.cache.get(filePath);
    if (existing) {
      let currentStat: fs.Stats;
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

  private scanFile(filePath: string): FileIndex | null {
    let fd: number;
    try {
      fd = fs.openSync(filePath, "r");
    } catch (err: unknown) {
      const e = err as NodeJS.ErrnoException;
      if (e.code === "ENOENT") {
        const customErr = new Error(`Session file not found: ${filePath}`);
        (customErr as { code?: string }).code = "ENOENT";
        throw customErr;
      }
      throw err;
    }

    try {
      const statStartFd = fs.fstatSync(fd);
      let statStartPath: fs.Stats;
      try {
        statStartPath = fs.statSync(filePath);
      } catch {
        return null;
      }

      if (
        statStartFd.ino !== statStartPath.ino ||
        statStartFd.dev !== statStartPath.dev ||
        statStartFd.ctimeMs !== statStartPath.ctimeMs
      ) {
        return null; // Inode replacement detected
      }

      const startFingerprint = extractFingerprint(statStartFd);

      const CHUNK_SIZE = 64 * 1024;
      const buffer = Buffer.allocUnsafe(CHUNK_SIZE);
      let fileOffset = 0;
      let lineChunks: Buffer[] = [];
      let currentLineBytes = 0;

      const entries: EntryMeta[] = [];
      const byId = new Map<string, EntryMeta>();
      let sessionVersion = 1; // Default to v1 if no version specified
      let lineIndex = 0;
      let headerCwd: string | undefined;
      let headerSeen = false;

      while (fileOffset < statStartFd.size) {
        const toRead = Math.min(CHUNK_SIZE, statStartFd.size - fileOffset);
        const bytesRead = fs.readSync(fd, buffer, 0, toRead, fileOffset);
        if (bytesRead === 0) break;
        SessionHistoryIndexer.bytesReadInstrument += bytesRead;
        this.totalBytesRead += bytesRead;

        const currentChunk = buffer.subarray(0, bytesRead);
        let chunkStart = 0;

        // Native byte search avoids a JS operation for every byte of huge
        // tool payloads. Offsets remain byte-based, including multibyte UTF-8.
        for (let i = currentChunk.indexOf(0x0a); i !== -1; i = currentChunk.indexOf(0x0a, i + 1)) {
          const linePart = currentChunk.subarray(chunkStart, i);
          if (currentLineBytes + linePart.length > MAX_LINE_BYTES) {
            throw new HistoryBudgetExceededError("Session file line length exceeded 32MiB budget");
          }
          let fullLineBuf: Buffer;
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
            headerSeen,
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
              `Session file line length exceeded 32MiB budget (${currentLineBytes} > ${MAX_LINE_BYTES})`,
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
          headerSeen,
        );
      }

      if (!headerSeen) throw new Error("Session file has no valid session header");
      const statEndFd = fs.fstatSync(fd);
      let statEndPath: fs.Stats;
      try {
        statEndPath = fs.statSync(filePath);
      } catch {
        return null;
      }

      const endFingerprint = extractFingerprint(statEndFd);
      if (!this.isSameFingerprint(startFingerprint, endFingerprint)) {
        return null; // Concurrent modification detected
      }

      const pathFingerprint = extractFingerprint(statEndPath);
      if (!this.isSameFingerprint(endFingerprint, pathFingerprint)) {
        return null; // Inode replaced or modified during scan
      }

      return {
        filePath,
        fingerprint: endFingerprint,
        entries,
        byId,
        lastAccessed: performance.now(),
        version: sessionVersion,
        headerCwd,
      };
    } finally {
      fs.closeSync(fd);
    }
  }

  private processLine(
    lineBuf: Buffer,
    offset: number,
    length: number,
    entries: EntryMeta[],
    byId: Map<string, EntryMeta>,
    lineIndex: number,
    setHeaderInfo: (version: number, cwd?: string) => void,
    headerAlreadySeen: boolean,
  ): void {
    let lineStr = lineBuf.toString("utf8");
    if (lineStr.endsWith("\r")) {
      lineStr = lineStr.slice(0, -1);
    }
    const trimmed = lineStr.trim();
    if (!trimmed) return;

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      // Ignore malformed lines in scan
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
          `Session file version ${version} exceeds supported maximum version 3`,
        );
      }
      const cwd = typeof parsed.cwd === "string" ? parsed.cwd : undefined;
      setHeaderInfo(version, cwd);
      return;
    }

    if (typeof parsed.id !== "string" || !parsed.id) {
      return;
    }

    // Budget check on metadata entry accumulation to prevent OOM
    if (entries.length >= MAX_TOTAL_METADATA_ENTRIES) {
      throw new HistoryBudgetExceededError(
        `Session history metadata entry budget exceeded (${entries.length + 1} > ${MAX_TOTAL_METADATA_ENTRIES})`,
      );
    }

    const type = typeof parsed.type === "string" ? parsed.type : "message";
    const parentId = typeof parsed.parentId === "string" ? parsed.parentId : null;

    const metadata = sessionEntryToMetadata({ ...parsed, type, parentId } as unknown as SessionEntry);
    const meta: EntryMeta = { ...metadata, offset, length, type };

    entries.push(meta);
    byId.set(meta.id, meta);
  }

  /**
   * Read context for active branch via seek reads.
   * Produces final JSON string directly in Worker.
   */
  public async queryContext(
    filePath: string,
    options: {
      leafId?: string | null;
      onlyEntry?: boolean;
      tail?: number;
      before?: string | null;
      deferThinking?: boolean;
      deferToolResultImages?: boolean;
      sessionId?: string;
      requireCursor?: boolean;
    },
  ): Promise<string> {
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

  private async querySnapshot(
    filePath: string,
    options: Parameters<SessionHistoryIndexer["queryContext"]>[1],
  ): Promise<string> {
    const index = this.getOrBuildIndex(filePath);

    // v1 has no persistent entry IDs. SDK migration invents random IDs, so
    // rebuilding it per request silently breaks pagination and entry URLs.
    // Never mutate history to migrate it during a read request.
    if (index.version < 2) {
      throw new UnsupportedSessionVersionError("Session v1 requires migration to stable entry IDs before indexed history reads");
    }

    // v2 keeps stable IDs; SDK role migration is isolated and read-only.
    if (index.version === 2) {
      let rawContent: string;
      let fd: number;
      try {
        fd = fs.openSync(filePath, "r");
      } catch (err: unknown) {
        const e = err as NodeJS.ErrnoException;
        if (e.code === "ENOENT") {
          const customErr = new Error(`Session file not found: ${filePath}`);
          (customErr as { code?: string }).code = "ENOENT";
          throw customErr;
        }
        throw err;
      }

      try {
        const statBefore = fs.fstatSync(fd);
        if (!this.isSameFingerprint(extractFingerprint(statBefore), index.fingerprint)) {
          throw new HistoryConflictError("Legacy session changed after indexing");
        }
        if (statBefore.size > MAX_PAGE_BYTES) throw new HistoryBudgetExceededError("Legacy session exceeds 64MiB read budget");
        const buf = Buffer.allocUnsafe(statBefore.size);
        const bytesRead = fs.readSync(fd, buf, 0, statBefore.size, 0);
        SessionHistoryIndexer.bytesReadInstrument += bytesRead;
        this.totalBytesRead += bytesRead;
        const statAfter = fs.fstatSync(fd);
        if (bytesRead !== statBefore.size ||
          !this.isSameFingerprint(extractFingerprint(statBefore), extractFingerprint(statAfter)) ||
          !this.isSameFingerprint(extractFingerprint(statAfter), extractFingerprint(fs.statSync(filePath)))) {
          throw new HistoryConflictError(`Legacy session file changed during read: ${filePath}`);
        }
        rawContent = buf.subarray(0, bytesRead).toString("utf8");
      } finally {
        fs.closeSync(fd);
      }

      const lines = rawContent.split("\n");
      const rawEntries: unknown[] = [];
      for (const l of lines) {
        const trimmed = l.trim();
        if (!trimmed) continue;
        try {
          rawEntries.push(JSON.parse(trimmed));
        } catch {
          // Fault tolerant against bad tail; read-only
        }
      }

      const { SessionManager } = await importSessionManagerNative("@earendil-works/pi-coding-agent");
      const sm = SessionManager.inMemory(index.headerCwd || process.cwd(), undefined, rawEntries as never);
      const entries = sm.getEntries() as unknown as SessionEntry[];
      const cursor = options.before ?? options.leafId;
      if (options.requireCursor && cursor && !entries.some((entry) => entry.id === cursor)) {
        throw new CursorNotFoundError(cursor);
      }
      const contextEntries = options.onlyEntry ? entries.filter(entry => entry.id === options.leafId) : entries;
      const context = buildSessionContext(contextEntries, options.leafId, {
        tail: options.tail,
        excludeLeaf: Boolean(options.before),
        before: options.before,
        deferThinking: options.deferThinking,
        deferToolResultImages: options.deferToolResultImages,
        sessionId: options.sessionId,
      });

      return JSON.stringify({
        context,
        tail: options.tail ?? 50,
        before: options.before ?? null,
      });
    }

    const { leafId, tail = 50, before, deferThinking, deferToolResultImages, sessionId, requireCursor } = options;

    // before overrides leafId=null
    const effectiveCursor = (before !== undefined && before !== null)
      ? before
      : (leafId === null ? null : (leafId ?? undefined));

    if (requireCursor && effectiveCursor && !index.byId.has(effectiveCursor)) {
      throw new CursorNotFoundError(effectiveCursor);
    }

    const startNode = effectiveCursor
      ? index.byId.get(effectiveCursor)
      : (effectiveCursor === null ? undefined : index.entries[index.entries.length - 1]);

    const byId = index.byId;

    // 1. Resolve settings from effectiveCursor upward directly via shared function
    const branchSettings = resolveBranchSettingsFromChain(
      startNode,
      (node) => (node.parentId ? byId.get(node.parentId) : undefined),
    );

    // 2. Traverse ancestor chain for page entries using shared function
    const pageMetaChain = options.onlyEntry ? (startNode ? [startNode] : []) : effectiveCursor === null ? [] : traverseAncestorChain(
      startNode,
      (node) => (node.parentId ? byId.get(node.parentId) : undefined),
      tail,
      Boolean(before),
      rawWindowCap(tail),
    );

    // 3. Enforce 64MiB page budget
    let totalPageBytes = 0;
    for (const meta of pageMetaChain) {
      totalPageBytes += meta.length;
    }
    if (totalPageBytes > MAX_PAGE_BYTES) {
      throw new HistoryBudgetExceededError(
        `Session page bytes exceed 64MiB budget (${totalPageBytes} > ${MAX_PAGE_BYTES})`,
      );
    }

    if (pageMetaChain.length === 0) {
      // Empty context result: settings are preserved even when excludeLeaf makes page empty
      const emptyContext: SessionContext = {
        messages: [],
        entryIds: [],
        oldestEntryId: null,
        hasMore: false,
        thinkingLevel: branchSettings.thinkingLevel,
        model: branchSettings.model,
      };
      return JSON.stringify({
        context: emptyContext,
        tail,
        before: before ?? null,
      });
    }

    // 4. Read one snapshot. Conflicts restart cursor/settings/offsets together
    // in queryContext; there is no nested retry with stale branch metadata.
    const pageEntries: SessionEntry[] = [];
    const fd = fs.openSync(filePath, "r");
    try {
      const beforeFd = extractFingerprint(fs.fstatSync(fd));
      let beforePath: FileFingerprint;
      try {
        beforePath = extractFingerprint(fs.statSync(filePath));
      } catch {
        throw new HistoryConflictError("Session path replaced before seek read");
      }
      if (!this.isSameFingerprint(beforeFd, index.fingerprint) ||
          !this.isSameFingerprint(beforeFd, beforePath)) {
        throw new HistoryConflictError("Session changed after indexing");
      }

      for (const meta of pageMetaChain) {
        let buf: Buffer<ArrayBufferLike> = Buffer.allocUnsafe(meta.length);
        const hooked = this.seekReadHook?.(meta.offset, meta.length);
        const bytesRead = hooked
          ? (buf = hooked).length
          : fs.readSync(fd, buf, 0, meta.length, meta.offset);
        SessionHistoryIndexer.bytesReadInstrument += bytesRead;
        this.totalBytesRead += bytesRead;
        if (bytesRead !== meta.length) {
          throw new HistoryConflictError("Short session page read");
        }

        let entry: SessionEntry;
        try {
          entry = JSON.parse(buf.toString("utf8")) as SessionEntry;
        } catch {
          throw new HistoryConflictError("Session entry changed during seek read");
        }
        if (!entry || entry.id !== meta.id || entry.parentId !== meta.parentId) {
          throw new HistoryConflictError("Session entry identity changed during seek read");
        }
        pageEntries.push(entry);
      }

      const afterFd = extractFingerprint(fs.fstatSync(fd));
      let afterPath: FileFingerprint;
      try {
        afterPath = extractFingerprint(fs.statSync(filePath));
      } catch {
        throw new HistoryConflictError("Session path replaced during seek read");
      }
      if (!this.isSameFingerprint(beforeFd, afterFd) ||
          !this.isSameFingerprint(afterFd, afterPath)) {
        throw new HistoryConflictError("Session changed during seek read");
      }
    } finally {
      fs.closeSync(fd);
    }

    // 5. Project entries to UI messages
    const contextOptions: BuildSessionContextOptions = {
      deferThinking,
      deferToolResultImages,
      sessionId,
      tail,
      excludeLeaf: Boolean(before),
      before: before ?? null,
    };

    const messages: AgentMessage[] = [];
    const entryIds: string[] = [];

    for (const entry of pageEntries) {
      const m = entryToUiMessage(entry, contextOptions);
      if (m) {
        messages.push(m);
        entryIds.push(entry.id);
      }
    }

    const oldestEntryId = pageEntries[0]?.id ?? null;
    const hasMore = Boolean(tail && tail > 0 && pageMetaChain[0]?.parentId);

    const context: SessionContext = {
      messages,
      entryIds,
      oldestEntryId,
      hasMore,
      thinkingLevel: branchSettings.thinkingLevel,
      model: branchSettings.model,
    };

    return JSON.stringify({
      context,
      tail,
      before: before ?? null,
    });
  }
}
