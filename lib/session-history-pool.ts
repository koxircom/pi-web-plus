import { Worker } from "worker_threads";
import * as os from "os";
import * as path from "path";
import * as fs from "fs";

export class HistoryQueueFullError extends Error {
  statusCode = 503;
  retryAfter = 1;
  constructor(message = "会话历史读取繁忙，请稍后重试。") {
    super(message);
    this.name = "HistoryQueueFullError";
  }
}

export class HistoryTimeoutError extends Error {
  statusCode = 504;
  constructor(message = "会话历史读取超过 30 秒，已终止。") {
    super(message);
    this.name = "HistoryTimeoutError";
  }
}

export class HistoryAbortedError extends Error {
  statusCode = 499;
  constructor(message = "会话历史读取已取消。") {
    super(message);
    this.name = "HistoryAbortedError";
  }
}

export interface WorkerErrorPayload {
  message: string;
  name?: string;
  statusCode?: number;
  retryable?: boolean;
  code?: string;
}

export interface WorkerResponseMessage {
  id: number;
  success: boolean;
  jsonString?: string;
  fingerprint?: string | null;
  error?: WorkerErrorPayload;
}

export interface QueryContextWorkerOptions {
  leafId?: string | null;
  tail?: number;
  before?: string | null;
  deferThinking?: boolean;
  /** Internal exact-entry lookup; never exposed by the context URL. */
  onlyEntry?: boolean;
  deferToolResultImages?: boolean;
  sessionId?: string;
  requireCursor?: boolean;
  includeFingerprint?: boolean;
  fingerprintOnly?: boolean;
  signal?: AbortSignal;
}

export interface QuerySessionDetailWorkerOptions {
  sessionId: string;
  sourceId: string;
  summaryTree: boolean;
  deferThinking: boolean;
  deferToolResults?: boolean;
  deferToolResultImages: boolean;
  tail: number;
  signal?: AbortSignal;
}

export interface HistoryContextReadResult {
  jsonString: string;
  fingerprint: string | null;
}

interface PendingTaskBase {
  id: number;
  filePath: string;
  preferredSlot: number;
  deadline: number;
  resolve: (result: HistoryContextReadResult) => void;
  reject: (err: Error) => void;
  timer?: NodeJS.Timeout;
  queueTimer?: NodeJS.Timeout;
  signalListener?: () => void;
}

type PendingTask = PendingTaskBase & (
  | { type: "queryContext"; options: QueryContextWorkerOptions }
  | { type: "querySessionDetail"; options: QuerySessionDetailWorkerOptions }
);

interface WorkerSlot {
  worker: Worker;
  activeTask: PendingTask | null;
  isTerminating: boolean;
  idleTimer?: NodeJS.Timeout;
}

export interface SessionHistoryPoolOptions {
  workerScriptPath?: string;
  maxWorkers?: number;
  requestTimeoutMs?: number;
  idleTimeoutMs?: number;
  maxQueueSize?: number;
}

const DEFAULT_MAX_QUEUE_SIZE = 16;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_IDLE_TIMEOUT_MS = 60_000;
const MAX_DETAIL_MANAGER_CACHE_BYTES = 64 * 1024 * 1024;

export class SessionHistoryPool {
  private maxWorkers: number;
  private maxQueueSize: number;
  private requestTimeoutMs: number;
  private idleTimeoutMs: number;
  private slots: (WorkerSlot | null)[];
  private queue: PendingTask[] = [];
  private nextRequestId = 1;
  private workerScriptPath: string;

  constructor(options: SessionHistoryPoolOptions = {}) {
    const cores = typeof os.availableParallelism === "function" ? os.availableParallelism() : (os.cpus()?.length || 1);
    this.maxWorkers = options.maxWorkers ?? Math.min(2, Math.max(1, Math.floor(cores / 2)));
    this.maxQueueSize = options.maxQueueSize ?? DEFAULT_MAX_QUEUE_SIZE;
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
    this.slots = new Array(this.maxWorkers).fill(null);
    this.workerScriptPath = options.workerScriptPath ?? path.resolve(process.cwd(), "bin", "session-history-worker.cjs");
  }

  public getMaxWorkers(): number {
    return this.maxWorkers;
  }

  public getQueueLength(): number {
    return this.queue.length;
  }

  public getActiveWorkerCount(): number {
    return this.slots.filter((s) => s !== null && !s.isTerminating).length;
  }

