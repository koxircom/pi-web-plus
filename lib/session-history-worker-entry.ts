import { parentPort, workerData } from "node:worker_threads";
import { createHash } from "node:crypto";
import { statSync } from "node:fs";
import { HISTORY_CACHE_SCOPE, MAX_PAGE_BYTES } from "./session-history-page-cache";
import { fileFingerprint } from "./session-revision";
import { buildSessionDetailSnapshot } from "./session-detail-snapshot";
import { SessionDetailManagerCache } from "./session-detail-manager-cache";
import {
  SessionHistoryIndexer,
  HistoryConflictError,
  HistoryBudgetExceededError,
  CursorNotFoundError,
  UnsupportedSessionVersionError,
} from "./session-history-indexer";
import type {
  QueryContextWorkerOptions,
  QuerySessionDetailWorkerOptions,
  WorkerResponseMessage,
} from "./session-history-pool";

type SessionManagerModule = typeof import("@earendil-works/pi-coding-agent");
type SessionManagerInstance = ReturnType<SessionManagerModule["SessionManager"]["open"]>;

if (!parentPort) {
  throw new Error("session-history-worker must be run inside a Worker thread.");
}

const MAX_DETAIL_MANAGER_CACHE_BYTES = 64 * 1024 * 1024;
const cacheBudgetFromPool = Number((workerData as { detailManagerCacheBudgetBytes?: unknown } | null)?.detailManagerCacheBudgetBytes);
const detailManagerCache = new SessionDetailManagerCache<SessionManagerInstance>({
  maxEntries: 12,
  maxTotalBytes: Number.isFinite(cacheBudgetFromPool)
    ? Math.min(MAX_DETAIL_MANAGER_CACHE_BYTES, Math.max(0, cacheBudgetFromPool))
    : 0,
  maxFileBytes: MAX_DETAIL_MANAGER_CACHE_BYTES,
});

const indexer = new SessionHistoryIndexer();
const cancelledIds = new Set<number>();
let queryInFlight = false;

// The shipped worker is CommonJS while the SDK is ESM-only. Keep this as a
// native runtime import inside a function so the CommonJS bundle does not
// rewrite it to require(), and context-only reads never load the SDK.
const nativeImport = new Function("specifier", "return import(specifier)") as (specifier: string) => Promise<SessionManagerModule>;
let sessionManagerModulePromise: Promise<SessionManagerModule> | undefined;

function loadSessionManagerModule(): Promise<SessionManagerModule> {
  if (!sessionManagerModulePromise) {
    let loading!: Promise<SessionManagerModule>;
    loading = nativeImport("@earendil-works/pi-coding-agent").catch((error: unknown) => {
      if (sessionManagerModulePromise === loading) sessionManagerModulePromise = undefined;
      throw error;
    });
    sessionManagerModulePromise = loading;
  }
  return sessionManagerModulePromise;
}

interface IncomingWorkerMessage {
  id: number;
  type: string;
  filePath?: string;
  options?: QueryContextWorkerOptions | QuerySessionDetailWorkerOptions;
}

parentPort.on("message", async (msg: IncomingWorkerMessage) => {
  if (!msg || typeof msg.id !== "number") return;

  if (msg.type === "cancel") {
    cancelledIds.add(msg.id);
    return;
  }

  if ((msg.type === "queryContext" || msg.type === "querySessionDetail") && msg.filePath) {
    if (cancelledIds.has(msg.id)) {
      cancelledIds.delete(msg.id);
      return;
    }
    // SessionHistoryPool dispatches one task per Worker. Keep that invariant
    // explicit because detail's native ESM import yields to the message loop.
    if (queryInFlight) {
      const response: WorkerResponseMessage = {
        id: msg.id,
        success: false,
        error: {
          message: "会话历史 Worker 已有正在处理的请求。",
          statusCode: 503,
          retryable: true,
        },
      };
      parentPort!.postMessage(response);
      return;
    }
    queryInFlight = true;

    try {
      let jsonString: string;
      let detailFingerprint: string | null = null;
      if (msg.type === "queryContext") {
        jsonString = await indexer.queryContext(msg.filePath, msg.options as QueryContextWorkerOptions || {});
      } else {
        const options = msg.options as QuerySessionDetailWorkerOptions;
        const { SessionManager } = await loadSessionManagerModule();
        // A cancel can arrive while the ESM module is being loaded. Do not
        // open or project a manager for work that the pool has already dropped.
        if (cancelledIds.has(msg.id)) {
          cancelledIds.delete(msg.id);
          return;
        }
        const fingerprint = fileFingerprint(msg.filePath);
        let fileBytes: number;
        try {
          fileBytes = statSync(msg.filePath).size;
        } catch (error) {
          detailManagerCache.delete(msg.filePath);
          throw error;
        }
        const sessionManager = detailManagerCache.get(msg.filePath, fingerprint, fileBytes)
          ?? SessionManager.open(msg.filePath);
        const snapshot = buildSessionDetailSnapshot(sessionManager, {
          filePath: msg.filePath,
          sessionId: options.sessionId,
          sourceId: options.sourceId,
          summaryTree: options.summaryTree,
          deferToolResults: options.deferToolResults,
          deferThinking: options.deferThinking,
          deferToolResultImages: options.deferToolResultImages,
          tail: options.tail,
          fingerprint,
        });
        if (fingerprint !== fileFingerprint(msg.filePath)) {
          detailManagerCache.delete(msg.filePath);
          throw new HistoryConflictError("构建会话详情期间，会话文件发生变化，请重试。");
        }
        detailFingerprint = fingerprint;
        detailManagerCache.set(msg.filePath, fingerprint, fileBytes, sessionManager);
        jsonString = JSON.stringify(snapshot);
      }
      if (cancelledIds.has(msg.id)) {
        cancelledIds.delete(msg.id);
        return;
      }
      const contextOptions = msg.type === "queryContext"
        ? msg.options as QueryContextWorkerOptions | undefined
        : undefined;
      const responseFingerprint = contextOptions?.includeFingerprint && Buffer.byteLength(jsonString, "utf8") <= MAX_PAGE_BYTES
        ? createHash("sha256").update(HISTORY_CACHE_SCOPE).update(jsonString, "utf8").digest("hex")
        : detailFingerprint;
      const response: WorkerResponseMessage = {
        id: msg.id,
        success: true,
        // A HEAD never transfers the multi-MiB body back onto the main thread.
        jsonString: contextOptions?.fingerprintOnly ? "" : jsonString,
        fingerprint: responseFingerprint,
      };
      parentPort!.postMessage(response);
    } catch (rawErr: unknown) {
      if (cancelledIds.has(msg.id)) {
        cancelledIds.delete(msg.id);
        return;
      }
      const err = rawErr as {
        message?: string;
        name?: string;
        statusCode?: number;
        retryable?: boolean;
        code?: string;
      };

      let statusCode = err?.statusCode;
      if (!statusCode) {
        if (rawErr instanceof HistoryConflictError) statusCode = 409;
        else if (rawErr instanceof HistoryBudgetExceededError) statusCode = 503;
        else if (rawErr instanceof CursorNotFoundError) statusCode = 404;
        else if (rawErr instanceof UnsupportedSessionVersionError) statusCode = 500;
        else statusCode = 500;
      }

      const response: WorkerResponseMessage = {
        id: msg.id,
        success: false,
        error: {
          message: err?.message || String(rawErr),
          name: err?.name || "Error",
          statusCode,
          retryable: Boolean(err?.retryable),
          code: err?.code,
        },
      };
      parentPort!.postMessage(response);
    } finally {
      queryInFlight = false;
    }
  }
});
