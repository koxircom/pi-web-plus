import { parentPort } from "worker_threads";
import { createHash } from "node:crypto";
import { HISTORY_CACHE_SCOPE, MAX_PAGE_BYTES } from "./session-history-page-cache";
import {
  SessionHistoryIndexer,
  HistoryConflictError,
  HistoryBudgetExceededError,
  CursorNotFoundError,
  UnsupportedSessionVersionError,
} from "./session-history-indexer";
import type { QueryContextWorkerOptions, WorkerResponseMessage } from "./session-history-pool";

if (!parentPort) {
  throw new Error("session-history-worker must be run inside a Worker thread.");
}

const indexer = new SessionHistoryIndexer();
const cancelledIds = new Set<number>();

interface IncomingWorkerMessage {
  id: number;
  type: string;
  filePath?: string;
  options?: QueryContextWorkerOptions;
}

parentPort.on("message", async (msg: IncomingWorkerMessage) => {
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
      const fingerprint = msg.options?.includeFingerprint && Buffer.byteLength(jsonString, "utf8") <= MAX_PAGE_BYTES
        ? createHash("sha256").update(HISTORY_CACHE_SCOPE).update(jsonString, "utf8").digest("hex")
        : null;
      const response: WorkerResponseMessage = {
        id: msg.id,
        success: true,
        // A HEAD never transfers the multi-MiB body back onto the main thread.
        jsonString: msg.options?.fingerprintOnly ? "" : jsonString,
        fingerprint,
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
    }
  }
});