  private hashFilePath(filePath: string): number {
    let hash = 0;
    for (let i = 0; i < filePath.length; i++) {
      hash = (hash * 31 + filePath.charCodeAt(i)) >>> 0;
    }
    return hash % this.maxWorkers;
  }

  private updateWorkerRef(): void {
    const hasWork = this.queue.length > 0 || this.slots.some((s) => s !== null && s.activeTask !== null);
    for (const slot of this.slots) {
      if (slot && !slot.isTerminating) {
        if (hasWork) {
          slot.worker.ref();
        } else {
          slot.worker.unref();
        }
      }
    }
  }

  private cleanupTaskListeners(task: PendingTask): void {
    if (task.timer) {
      clearTimeout(task.timer);
      task.timer = undefined;
    }
    if (task.queueTimer) {
      clearTimeout(task.queueTimer);
      task.queueTimer = undefined;
    }
    if (task.signalListener && task.options.signal) {
      task.options.signal.removeEventListener("abort", task.signalListener);
      task.signalListener = undefined;
    }
  }

  private ensureWorker(slotIndex: number): WorkerSlot {
    const existing = this.slots[slotIndex];
    if (existing && !existing.isTerminating) {
      if (existing.idleTimer) {
        clearTimeout(existing.idleTimer);
        existing.idleTimer = undefined;
      }
      return existing;
    }

    if (!fs.existsSync(this.workerScriptPath)) {
      throw new Error(`Worker script not found at ${this.workerScriptPath}. Run prebuild/predev first.`);
    }

    const worker = new Worker(this.workerScriptPath, {
      workerData: {
        detailManagerCacheBudgetBytes: Math.floor(MAX_DETAIL_MANAGER_CACHE_BYTES / this.maxWorkers),
      },
    });
    worker.unref();

    const slot: WorkerSlot = {
      worker,
      activeTask: null,
      isTerminating: false,
    };

    worker.on("message", (msg: WorkerResponseMessage) => {
      if (this.slots[slotIndex] !== slot) return;
      this.handleWorkerMessage(slotIndex, slot, msg);
    });

    worker.on("error", (err: unknown) => {
      if (this.slots[slotIndex] !== slot) return;
      this.handleWorkerCrash(slotIndex, slot, err instanceof Error ? err : new Error(String(err)));
    });

    worker.on("exit", (code: number) => {
      if (this.slots[slotIndex] !== slot) return;
      if (!slot.isTerminating) {
        this.handleWorkerCrash(slotIndex, slot, new Error(`Session history worker exited unexpectedly with code ${code}`));
      }
    });

    this.slots[slotIndex] = slot;
    return slot;
  }

  private handleWorkerMessage(
    slotIndex: number,
    slot: WorkerSlot,
    msg: WorkerResponseMessage,
  ): void {
    if (!slot.activeTask || slot.activeTask.id !== msg.id) {
      return;
    }

    const task = slot.activeTask;
    slot.activeTask = null;
    this.cleanupTaskListeners(task);

    if (msg.success && typeof msg.jsonString === "string") {
      task.resolve({ jsonString: msg.jsonString, fingerprint: typeof msg.fingerprint === "string" ? msg.fingerprint : null });
    } else {
      const err = new Error(msg.error?.message || "Worker query failed");
      if (msg.error?.name) err.name = msg.error.name;
      if (msg.error?.statusCode) (err as Error & { statusCode?: number }).statusCode = msg.error.statusCode;
      if (msg.error?.retryable) (err as Error & { retryable?: boolean }).retryable = true;
      if (msg.error?.code) (err as Error & { code?: string }).code = msg.error.code;
      task.reject(err);
    }

    this.updateWorkerRef();
    this.scheduleNext(slotIndex);
  }

  private handleWorkerCrash(slotIndex: number, slot: WorkerSlot, err: Error): void {
    slot.isTerminating = true;
    const task = slot.activeTask;
    slot.activeTask = null;

    if (task) {
      this.cleanupTaskListeners(task);
      task.reject(err);
    }

    try {
      slot.worker.terminate();
    } catch {
      // ignore
    }
    this.slots[slotIndex] = null;

    this.updateWorkerRef();
    this.scheduleNext();
  }

