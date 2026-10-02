import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const require = createRequire(import.meta.url);
const locksLib = require("../scripts/pi-web-enhancement-locks.cjs");
const runtimeLib = require("../scripts/pi-web-lock-runtime.cjs");

export const LOCK_MESSAGE_CUSTOM_TYPE = "pi-web-enhancement-lock";
const LIVENESS_REGISTRY_SYMBOL = Symbol.for("@agegr/pi-web/session-liveness/v1");

export interface EnhancementLockToolParams {
  action: "status" | "acquire" | "request" | "reply" | "release";
  module?: string;
  requestId?: string;
  toSessionId?: string;
  decision?: "accept" | "reject" | "release" | "info";
  release?: boolean;
  releaseAll?: boolean;
  taskCompleted?: boolean;
  message?: string;
}

const EnhancementLockToolParams: any = {
  type: "object",
  additionalProperties: false,
  required: ["action"],
  properties: {
    action: {
      type: "string",
      enum: ["status", "acquire", "request", "reply", "release"],
      description: "Collaboration lock operation: status, acquire, request, reply, or release",
    },
    module: {
      type: "string",
      description:
        "Target module identifier (module:01 ~ module:08, 01 ~ 08, or module filename under /root/.pi/agent/scripts/enhancements/modules/*.js)",
    },
    requestId: {
      type: "string",
      description: "Request ID when action=reply",
    },
    toSessionId: {
      type: "string",
      description: "Requester session ID when action=reply",
    },
    decision: {
      type: "string",
      enum: ["accept", "reject", "release", "info"],
      description: "Reply decision when action=reply",
    },
    release: {
      type: "boolean",
      description: "When action=reply, set true to also release the module lock immediately",
    },
    releaseAll: {
      type: "boolean",
      description: "When action=release, set true to release all module locks held by this session",
    },
    taskCompleted: {
      type: "boolean",
      description: "Only with action=release: set true AFTER the original business task, required deployment and acceptance are actually complete. Clears Pi未完成 only if no pending requests or owned locks remain. Never set merely for grant, cancellation or end of a turn.",
    },
    message: {
      type: "string",
      description:
        "Short collaboration note or negotiation message (plain metadata only; never include edited source code)",
    },
  },
};

export interface EnhancementLockExtensionOptions {
  stateFile?: string;
  modulesDir?: string;
  isPidAlive?: (pid: number) => boolean;
}

/**
 * Strictly resolve session ID in Extension from ctx.sessionManager.getSessionId().
 * Never disguise a subagent session ID as a parent session ID or fall back to env vars.
 */
export function resolveExtensionSessionId(ctx?: ExtensionContext | any): string | null {
  const sid = ctx?.sessionManager?.getSessionId?.();
  if (typeof sid === "string" && sid.trim()) {
    return sid.trim();
  }
  return null;
}

function resolveSessionDisplayName(ctx: ExtensionContext | any, fallback?: string): string {
  const sessionId = resolveExtensionSessionId(ctx);
  const normalize = (value: unknown) => {
    if (typeof value !== "string") return "";
    const name = value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
    const looksLikeSessionId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(name);
    return name && name !== sessionId && !looksLikeSessionId ? name.slice(0, 120) : "";
  };
  try {
    const name = normalize(ctx?.sessionManager?.getSessionName?.());
    if (name) return name;
  } catch {}
  return normalize(fallback) || "未命名会话（标题尚未生成）";
}

