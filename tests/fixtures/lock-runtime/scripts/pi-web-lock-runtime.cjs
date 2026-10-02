/**
 * /root/.pi/agent/scripts/pi-web-lock-runtime.cjs
 * Pi Web Enhancement Lock Runtime & Session Consumer Registry
 */
const fs = require("node:fs");

const CONSUMERS_SYMBOL = Symbol.for("koxir.pi-web.lock-consumers/v1");

let locksLib = null;
function getLocksLib() {
  if (!locksLib) {
    locksLib = require("./pi-web-enhancement-locks.cjs");
  }
  return locksLib;
}

/**
 * Returns a global session consumer registry isolated by resolved stateFile.
 * Returns Map<string, { drain: () => void, cancel?: () => void }>
 */
function getSessionConsumers(stateFile) {
  const lib = getLocksLib();
  const resolvedStateFile = lib.resolveStateFile({ stateFile });
  if (!globalThis[CONSUMERS_SYMBOL]) {
    globalThis[CONSUMERS_SYMBOL] = new Map();
  }
  const globalStores = globalThis[CONSUMERS_SYMBOL];
  let store = globalStores.get(resolvedStateFile);
  if (!store) {
    store = new Map();
    globalStores.set(resolvedStateFile, store);
  }
  return store;
}

/**
 * Validates whether a lock_granted message is currently valid and actionable.
 * Requirements:
 * 1. msg.status === "granted" and not deliveredAt
 * 2. Current lock exists and lock.ownerSessionId === targetSessionId
 * 3. Generation check: If both timestamps exist (lock.acquiredAt && msg.createdAt), lock.acquiredAt === msg.createdAt
 * 4. Request check:
 *    - If msg.requestId exists and matching req exists in lock.requests: req.status === "granted"
 *    - Conservative fallback for missing req / legacy messages:
 *      If matching req is absent or msg.requestId is missing, candidate is valid ONLY IF lock.requests does NOT
 *      show all requests for this session are explicitly cancelled or rejected.
 */
function isValidGrant(msg, lock, sessionId) {
  if (!msg || msg.type !== "lock_granted" || msg.deliveredAt) {
    return false;
  }
  if (msg.status !== "granted") {
    return false;
  }

  const targetSid = (msg.toSessionId || msg.ownerSessionId || "").trim();
  if (!targetSid) {
    return false;
  }
  if (sessionId && targetSid !== sessionId) {
    return false;
  }

  if (!lock || lock.ownerSessionId !== targetSid) {
    return false;
  }

  // Generation match: if both timestamps are present, they must match exactly
  if (lock.acquiredAt && msg.createdAt && lock.acquiredAt !== msg.createdAt) {
    return false;
  }

  // Request status check
  if (Array.isArray(lock.requests)) {
    if (msg.requestId) {
      const req = lock.requests.find((r) => r && r.requestId === msg.requestId);
      if (req) {
        if (req.status !== "granted") {
          return false;
        }
      } else {
        // Missing req in lock.requests (e.g. truncated history):
        // Conservative fallback: check if all requests from this session are cancelled/rejected
        const sessionReqs = lock.requests.filter((r) => r && r.fromSessionId === targetSid);
        if (
          sessionReqs.length > 0 &&
          sessionReqs.every((r) => r.status === "cancelled" || r.status === "rejected")
        ) {
          return false;
        }
      }
    } else {
      // Legacy message missing requestId: conservative fallback
      const sessionReqs = lock.requests.filter((r) => r && r.fromSessionId === targetSid);
      if (
        sessionReqs.length > 0 &&
        sessionReqs.every((r) => r.status === "cancelled" || r.status === "rejected")
      ) {
        return false;
      }
    }
  }

  return true;
}

/**
 * Pure read-only inspection of state JSON for valid unacknowledged lock_granted messages.
 * Deduplicates by sessionId.
 * Returns array of { sessionId, moduleKey, messageId, ownerPid }.
 * Does not mutate lock state.
 */
function readWakeCandidates(options = {}) {
  const lib = getLocksLib();
  const stateFile = lib.resolveStateFile(options);

  try {
    if (!fs.existsSync(stateFile)) {
      return [];
    }
    const raw = fs.readFileSync(stateFile, "utf8");
    if (!raw.includes("lock_granted")) {
      return [];
    }
    const state = JSON.parse(raw);
    if (!state || typeof state !== "object" || !Array.isArray(state.messages) || !state.moduleLocks) {
      return [];
    }

    const candidatesBySession = new Map();

    for (const msg of state.messages) {
      if (!msg) continue;
      const sessionId = typeof msg.toSessionId === "string" ? msg.toSessionId.trim() : (msg.ownerSessionId || "").trim();
      if (!sessionId) {
        continue;
      }

      const moduleKey = typeof msg.moduleKey === "string" ? msg.moduleKey.trim() : "";
      if (!moduleKey) {
        continue;
      }

      const lock = state.moduleLocks[moduleKey];
      if (!isValidGrant(msg, lock, sessionId)) {
        continue;
      }

      const messageId = msg.messageId || "";
      const ownerPid = Number(lock.ownerPid || msg.ownerPid || 0);

      // 按 session 去重
      if (!candidatesBySession.has(sessionId)) {
        candidatesBySession.set(sessionId, {
          sessionId,
          sessionName: lock.ownerSessionName || "未命名会话（标题尚未生成）",
          moduleKey,
          messageId,
          ownerPid,
        });
      }
    }

    return Array.from(candidatesBySession.values());
  } catch {
    return [];
  }
}

/**
 * Durable cancellation of session pending requests & undelivered grants.
 * Also invokes registered in-memory consumer cancel handler if present.
 */
function cancelSessionWakeups(options = {}) {
  const lib = getLocksLib();
  const stateFile = lib.resolveStateFile(options);
  const sessionId = typeof options.sessionId === "string" ? options.sessionId.trim() : "";

  // 1. Mutex-protected durable cancellation in locks store
  const lockResult = lib.cancelSessionLockRequests({ ...options, stateFile, sessionId });

  // 2. Clear consumer in-memory state
  if (sessionId) {
    try {
      const consumers = getSessionConsumers(stateFile);
      const consumer = consumers.get(sessionId);
      if (consumer && typeof consumer.cancel === "function") {
        consumer.cancel();
      }
    } catch {}
  }

  return lockResult;
}

module.exports = {
  CONSUMERS_SYMBOL,
  getSessionConsumers,
  readWakeCandidates,
  cancelSessionWakeups,
  isValidGrant,
};