  private terminateWorkerOnTimeout(slotIndex: number, slot: WorkerSlot, task: PendingTask): void {
    slot.isTerminating = true;
    slot.activeTask = null;
    this.cleanupTaskListeners(task);

    try {
      slot.worker.postMessage({ id: task.id, type: "cancel" });
    } catch {
      // ignore
    }

    try {
      slot.worker.terminate();
    } catch {
      // ignore
    }
    this.slots[slotIndex] = null;

    task.reject(new HistoryTimeoutError());

    this.updateWorkerRef();
    this.scheduleNext();
  }

  private scheduleNext(slotIndex?: number): void {
    if (this.queue.length === 0) {
      if (typeof slotIndex === "number") {
        const slot = this.slots[slotIndex];
        if (slot && !slot.activeTask && !slot.idleTimer) {
          slot.idleTimer = setTimeout(() => {
            if (slot.activeTask === null) {
              slot.isTerminating = true;
              slot.worker.terminate();
              this.slots[slotIndex] = null;
            }
          }, this.idleTimeoutMs);
          slot.idleTimer.unref();
        }
      }
      this.updateWorkerRef();
      return;
    }

    const slotsToCheck: number[] = [];
    if (typeof slotIndex === "number") {
      slotsToCheck.push(slotIndex);
    } else {
      for (let i = 0; i < this.maxWorkers; i++) {
        slotsToCheck.push(i);
      }
    }

    for (const sIndex of slotsToCheck) {
      const slot = this.slots[sIndex];
      if (slot && slot.activeTask) continue; // slot busy

      // Strict file affinity: only dispatch task whose preferredSlot === sIndex
      const taskIndex = this.queue.findIndex((t) => t.preferredSlot === sIndex);
      if (taskIndex !== -1) {
        const [task] = this.queue.splice(taskIndex, 1);
        this.dispatchTaskToSlot(sIndex, task);
      }
    }

    this.updateWorkerRef();
  }

  private dispatchTaskToSlot(slotIndex: number, task: PendingTask): void {
    // Clear queue-stage listeners before running
    if (task.queueTimer) {
      clearTimeout(task.queueTimer);
      task.queueTimer = undefined;
    }
    if (task.signalListener && task.options.signal) {
      task.options.signal.removeEventListener("abort", task.signalListener);
      task.signalListener = undefined;
    }

    let slot: WorkerSlot;
    try {
      slot = this.ensureWorker(slotIndex);
    } catch (err: unknown) {
      task.reject(err instanceof Error ? err : new Error(String(err)));
      this.updateWorkerRef();
      return;
    }

    slot.activeTask = task;

    task.timer = setTimeout(() => {
      this.terminateWorkerOnTimeout(slotIndex, slot, task);
    }, Math.max(1, task.deadline - performance.now()));
    task.timer.unref();

    if (task.options.signal) {
      const onAbort = () => {
        if (slot.activeTask === task) {
          this.cleanupTaskListeners(task);
          task.reject(new HistoryAbortedError());
          slot.isTerminating = true;
          slot.activeTask = null;
          try {
            slot.worker.terminate();
          } catch {
            // ignore
          }
          this.slots[slotIndex] = null;
          this.updateWorkerRef();
          this.scheduleNext();
        }
      };
      task.signalListener = onAbort;
      task.options.signal.addEventListener("abort", onAbort, { once: true });
      // Close the race between the initial enqueue check and listener setup.
      if (task.options.signal.aborted) onAbort();
      if (slot.activeTask !== task) return;
    }

    this.updateWorkerRef();

    try {
      let wireOptions: Record<string, unknown>;
      if (task.type === "queryContext") {
        const options = task.options;
        wireOptions = {
          leafId: options.leafId,
          onlyEntry: options.onlyEntry,
          tail: options.tail,
          before: options.before,
          deferThinking: options.deferThinking,
          deferToolResultImages: options.deferToolResultImages,
          sessionId: options.sessionId,
          requireCursor: options.requireCursor,
          includeFingerprint: options.includeFingerprint,
          fingerprintOnly: options.fingerprintOnly,
        };
      } else {
        const options = task.options;
        wireOptions = {
          sessionId: options.sessionId,
          sourceId: options.sourceId,
          summaryTree: options.summaryTree,
          deferToolResults: options.deferToolResults,
          deferThinking: options.deferThinking,
          deferToolResultImages: options.deferToolResultImages,
          tail: options.tail,
        };
      }
      slot.worker.postMessage({
        id: task.id,
        type: task.type,
        filePath: task.filePath,
        options: wireOptions,
      });
    } catch (postErr: unknown) {
      slot.isTerminating = true;
      slot.activeTask = null;
      this.cleanupTaskListeners(task);
      try {
        slot.worker.terminate();
      } catch {
        // ignore
      }
      this.slots[slotIndex] = null;
      task.reject(postErr instanceof Error ? postErr : new Error(String(postErr)));
      this.updateWorkerRef();
      this.scheduleNext();
    }
  }

