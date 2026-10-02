import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export interface WakeCandidate {
  sessionId: string;
  sessionName?: string;
  moduleKey?: string;
  messageId?: string;
  ownerPid?: number;
}
export interface SessionConsumer { drain: () => void; cancel?: () => void }
type ReadySession = { waitUntilReady: () => Promise<void> };
interface LockRuntimeHelper {
  getSessionConsumers: (stateFile: string) => Map<string, SessionConsumer>;
  readWakeCandidates: (options: { stateFile: string }) => WakeCandidate[];
  cancelSessionWakeups: (options: { stateFile: string; sessionId: string }) => unknown;
}
export interface DispatcherOptions {
  stateFile?: string;
  readCandidates?: LockRuntimeHelper["readWakeCandidates"];
  getConsumers?: LockRuntimeHelper["getSessionConsumers"];
  cancelPending?: LockRuntimeHelper["cancelSessionWakeups"];
  resolveSessionPath?: (id: string) => Promise<string | undefined> | string | undefined;
  startSession?: (id: string, file: string, cwd: undefined) => Promise<{ session: ReadySession }>;
  getRpcSession?: (id: string) => (ReadySession & { isAlive: () => boolean }) | undefined;
  getInflightLock?: (id: string) => Promise<{ session: ReadySession }> | undefined;
  pid?: number;
  debounceMs?: number;
  watch?: typeof fs.watch;
  pollIntervalMs?: number;
  maxRetries?: number;
  backoffScheduleMs?: number[];
  logger?: { warn?: (message: string) => void };
}
export interface LockHandoffDispatcher {
  start(): void;
  stop(): Promise<void>;
  triggerScan(): Promise<void>;
  cancelSessionWakeups(id: string): void;
  isAlive(): boolean;
}

export function sanitizeSessionId(_id: string): string { return "未命名会话（标题尚未生成）"; }
export function sanitizeError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error))
    .replace(/[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}/gi, "[会话标识]");
}
export function getAgentDirSafe(): string {
  return process.env.PI_CODING_AGENT_DIR || process.env.PI_AGENT_DIR || path.join(os.homedir(), ".pi", "agent");
}
function loadHelper(): LockRuntimeHelper | undefined {
  const helperPath = path.join(getAgentDirSafe(), "scripts", "pi-web-lock-runtime.cjs");
  if (!fs.existsSync(helperPath)) return undefined;
  // Node >=22.19 is the supported runtime. Avoid webpack rewriting a dynamic
  // createRequire(import.meta.url) call into an empty bundled require context.
  const helper = process.getBuiltinModule("module").createRequire(helperPath)(helperPath) as Partial<LockRuntimeHelper>;
  if (typeof helper.readWakeCandidates !== "function" || typeof helper.getSessionConsumers !== "function"
    || typeof helper.cancelSessionWakeups !== "function") return undefined;
  return helper as LockRuntimeHelper;
}
const candidateKey = (c: WakeCandidate) => `${c.sessionId}:${c.messageId || c.moduleKey}`;