function formatStatusReport(
  status: any,
  currentSessionId: string | null,
  currentSessionName: string
): string {
  const gLock = status.globalBuildLock;
  const sessionLabel = (sessionId: string | null | undefined, name?: string) =>
    name || (sessionId && sessionId === currentSessionId ? currentSessionName : "未命名会话（标题尚未生成）");
  const gOwnedTag = gLock
    ? currentSessionId && gLock.ownerSessionId === currentSessionId
      ? " [本会话持有全局构建锁]"
      : gLock.ownerSessionId
        ? " [其他会话持有全局构建锁]"
        : " [CLI持有全局构建锁]"
    : "";
  const lines: string[] = [
    `🔒 【Pi Web 增强跨会话协作锁状态】`,
    `- 发行版与版本: ${status.edition} (v${status.version})`,
    `- 当前会话: 「${currentSessionName}」`,
    `- 全局构建锁: ${
      gLock
        ? `占用中${gOwnedTag} (operation=${gLock.operation}, 持有者=${gLock.ownerSessionId ? `「${sessionLabel(gLock.ownerSessionId, gLock.ownerSessionName)}」` : "CLI"}, ownerPid=${gLock.ownerPid})`
        : "空闲 (unlocked)"
    }`,
  ];

  const lockEntries = Object.values(status.moduleLocks || {}) as any[];
  if (lockEntries.length === 0) {
    lines.push(`- 模块锁列表: 当前无任何模块被锁定 (module:01 ~ module:08 均空闲)`);
  } else {
    lines.push(`- 活跃模块锁 (${lockEntries.length}):`);
    for (const lock of lockEntries) {
      const ownedTag =
        currentSessionId && lock.ownerSessionId === currentSessionId
          ? " [本会话持有模块锁]"
          : " [其他会话持有模块锁]";
      const pendingCount = Array.isArray(lock.requests)
        ? lock.requests.filter((r: any) => r && r.status === "pending").length
        : 0;
      lines.push(
        `  • ${lock.moduleKey} (${lock.moduleFile})${ownedTag}: 持有者=「${sessionLabel(lock.ownerSessionId, lock.ownerSessionName)}」, ownerPid=${lock.ownerPid}, version=v${lock.version}, baselineSha=${String(lock.baselineSha256 || "").slice(0, 12)}, currentSha=${String(lock.currentSha256 || "").slice(0, 12)}, pendingRequests=${pendingCount}`
      );
      if (Array.isArray(lock.requests)) {
        for (const req of lock.requests) {
          if (req && req.status === "pending") {
            lines.push(
              `    ↳ 待处理请求 ${req.requestId}: 「${sessionLabel(req.fromSessionId, req.fromSessionName)}」→「${sessionLabel(req.toSessionId, req.toSessionName)}」 (${req.reason})`
            );
          }
        }
      }
    }
  }

  lines.push("", locksLib.formatToolUsageGuide());
  return lines.join("\n");
}