  public queryContext(filePath: string, options: QueryContextWorkerOptions = {}): Promise<string> {
    return this.queryContextResult(filePath, options).then(result => result.jsonString);
  }

  public queryContextResult(
    filePath: string,
    options: QueryContextWorkerOptions = {},
  ): Promise<HistoryContextReadResult> {
    return this.enqueueTask("queryContext", filePath, options);
  }

  public querySessionDetail(filePath: string, options: QuerySessionDetailWorkerOptions): Promise<string> {
    return this.querySessionDetailResult(filePath, options).then(result => result.jsonString);
  }

  public querySessionDetailResult(
    filePath: string,
    options: QuerySessionDetailWorkerOptions,
  ): Promise<HistoryContextReadResult> {
    return this.enqueueTask("querySessionDetail", filePath, options);
  }

  private enqueueTask(
    type: PendingTask["type"],
    filePath: string,
    options: QueryContextWorkerOptions | QuerySessionDetailWorkerOptions,
  ): Promise<HistoryContextReadResult> {
    if (options.signal?.aborted) {
      return Promise.reject(new HistoryAbortedError());
    }

    const preferredSlot = this.hashFilePath(filePath);
    const requestId = this.nextRequestId++;

    return new Promise<HistoryContextReadResult>((resolve, reject) => {
      const common = {
        id: requestId,
        filePath,
        preferredSlot,
        deadline: performance.now() + this.requestTimeoutMs,
        resolve,
        reject,
      };
      const task: PendingTask = type === "queryContext"
        ? { ...common, type, options: options as QueryContextWorkerOptions }
        : { ...common, type, options: options as QuerySessionDetailWorkerOptions };

      const prefSlotInstance = this.slots[preferredSlot];
      if (!prefSlotInstance || (!prefSlotInstance.activeTask && !prefSlotInstance.isTerminating)) {
        this.dispatchTaskToSlot(preferredSlot, task);
        return;
      }

      if (this.queue.length >= this.maxQueueSize) {
        reject(new HistoryQueueFullError());
        return;
      }

      // Queue wait shares the same bounded deadline as worker execution.
      task.queueTimer = setTimeout(() => {
        const idx = this.queue.indexOf(task);
        if (idx !== -1) {
          this.queue.splice(idx, 1);
          this.cleanupTaskListeners(task);
          task.reject(new HistoryTimeoutError("会话历史读取排队超时。"));
          this.updateWorkerRef();
        }
      }, this.requestTimeoutMs);
      task.queueTimer.unref();

      if (options.signal) {
        task.signalListener = () => {
          const idx = this.queue.indexOf(task);
          if (idx !== -1) {
            this.queue.splice(idx, 1);
            this.cleanupTaskListeners(task);
            task.reject(new HistoryAbortedError());
            this.updateWorkerRef();
          }
        };
        options.signal.addEventListener("abort", task.signalListener, { once: true });
      }

      this.queue.push(task);
      this.updateWorkerRef();
    });
  }

  public async closeAll(): Promise<void> {
    const queuedTasks = this.queue.splice(0, this.queue.length);
    for (const task of queuedTasks) {
      this.cleanupTaskListeners(task);
      task.reject(new Error("SessionHistoryPool closed"));
    }

    for (let i = 0; i < this.slots.length; i++) {
      const slot = this.slots[i];
      if (slot) {
        slot.isTerminating = true;
        if (slot.idleTimer) clearTimeout(slot.idleTimer);
        const task = slot.activeTask;
        slot.activeTask = null;
        if (task) {
          this.cleanupTaskListeners(task);
          task.reject(new Error("SessionHistoryPool closed"));
        }
        try {
          await slot.worker.terminate();
        } catch {
          // ignore
        }
        this.slots[i] = null;
      }
    }
    this.updateWorkerRef();
  }
}

declare global {
  var __piSessionHistoryPool: SessionHistoryPool | undefined;
}

export function getSessionHistoryPool(): SessionHistoryPool {
  if (!globalThis.__piSessionHistoryPool) {
    globalThis.__piSessionHistoryPool = new SessionHistoryPool();
  }
  return globalThis.__piSessionHistoryPool;
}