/** The dispatcher owns restoration only. The session extension alone sends/acks messages. */
export function createLockHandoffDispatcher(options: DispatcherOptions = {}): LockHandoffDispatcher {
  const stateFile = path.resolve(options.stateFile || path.join(getAgentDirSafe(), "state", "pi-web-enhancement-locks.json"));
  const pid = options.pid ?? process.pid;
  const logger = options.logger ?? console;
  const maxRetries = options.maxRetries ?? 3;
  const delays = options.backoffScheduleMs ?? [5000, 15000, 60000];
  let helper: LockRuntimeHelper | undefined;
  const runtime = () => helper ??= loadHelper();
  // Fail closed when the optional installation is absent; never guess grant validity.
  const candidates = options.readCandidates ?? ((opts) => runtime()?.readWakeCandidates(opts) ?? []);
  const consumers = options.getConsumers ?? ((file) => runtime()?.getSessionConsumers(file) ?? new Map());
  const cancelPending = options.cancelPending ?? ((opts) => runtime()?.cancelSessionWakeups(opts));
  const resolveFile = options.resolveSessionPath ?? (async (id) => (await import("./session-reader")).resolveSessionPath(id));
  const restore = options.startSession ?? (async (id, file, cwd) => (await import("./rpc-manager")).startRpcSession(id, file, cwd));
  const live = options.getRpcSession ?? ((id) => globalThis.__piSessions?.get(id));
  const starting = options.getInflightLock ?? ((id) => globalThis.__piStartLocks?.get(id));
  const failures = new Map<string, { attempts: number; retryAt: number }>();
  const cancelledKeys = new Set<string>();
  let stopped = false, running = false, rescan = false;
  let scan: Promise<void> | undefined;
  let watcher: fs.FSWatcher | undefined;
  let debounce: NodeJS.Timeout | undefined, poll: NodeJS.Timeout | undefined;

  const read = () => candidates({ stateFile }).filter(c => c?.sessionId && c.ownerPid === pid);
  const valid = (key: string) => !stopped && !cancelledKeys.has(key) && read().some(c => candidateKey(c) === key);
  const processCandidates = async () => {
    const pending = read();
    const activeKeys = new Set(pending.map(candidateKey));
    for (const key of failures.keys()) if (!activeKeys.has(key)) failures.delete(key);
    for (const key of cancelledKeys) if (!activeKeys.has(key)) cancelledKeys.delete(key);
    const selected = new Map<string, WakeCandidate>();
    for (const c of pending) if (!selected.has(c.sessionId)) selected.set(c.sessionId, c);
    // Only restoration is serial: model work runs asynchronously in its normal session.
    for (const c of selected.values()) {
      const key = candidateKey(c), failure = failures.get(key);
      if (!valid(key) || (failure && (failure.attempts >= maxRetries || failure.retryAt > Date.now()))) continue;
      try {
        let consumer = consumers(stateFile).get(c.sessionId);
        if (!consumer) {
          const existing = live(c.sessionId);
          const inflight = starting(c.sessionId);
          let session: ReadySession;
          if (existing?.isAlive()) session = existing;
          else if (inflight) session = (await inflight).session;
          else {
            const file = await resolveFile(c.sessionId);
            // Critical cancellation check after every asynchronous admission boundary.
            if (!valid(key)) continue;
            if (!file) throw new Error("找不到原会话文件，未新建会话");
            session = (await restore(c.sessionId, file, undefined)).session;
          }
          if (!valid(key)) continue;
          await session.waitUntilReady();
          if (!valid(key)) continue;
          consumer = consumers(stateFile).get(c.sessionId);
          if (!consumer) throw new Error("原会话未注册协作锁接收器，未发送续做指令");
        }
        if (!valid(key)) continue;
        consumer.drain();
        failures.delete(key);
      } catch (error) {
        if (!valid(key)) continue;
        const attempts = (failure?.attempts ?? 0) + 1;
        failures.set(key, { attempts, retryAt: Date.now() + (delays[Math.min(attempts - 1, delays.length - 1)] ?? 60000) });
        logger.warn?.(`[协作接力] 「${c.sessionName || sanitizeSessionId(c.sessionId)}」唤醒失败 ${attempts}/${maxRetries}：${sanitizeError(error)}`);
      }
    }
  };
  const triggerScan = (): Promise<void> => {
    if (stopped) return Promise.resolve();
    if (scan) { rescan = true; return scan; }
    scan = (async () => {
      do {
        rescan = false;
        try { await processCandidates(); }
        catch (error) { logger.warn?.(`[协作接力] 状态检查失败：${sanitizeError(error)}`); }
      } while (rescan && !stopped);
    })().finally(() => { scan = undefined; });
    return scan;
  };
  const scheduleScan = () => {
    if (stopped || debounce) return;
    debounce = setTimeout(() => { debounce = undefined; void triggerScan(); }, options.debounceMs ?? 20);
    debounce.unref();
  };
  const start = () => {
    if (stopped || running) return;
    running = true;
    try {
      fs.mkdirSync(path.dirname(stateFile), { recursive: true });
      watcher = (options.watch ?? fs.watch)(path.dirname(stateFile), { persistent: false }, (_event, filename) => {
        if (filename === null || String(filename) === path.basename(stateFile)) scheduleScan();
      });
      watcher.on("error", () => { watcher?.close(); watcher = undefined; });
    } catch (error) { logger.warn?.(`[协作接力] 文件监听不可用，使用只读补偿：${sanitizeError(error)}`); }
    poll = setInterval(() => { void triggerScan(); }, Math.max(100, Math.min(5000, options.pollIntervalMs ?? 5000)));
    poll.unref();
    void triggerScan();
  };
  const stop = async () => {
    stopped = true; running = false;
    if (debounce) clearTimeout(debounce);
    if (poll) clearInterval(poll);
    watcher?.close(); watcher = undefined;
    failures.clear(); cancelledKeys.clear();
  };
  const cancelSessionWakeups = (id: string) => {
    // Mark the admission fence first, including a restoration already awaiting I/O.
    for (const c of read()) if (c.sessionId === id) cancelledKeys.add(candidateKey(c));
    cancelPending({ stateFile, sessionId: id });
    consumers(stateFile).get(id)?.cancel?.();
  };
  return { start, stop, triggerScan, cancelSessionWakeups, isAlive: () => running && !stopped };
}

const SINGLETON = Symbol.for("@agegr/pi-web/lock-handoff-dispatcher/v1");
const shutdown = () => { void stopLockHandoffDispatcher(); };
export function getLockHandoffDispatcher(): LockHandoffDispatcher | undefined {
  return (globalThis as Record<symbol, unknown>)[SINGLETON] as LockHandoffDispatcher | undefined;
}
export function startLockHandoffDispatcher(options?: DispatcherOptions): LockHandoffDispatcher {
  const existing = getLockHandoffDispatcher();
  if (existing?.isAlive()) return existing;
  const dispatcher = createLockHandoffDispatcher(options);
  (globalThis as Record<symbol, unknown>)[SINGLETON] = dispatcher;
  process.once("SIGINT", shutdown); process.once("SIGTERM", shutdown);
  dispatcher.start();
  return dispatcher;
}
export async function stopLockHandoffDispatcher(): Promise<void> {
  const existing = getLockHandoffDispatcher();
  (globalThis as Record<symbol, unknown>)[SINGLETON] = undefined;
  process.removeListener("SIGINT", shutdown); process.removeListener("SIGTERM", shutdown);
  await existing?.stop();
}
export function cancelSessionWakeups(id: string): void {
  const dispatcher = getLockHandoffDispatcher();
  if (dispatcher) dispatcher.cancelSessionWakeups(id);
  else loadHelper()?.cancelSessionWakeups({ stateFile: path.join(getAgentDirSafe(), "state", "pi-web-enhancement-locks.json"), sessionId: id });
}
