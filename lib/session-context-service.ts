import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { resolveSessionPath, buildSessionContext } from "./session-reader";
import { getRpcSession } from "./rpc-manager";
import { getSessionHistoryPool, SessionHistoryPool } from "./session-history-pool";
import {
  HISTORY_CACHE_PROTOCOL_HEADER,
  HISTORY_FINGERPRINT_HEADER,
  HISTORY_CACHE_PROTOCOL_VERSION,
  HISTORY_CACHE_SCOPE,
  MAX_PAGE_BYTES,
} from "./session-history-page-cache.ts";

export {
  HISTORY_CACHE_PROTOCOL_HEADER,
  HISTORY_FINGERPRINT_HEADER,
  HISTORY_CACHE_PROTOCOL_VERSION,
  HISTORY_CACHE_SCOPE,
};

export function computeHistoryPageFingerprint(jsonBytesOrString: string | Uint8Array): string {
  const hash = createHash("sha256");
  hash.update(HISTORY_CACHE_SCOPE);
  hash.update(typeof jsonBytesOrString === "string" ? Buffer.from(jsonBytesOrString, "utf-8") : jsonBytesOrString);
  return hash.digest("hex");
}

export interface SessionContextServiceDependencies {
  pool?: SessionHistoryPool;
  getRpc?: typeof getRpcSession;
  resolvePath?: typeof resolveSessionPath;
}

export async function handleSessionContextRequest(
  req: Request,
  params: { id: string },
  deps: SessionContextServiceDependencies = {},
): Promise<Response> {
  const { id } = params;
  const method = req.method ? req.method.toUpperCase() : "GET";
  if (method !== "GET" && method !== "HEAD") {
    return new Response(null, { status: 405, headers: { Allow: "GET, HEAD" } });
  }

  const url = new URL(req.url);
  const leafId = url.searchParams.get("leafId") ?? undefined;
  const deferThinking = url.searchParams.has("deferThinking");
  const deferToolResultImages = url.searchParams.has("deferMedia");
  const rawTail = Number(url.searchParams.get("tail"));
  const tail = Number.isFinite(rawTail) && rawTail > 0 ? Math.min(rawTail, 1000) : 50;
  const before = url.searchParams.get("before") ?? undefined;

  try {
    if (req.signal.aborted) return new Response(null, { status: 499 });
    const rpc = (deps.getRpc ?? getRpcSession)(id);
    const liveRpc = rpc?.isAlive() ? rpc : undefined;

    // A live Agent already owns parsed history. Re-reading its growing JSONL
    // adds cold scans, snapshot races and latency without reducing its memory.
    // Keep that authoritative fast path; never duplicate Agent/RPC ownership.
    let jsonString: string;
    let workerFingerprint: string | null | undefined;
    if (liveRpc) {
      const sm = liveRpc.inner.sessionManager;
      const entries = sm.getEntries();
      if (req.signal.aborted) return new Response(null, { status: 499 });
      const requestedCursor = before ?? leafId;
      if (requestedCursor && !entries.some(entry => entry.id === requestedCursor)) {
        return new Response(method === "HEAD" ? null : JSON.stringify({ error: "History cursor not found" }), {
          status: 404, headers: { "Cache-Control": "private, no-store", "Content-Type": "application/json" },
        });
      }
      const context = buildSessionContext(entries as never, before ?? leafId ?? sm.getLeafId(), {
        deferThinking,
        deferToolResultImages,
        tail,
        excludeLeaf: Boolean(before),
        before: before ?? null,
        sessionId: id,
      });
      jsonString = JSON.stringify({ context, tail, before: before ?? null });
    } else {
      // Closed sessions use byte-offset metadata instead of full parsed managers.
      // Scan, seek, projection and serialization run off the main event loop.
      const filePath = await (deps.resolvePath ?? resolveSessionPath)(id);
      if (!filePath) {
        const notFoundHeaders = new Headers({
          "Cache-Control": "private, no-store",
        });
        if (method === "HEAD") {
          return new Response(null, { status: 404, headers: notFoundHeaders });
        }
        notFoundHeaders.set("Content-Type", "application/json");
        return new Response(JSON.stringify({ error: "Session not found" }), {
          status: 404,
          headers: notFoundHeaders,
        });
      }
      const pool = deps.pool ?? getSessionHistoryPool();
      const queryOptions = {
        leafId, tail, before: before ?? null, deferThinking, deferToolResultImages,
        sessionId: id, signal: req.signal, requireCursor: Boolean(before ?? leafId),
        includeFingerprint: true, fingerprintOnly: method === "HEAD",
      };
      if (typeof pool.queryContextResult === "function") {
        const result = await pool.queryContextResult(filePath, queryOptions);
        jsonString = result.jsonString;
        workerFingerprint = result.fingerprint;
      } else {
        // Dependency-injected legacy pools retain the old string-only contract.
        jsonString = await pool.queryContext(filePath, queryOptions);
      }
    }

    if (req.signal.aborted) return new Response(null, { status: 499 });
    const headers = new Headers({
      "Content-Type": "application/json",
      "Cache-Control": "private, no-store",
      [HISTORY_CACHE_PROTOCOL_HEADER]: HISTORY_CACHE_PROTOCOL_VERSION,
    });
    // Closed-file hashing stays in the existing bounded Worker pool. HEAD
    // transfers only its fingerprint, not a multi-MiB body through worker IPC.
    if (workerFingerprint !== undefined) {
      if (workerFingerprint) headers.set(HISTORY_FINGERPRINT_HEADER, workerFingerprint);
    } else if (Buffer.byteLength(jsonString, "utf8") <= MAX_PAGE_BYTES) {
      // Live Agent entries remain authoritative; only a bounded page is hashed.
      headers.set(HISTORY_FINGERPRINT_HEADER, computeHistoryPageFingerprint(jsonString));
    }

    if (method === "HEAD") {
      return new Response(null, {
        status: 200,
        headers,
      });
    }

    return new Response(jsonString, {
      status: 200,
      headers,
    });
  } catch (error) {
    const err = error as { name?: string; statusCode?: number; message?: string; code?: string };
    if (req.signal.aborted || err?.name === "HistoryAbortedError") {
      return new Response(null, { status: 499 });
    }
    const status = err?.statusCode ?? (err?.code === "ENOENT" ? 404 : 500);
    const errHeaders = new Headers({
      "Cache-Control": "private, no-store",
    });
    if (status === 503) {
      errHeaders.set("Retry-After", "1");
    }
    if (method === "HEAD") {
      return new Response(null, {
        status,
        headers: errHeaders,
      });
    }
    errHeaders.set("Content-Type", "application/json");
    return new Response(JSON.stringify({ error: err?.message || String(error) }), {
      status,
      headers: errHeaders,
    });
  }
}