export default function piWebEnhancementLockExtension(
  pi: ExtensionAPI,
  options: EnhancementLockExtensionOptions = {}
) {
  const lockOpts = {
    stateFile: options.stateFile,
    modulesDir: options.modulesDir,
    isPidAlive: options.isPidAlive,
  };

  let boundSessionId: string | null = null;
  let watcher: fs.FSWatcher | null = null;
  let watchTimer: ReturnType<typeof setTimeout> | null = null;
  let latestCtx: ExtensionContext | any = null;
  let isAgentBusy = false;
  const INFLIGHT_GRACE_MS = 10000;
  const pendingGrantsByModule = new Map<string, any>();
  const inflightMessageIds = new Map<string, { msg: any; sentAt: number }>();
  let unregisterLiveness: (() => void) | null = null;

  function registerLivenessProvider(sessionId: string) {
    if (unregisterLiveness) {
      try {
        unregisterLiveness();
      } catch {}
      unregisterLiveness = null;
    }
    const registry = (globalThis as any)[LIVENESS_REGISTRY_SYMBOL];
    if (registry && typeof registry.register === "function") {
      try {
        unregisterLiveness = registry.register({
          name: "pi-web-enhancement-lock",
          sessionId,
          isActive: () => {
            try {
              if (locksLib.checkSessionHasPendingLockRequests(sessionId, lockOpts)) {
                return true;
              }
              if (locksLib.checkSessionHoldsAnyModuleLocks(sessionId, lockOpts)) {
                return true;
              }
              const candidates = runtimeLib.readWakeCandidates(lockOpts);
              if (candidates.some((c: any) => c && c.sessionId === sessionId)) {
                return true;
              }
            } catch {}
            return false;
          },
        });
      } catch (err) {
        console.error("[pi-web-enhancement-lock] failed to register session liveness:", err);
      }
    }
  }

  function unregisterLivenessProvider() {
    if (unregisterLiveness) {
      try {
        unregisterLiveness();
      } catch {}
      unregisterLiveness = null;
    }
  }

  function registerSessionConsumer(sessionId: string) {
    try {
      const consumers = runtimeLib.getSessionConsumers(lockOpts.stateFile);
      consumers.set(sessionId, {
        drain: () => {
          deliverPendingMessagesForSession(sessionId);
        },
        cancel: () => {
          pendingGrantsByModule.clear();
          inflightMessageIds.clear();
        },
      });
    } catch {}
  }

  function unregisterSessionConsumer(sessionId: string | null) {
    if (!sessionId) return;
    try {
      const consumers = runtimeLib.getSessionConsumers(lockOpts.stateFile);
      consumers.delete(sessionId);
    } catch {}
  }

  function updateLatestCtx(ctx?: ExtensionContext | any) {
    if (ctx) latestCtx = ctx;
  }

  function getActiveBranchPersistedMessageIds(ctx?: ExtensionContext | any): Set<string> {
    const ids = new Set<string>();
    const sm = ctx?.sessionManager || latestCtx?.sessionManager;
    if (!sm || typeof sm.getBranch !== "function") {
      return ids;
    }
    try {
      // 严格仅从 getBranch() 读取当前活跃分支，不遍历全部分支
      const branch = sm.getBranch();
      if (Array.isArray(branch)) {
        for (const entry of branch) {
          if (!entry) continue;
          let details: any = null;
          if (entry.type === "custom_message" && entry.customType === LOCK_MESSAGE_CUSTOM_TYPE) {
            details = entry.details;
          } else if (entry.message?.role === "custom" && entry.message.customType === LOCK_MESSAGE_CUSTOM_TYPE) {
            details = entry.message.details;
          }
          if (details && typeof details.messageId === "string" && details.messageId) {
            ids.add(details.messageId);
          }
        }
      }
    } catch {}
    return ids;
  }

  function isGrantValidForSession(msg: any, currentLock: any, sessionId: string): boolean {
    // One authoritative validation algorithm; incompatible runtime helpers fail closed.
    return runtimeLib.isValidGrant(msg, currentLock, sessionId);
  }

  function isAgentRunning(): boolean {
    if (latestCtx && typeof latestCtx.isIdle === "function") {
      try {
        if (!latestCtx.isIdle()) {
          return true;
        }
      } catch {}
    }
    return isAgentBusy;
  }

  function revokePendingGrant(moduleInput?: string | null) {
    if (!moduleInput) return;
    let targetKey: string | null = null;
    try {
      const spec = locksLib.getModuleSpec(moduleInput);
      if (spec?.key) {
        targetKey = spec.key;
      }
    } catch {}
    if (!targetKey) {
      const str = String(moduleInput).trim();
      targetKey = str.startsWith("module:") ? str : `module:${str}`;
    }
    pendingGrantsByModule.delete(targetKey);
    for (const [id, item] of inflightMessageIds.entries()) {
      if (item.msg?.moduleKey === targetKey || item.msg?.details?.moduleKey === targetKey) {
        inflightMessageIds.delete(id);
      }
    }
  }

  function ackPersistedMessages(sessionId: string | null) {
    if (!sessionId || inflightMessageIds.size === 0) return;
    // SDK extension message_end runs BEFORE JSONL append. Only active-branch
    // evidence (normally visible by agent_settled) is a delivery acknowledgement.
    const persisted = getActiveBranchPersistedMessageIds(latestCtx);
    const ids = Array.from(inflightMessageIds.keys()).filter(id => persisted.has(id));
    if (ids.length === 0) return;
    locksLib.ackSessionMessages({ ...lockOpts, sessionId, messageIds: ids });
    for (const id of ids) inflightMessageIds.delete(id);
    for (const [moduleKey, msg] of pendingGrantsByModule) {
      if (ids.includes(msg.messageId)) pendingGrantsByModule.delete(moduleKey);
    }
  }

  function stopSessionWatcher() {
    if (watchTimer) {
      clearTimeout(watchTimer);
      watchTimer = null;
    }
    if (watcher) {
      try {
        watcher.close();
      } catch {}
      watcher = null;
    }
  }

  async function processPendingGrantsOnSettled(sessionId: string | null) {
    if (!sessionId) {
      return;
    }

    const pendingList = Array.from(pendingGrantsByModule.entries());
    pendingGrantsByModule.clear();

    let currentStatus: any = null;
    try {
      currentStatus = locksLib.getLockStatus({
        ...lockOpts,
        sessionId,
      });
    } catch {
      return;
    }

    const outstandingIds = new Set(locksLib.peekSessionMessages({ ...lockOpts, sessionId }).map((msg: any) => msg.messageId));
    let triggeredAny = false;
    for (const [modKey, grantMsg] of pendingList) {
      if (!outstandingIds.has(grantMsg.messageId)) continue;
      const currentLock = currentStatus?.moduleLocks?.[modKey];
      const valid = isGrantValidForSession(grantMsg, currentLock, sessionId);

      // 仅待 agent_settled 时且仍实际持有并满足代际有效性才 triggerTurn 自动续做
      if (valid) {
        const messageId = grantMsg.messageId;
        if (messageId && inflightMessageIds.has(messageId)) {
          const inflight = inflightMessageIds.get(messageId)!;
          const elapsed = Date.now() - inflight.sentAt;
          if (elapsed >= INFLIGHT_GRACE_MS) {
            const persisted = getActiveBranchPersistedMessageIds(latestCtx);
            if (persisted.has(messageId)) {
              inflightMessageIds.delete(messageId);
              try {
                locksLib.ackSessionMessages({ ...lockOpts, sessionId, messageIds: [messageId] });
              } catch {}
              continue;
            } else {
              inflightMessageIds.delete(messageId);
            }
          } else {
            continue;
          }
        }
        if (messageId) {
          inflightMessageIds.set(messageId, { msg: grantMsg, sentAt: Date.now() });
        }

        const shouldTrigger = !triggeredAny;
        if (shouldTrigger) {
          triggeredAny = true;
        }

        try {
          pi.sendMessage(
            {
              customType: LOCK_MESSAGE_CUSTOM_TYPE,
              content: grantMsg.summary,
              display: true,
              details: grantMsg,
            },
            shouldTrigger
              ? { triggerTurn: true, deliverAs: "followUp" }
              : { triggerTurn: false }
          );
        } catch (err) {
          if (messageId) inflightMessageIds.delete(messageId);
        }
      } else {
        // 过期或已取消 grant 不会复活：如果不持有了或已被取消，精确 ack 掉
        if (grantMsg.messageId) {
          try {
            locksLib.ackSessionMessages({
              ...lockOpts,
              sessionId,
              messageIds: [grantMsg.messageId],
            });
          } catch {}
        }
      }
    }

    // 结算后处于 idle 态，检查是否还有其他未投递的通知消息
    deliverPendingMessagesForSession(sessionId);
  }

  function deliverPendingMessagesForSession(sessionId: string | null) {
    if (!sessionId) return [];
    try {
      ackPersistedMessages(sessionId);
      const messages = locksLib.peekSessionMessages({
        ...lockOpts,
        sessionId,
      });
      if (!Array.isArray(messages) || messages.length === 0) {
        return [];
      }

      const running = isAgentRunning();

      for (const msg of messages) {
        const messageId = msg.messageId;
        const isLockGrant = msg.type === "lock_granted";

        if (isLockGrant) {
          const modKey = msg.moduleKey || (msg.details && msg.details.moduleKey);
          let currentStatus: any = null;
          try {
            currentStatus = locksLib.getLockStatus({
              ...lockOpts,
              sessionId,
            });
          } catch {
            continue;
          }

          const currentLock = currentStatus?.moduleLocks?.[modKey];
          const valid = isGrantValidForSession(msg, currentLock, sessionId);

          if (!valid) {
            // 过期/已取消/不匹配代际的 grant 不会复活：直接精确 ack 掉该废弃消息，不触发 followUp
            if (messageId) {
              try {
                locksLib.ackSessionMessages({ ...lockOpts, sessionId, messageIds: [messageId] });
              } catch {}
            }
            continue;
          }

          if (running) {
            if (messageId && inflightMessageIds.has(messageId)) continue;
            // 关键不变量 1：busy 不 ack 不送 SDK followUpQueue；暂存等待 agent_settled
            if (modKey) {
              pendingGrantsByModule.set(modKey, msg);
            }
            continue;
          }

          // 确认持有锁且代际有效：检查防重 inflight
          if (messageId && inflightMessageIds.has(messageId)) {
            const inflight = inflightMessageIds.get(messageId)!;
            const isIdle = !isAgentRunning();
            const elapsed = Date.now() - inflight.sentAt;
            if (isIdle && elapsed >= INFLIGHT_GRACE_MS) {
              const persisted = getActiveBranchPersistedMessageIds(latestCtx);
              if (persisted.has(messageId)) {
                inflightMessageIds.delete(messageId);
                try {
                  locksLib.ackSessionMessages({ ...lockOpts, sessionId, messageIds: [messageId] });
                } catch {}
                continue;
              } else {
                inflightMessageIds.delete(messageId);
              }
            } else {
              continue;
            }
          }

          if (messageId) {
            inflightMessageIds.set(messageId, { msg, sentAt: Date.now() });
          }

          try {
            pi.sendMessage(
              {
                customType: LOCK_MESSAGE_CUSTOM_TYPE,
                content: msg.summary,
                display: true,
                details: msg,
              },
              { triggerTurn: true, deliverAs: "followUp" }
            );
          } catch (err) {
            // 异常可重试
            if (messageId) inflightMessageIds.delete(messageId);
            console.error("[pi-web-enhancement-lock] failed to send grant message:", err);
          }
        } else {
          // 普通协作消息（lock_request, lock_reply, lock_revoked 等通知）
          // 保留 busy 通知可见语义：pi.sendMessage(triggerTurn: false) 由 SDK defer，仍在 message_end ack
          if (messageId && inflightMessageIds.has(messageId)) {
            const inflight = inflightMessageIds.get(messageId)!;
            const isIdle = !isAgentRunning();
            const elapsed = Date.now() - inflight.sentAt;
            if (isIdle && elapsed >= INFLIGHT_GRACE_MS) {
              const persisted = getActiveBranchPersistedMessageIds(latestCtx);
              if (persisted.has(messageId)) {
                inflightMessageIds.delete(messageId);
                try {
                  locksLib.ackSessionMessages({ ...lockOpts, sessionId, messageIds: [messageId] });
                } catch {}
                continue;
              } else {
                inflightMessageIds.delete(messageId);
              }
            } else {
              continue;
            }
          }

          if (messageId) {
            inflightMessageIds.set(messageId, { msg, sentAt: Date.now() });
          }

          try {
            pi.sendMessage(
              {
                customType: LOCK_MESSAGE_CUSTOM_TYPE,
                content: msg.summary,
                display: true,
                details: msg,
              },
              { triggerTurn: false }
            );
          } catch (err) {
            if (messageId) inflightMessageIds.delete(messageId);
            console.error("[pi-web-enhancement-lock] failed to send notification message:", err);
          }
        }
      }
      return messages;
    } catch {
      return [];
    }
  }

  function syncSessionName(ctx?: ExtensionContext | any, explicitName?: string) {
    const sid = resolveExtensionSessionId(ctx);
    if (!sid) return null;
    const sessionName = resolveSessionDisplayName(ctx, explicitName);
    if (!sessionName.startsWith("未命名会话（标题尚未生成）")) {
      try {
        locksLib.rememberSessionName({ ...lockOpts, sessionId: sid, sessionName });
      } catch {}
    }
    return sessionName;
  }

  function ensureSessionWatcher(ctx?: ExtensionContext | any) {
    const sid = resolveExtensionSessionId(ctx);
    if (!sid) return null;
    syncSessionName(ctx);
    registerLivenessProvider(sid);
    registerSessionConsumer(sid);

    if (boundSessionId !== sid || !watcher) {
      stopSessionWatcher();
      boundSessionId = sid;
      const stateFile = locksLib.resolveStateFile(lockOpts);
      const stateDir = path.dirname(stateFile);
      const stateBase = path.basename(stateFile);
      try {
        fs.mkdirSync(stateDir, { recursive: true });
        watcher = fs.watch(stateDir, { persistent: false }, (_eventType, filename) => {
          if (!filename) return;
          const nameStr = String(filename);
          // 严禁被 .mutex 锁文件、.tmp 临时文件触发，必须严格精准匹配主状态文件名，彻底杜绝死循环自激
          if (nameStr !== stateBase) {
            return;
          }
          if (watchTimer) clearTimeout(watchTimer);
          watchTimer = setTimeout(() => {
            watchTimer = null;
            if (boundSessionId) {
              deliverPendingMessagesForSession(boundSessionId);
            }
          }, 20);
        });
        watcher.on("error", () => {
          // Ignore transient watcher errors
        });
      } catch {
        watcher = null;
      }
    }

    deliverPendingMessagesForSession(sid);
    return sid;
  }

  pi.on("session_start", async (_event, ctx) => {
    updateLatestCtx(ctx);
    const sid = resolveExtensionSessionId(ctx);
    if (sid) {
      registerLivenessProvider(sid);
      registerSessionConsumer(sid);

      // 从 ctx.sessionManager.getBranch() 重建已经持久化的 details.messageId，精确 ack 后不重发
      const persistedIds = getActiveBranchPersistedMessageIds(ctx);
      if (persistedIds.size > 0) {
        try {
          locksLib.ackSessionMessages({
            ...lockOpts,
            sessionId: sid,
            messageIds: Array.from(persistedIds),
          });
        } catch {}
      }
    }
    ensureSessionWatcher(ctx);
  });

  pi.on("agent_start", async (_event, ctx) => {
    updateLatestCtx(ctx);
    isAgentBusy = true;
  });

  pi.on("agent_settled", async (_event, ctx) => {
    updateLatestCtx(ctx);
    isAgentBusy = false;
    const sid = resolveExtensionSessionId(ctx) || boundSessionId;
    if (sid) {
      try {
        ackPersistedMessages(sid);
        const hasPending = locksLib.checkSessionHasPendingLockRequests(sid, lockOpts);
        if (hasPending) {
          // 当前回合结束仍因被其他会话锁住而未完成：打上【Pi未完成】标签
          await locksLib.setSessionUncompletedTag(sid, true, lockOpts);
        }
        // A settled turn is not evidence that the original business task is done.
      } catch {}
    }
    await processPendingGrantsOnSettled(sid);
  });

  pi.on("session_info_changed", async (event, ctx) => {
    updateLatestCtx(ctx);
    syncSessionName(ctx, event.name);
  });

  pi.on("tool_call", async (event, ctx) => {
    updateLatestCtx(ctx);
    ensureSessionWatcher(ctx);

    if (event.toolName !== "edit" && event.toolName !== "write") {
      return;
    }

    const rawPath = (event.input as any)?.path;
    if (typeof rawPath !== "string" || !rawPath.trim()) {
      return;
    }

    const target = locksLib.resolveModuleFromFilePath(rawPath, {
      ...lockOpts,
      cwd: ctx?.cwd,
    });
    if (!target) {
      return;
    }

    const sessionId = resolveExtensionSessionId(ctx);
    const sessionName = syncSessionName(ctx) || resolveSessionDisplayName(ctx);
    if (!sessionId) {
      return {
        block: true,
        reason: [
          "❌ 【Pi Web 增强模块跨会话协作锁拦截】",
          "无法从 ctx.sessionManager.getSessionId() 获取真实会话 ID，已拒绝直接修改增强模块文件。",
          locksLib.formatToolUsageGuide(),
        ].join("\n"),
      };
    }

    // Never read or record edited source code (event.input.content / event.input.edits) into lock state or message queue
    const result = locksLib.acquireModuleLock({
      ...lockOpts,
      moduleKey: target.moduleKey,
      sessionId,
      pid: process.pid,
      autoRequest: true,
      sessionName,
      requestReason: `自动请求: 会话「${sessionName}」尝试通过 ${event.toolName} 修改 ${target.spec.file}`,
    });

    if (!result.acquired) {
      try {
        await locksLib.setSessionUncompletedTag(sessionId, true, lockOpts);
      } catch {}
      if (ctx?.hasUI && ctx?.ui?.notify) {
        if (result.reasonCode === "global_build_locked" || result.globalBuildLock) {
          const buildOwner = result.globalBuildLock?.ownerSessionName || "未命名会话（标题尚未生成）";
          const isSameSession = Boolean(
            sessionId && result.globalBuildLock?.ownerSessionId === sessionId
          );
          const notifyMsg = isSameSession
            ? `本会话 (${buildOwner}) 正在持有全局构建/部署锁 (${result.globalBuildLock?.operation || "build"})，构建期间禁止修改模块 ${target.moduleKey}`
            : `全局构建/部署锁当前由「${result.globalBuildLock?.ownerSessionId ? buildOwner : "CLI"}」持有 (${result.globalBuildLock?.operation || "build"})，已拦截对模块 ${target.moduleKey} 的写入（全局锁不生成模块协商请求）`;
          ctx.ui.notify(notifyMsg, "warning");
        } else {
          const owner = result.lock?.ownerSessionName || "未命名会话（标题尚未生成）";
          ctx.ui.notify(
            `模块 ${target.moduleKey} 当前由「${owner}」持有模块锁，已拦截写入并自动发送协商请求`,
            "warning"
          );
        }
      }
      return {
        block: true,
        reason: result.reason,
      };
    }
  });

  pi.on("tool_result", async (event, ctx) => {
    updateLatestCtx(ctx);
    if (event.toolName !== "edit" && event.toolName !== "write") return;
    if ((event as any).isError) return;
    const sessionId = resolveExtensionSessionId(ctx);
    if (!sessionId) return;
    try {
      locksLib.refreshOwnedModuleHashes({
        ...lockOpts,
        sessionId,
      });
    } catch {}
  });

  pi.on("message_end", async (event, ctx) => {
    updateLatestCtx(ctx);
    const msg = (event as any)?.message;
    if (!msg) return;

    const details = msg.details || (msg.custom && msg.custom.details);
    const msgId = details?.messageId;
    if (!msgId) return;

    if (inflightMessageIds.has(msgId)) {
      try {
        ackPersistedMessages(resolveExtensionSessionId(ctx) || boundSessionId);
      } catch (err) {
        console.error("[pi-web-enhancement-lock] persisted message ack failed:", err);
      }
    }
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    updateLatestCtx(ctx);
    isAgentBusy = false;
    pendingGrantsByModule.clear();
    inflightMessageIds.clear();
    const sid = resolveExtensionSessionId(ctx) || boundSessionId;
    stopSessionWatcher();
    unregisterSessionConsumer(sid);
    unregisterLivenessProvider();
    boundSessionId = null;
    if (sid) {
      try {
        await locksLib.releaseModuleLock({
          ...lockOpts,
          sessionId: sid,
          releaseAll: true,
          cancelRequests: true,
          note: "session_shutdown 自动幂等释放",
        });
        // Shutdown/cancellation does not imply business completion; retain the tag.
      } catch {}
    }
  });

  pi.registerTool({
    name: "pi_web_enhancement_lock",
    label: "Pi Web Enhancement Lock",
    description:
      "Inspect, acquire, request, reply to, or release cross-session collaboration locks for Pi Web enhancement modules (module:01 ~ module:08). Prevents multi-session overwrite conflicts and mixed-state builds.",
    promptSnippet:
      "Manage cross-session collaboration locks (status/acquire/request/reply/release) for Pi Web enhancement modules",
    promptGuidelines: [
      "Built-in edit/write on /root/.pi/agent/scripts/enhancements/modules/*.js automatically acquires the corresponding module lock (module:01 ~ module:08).",
      "Before editing any enhancement module via bash/scripts, you MUST first call pi_web_enhancement_lock with action='acquire'.",
      "While a global build/deploy lock is active, module lock acquisition and module edits are blocked for all sessions (including the build owner session) until the build finishes.",
      "If another session owns a module, a failed acquire/edit queues your request. Do not retry blocked writes; lock_granted will automatically start a follow-up turn. Then review the latest file and original task before continuing.",
      "For user-visible collaboration lock reports and notifications, show the real session title; never display a session ID. Session IDs remain internal lock identifiers only.",
      "Release your module lock when finished so the next waiting session can continue automatically; owners can inspect/reply to requests with action='status'/'reply'.",
      "Only after the original business task, required deployment and acceptance are actually complete, use action='release' with taskCompleted=true to clear Pi未完成. Grant, Stop, shutdown and settled turns are not business completion.",
    ],
    parameters: EnhancementLockToolParams,
    async execute(_toolCallId, rawParams, _signal, _onUpdate, ctx) {
      const params = rawParams as EnhancementLockToolParams;
      const sessionId = ensureSessionWatcher(ctx) || resolveExtensionSessionId(ctx);

      if (params.action === "status") {
        const status = locksLib.getLockStatus({
          ...lockOpts,
          sessionId: sessionId || undefined,
          module: params.module,
        });
        const text = formatStatusReport(
          status,
          sessionId,
          resolveSessionDisplayName(ctx, status.currentSessionName)
        );
        return {
          content: [{ type: "text", text }],
          details: status,
        };
      }

      if (!sessionId) {
        throw new Error(
          "Cannot execute lock mutation without a valid session ID from ctx.sessionManager.getSessionId()"
        );
      }

      if (params.action === "acquire") {
        if (!params.module) {
          throw new Error("Parameter 'module' (e.g. 'module:01') is required for action='acquire'");
        }
        const res = locksLib.acquireModuleLock({
          ...lockOpts,
          module: params.module,
          sessionId,
          pid: process.pid,
          sessionName: resolveSessionDisplayName(ctx),
          message: params.message,
          autoRequest: true,
        });
        if (!res.acquired) {
          try {
            await locksLib.setSessionUncompletedTag(sessionId, true, lockOpts);
          } catch {}
        }
        const text = res.acquired
          ? [
              `✅ 已获取模块锁 ${res.moduleKey} (${res.lock.moduleFile})${res.reentrant ? " [幂等重入]" : ""}`,
              `- 持有者会话: 「${res.lock.ownerSessionName || resolveSessionDisplayName(ctx)}」`,
              `- ownerPid: ${res.lock.ownerPid}`,
              `- edition / version: ${res.lock.edition} (v${res.lock.version})`,
              `- baselineSha256: ${res.lock.baselineSha256}`,
              `- currentSha256: ${res.lock.currentSha256}`,
            ].join("\n")
          : res.reason;
        return {
          content: [{ type: "text", text }],
          details: res,
        };
      }

      if (params.action === "request") {
        if (!params.module) {
          throw new Error("Parameter 'module' (e.g. 'module:01') is required for action='request'");
        }
        const res = locksLib.requestModuleLock({
          ...lockOpts,
          module: params.module,
          sessionId,
          pid: process.pid,
          sessionName: resolveSessionDisplayName(ctx),
          message: params.message,
        });
        if (res.requested) {
          try {
            await locksLib.setSessionUncompletedTag(sessionId, true, lockOpts);
          } catch {}
        }
        const text = [
          res.summary,
          res.lock
            ? `- 当前持有者会话: 「${res.lock.ownerSessionName || "未命名会话（标题尚未生成）"}」 | 模块: ${res.moduleKey} | 版本: v${res.lock.version}`
            : "",
        ]
          .filter(Boolean)
          .join("\n");
        return {
          content: [{ type: "text", text }],
          details: res,
        };
      }

      if (params.action === "reply") {
        const res = locksLib.replyModuleLockRequest({
          ...lockOpts,
          module: params.module,
          requestId: params.requestId,
          toSessionId: params.toSessionId,
          sessionId,
          sessionName: resolveSessionDisplayName(ctx),
          decision: params.decision,
          release: params.release,
          message: params.message,
        });
        if (!res.replied) {
          return {
            content: [{ type: "text", text: `❌ 回复失败: ${res.error}` }],
            details: res,
          };
        }
        if (res.released && res.moduleKey) {
          revokePendingGrant(res.moduleKey);
        }
        const text = [
          `✅ 已回复模块 ${res.moduleKey} 的协商请求 -> 收件会话「${res.toSessionName || "未命名会话（标题尚未生成）"}」`,
          `- 决策状态: ${res.messageEntry.decision}${res.released ? " (已同步释放模块锁)" : ""}`,
          `- 回复内容: ${res.messageEntry.summary}`,
        ].join("\n");
        return {
          content: [{ type: "text", text }],
          details: res,
        };
      }

      if (params.action === "release") {
        const isReleaseAll = Boolean(params.releaseAll || !params.module);
        const res = locksLib.releaseModuleLock({
          ...lockOpts,
          module: params.module,
          sessionId,
          releaseAll: isReleaseAll,
          cancelRequests: isReleaseAll,
          message: params.message,
        });
        if (!res.released) {
          return {
            content: [{ type: "text", text: `❌ 释放锁失败: ${res.error}` }],
            details: res,
          };
        }
        if (isReleaseAll) {
          pendingGrantsByModule.clear();
          inflightMessageIds.clear();
        } else {
          revokePendingGrant(params.module);
        }
        try {
          const hasPending = locksLib.checkSessionHasPendingLockRequests(sessionId, lockOpts);
          const holdsLock = locksLib.checkSessionHoldsAnyModuleLocks(sessionId, lockOpts);
          if (params.taskCompleted === true && !hasPending && !holdsLock) {
            await locksLib.setSessionUncompletedTag(sessionId, false, lockOpts);
          }
        } catch {}
        const text =
          res.releasedModules.length > 0
            ? `✅ 会话「${resolveSessionDisplayName(ctx)}」已释放模块锁: ${res.releasedModules.join(", ")}`
            : `ℹ️ 会话「${resolveSessionDisplayName(ctx)}」当前未持有待释放的目标模块锁（幂等完成）`;
        return {
          content: [{ type: "text", text }],
          details: res,
        };
      }

      throw new Error(`Unsupported action: ${String((params as any).action)}`);
    },
  });
}
