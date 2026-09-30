import type {
  AgentMessage,
  AssistantContentBlock,
  AssistantMessage,
} from "./types.ts";
import {
  getAssistantErrorMessage,
  isAssistantTruncated,
  isMessageGroupAnchor,
  splitFinalAssistantBlocks,
} from "./message-display.ts";

export const PROCESS_COLLAPSE_CHANGE_EVENT = "pi-enh-process-collapse-change";
export const NATIVE_PROCESS_COLLAPSE_VERSION = 1;
export const HISTORY_LOAD_TAIL_MIN = 50;
export const HISTORY_LOAD_TAIL_MAX = 500;
export const HISTORY_LOAD_TAIL_DEFAULT = 250;

export interface EnhancementHistoryState {
  sessionId: string | null;
  totalTurns: number;
  hasEarlierMessages: boolean;
  entryIds: string[];
  oldestEntryId: string | null;
}

export interface UserMessageReconcileOptions<TMessage = AgentMessage> {
  lastFingerprint: string | null;
  serverFingerprint: string;
  fingerprintFn: (message: TMessage) => string;
  fallback: () => TMessage[];
}

export type UserMessageReconcileHook<TMessage = AgentMessage> = (
  prevMessages: TMessage[],
  serverMessage: TMessage,
  options: UserMessageReconcileOptions<TMessage>,
) => TMessage[];

export interface SessionReloadController {
  getSessionId: () => string | null;
  isActive?: () => boolean;
  reloadSession: (
    sessionId: string,
    showLoading?: boolean,
    includeState?: boolean,
    options?: { force?: boolean },
  ) => unknown;
}

export interface EnhancementWindowLike {
  __PI_ENH_NATIVE_PROCESS_COLLAPSE__?: number;
  __PI_ENH_IS_PLUGIN_ENABLED__?: (id: string) => boolean;
  __PI_ENH_GET_HISTORY_STATE__?: () => EnhancementHistoryState;
  __PI_ENH_LOAD_EARLIER__?: (tail?: unknown, source?: string) => Promise<boolean>;
  __PI_ENH_PREPARE_HISTORY_COMMIT__?: () => void;
  __PI_WEB_RELOAD_SESSION__?: (
    sessionId: string,
    showLoading?: boolean,
    includeState?: boolean,
    options?: { force?: boolean },
  ) => unknown;
  __PI_WEB_NATIVE_RELOAD_CURRENT_SESSION__?: (showLoading?: boolean) => unknown;
  __PI_ENH_RELOAD_CURRENT_SESSION__?: (showLoading?: boolean) => unknown;
  __PI_ENH_RECONCILE_USER_MESSAGE__?: UserMessageReconcileHook<any>;
  localStorage?: Pick<Storage, "getItem"> | null;
  location?: { search?: string } | null;
  addEventListener?: (type: string, listener: EventListenerOrEventListenerObject) => void;
  removeEventListener?: (type: string, listener: EventListenerOrEventListenerObject) => void;
}

export function getEnhancementWindow(): EnhancementWindowLike | null {
  if (typeof window === "undefined") return null;
  return window as unknown as EnhancementWindowLike;
}

export function installNativeProcessCollapseFlag(
  win: EnhancementWindowLike | null = getEnhancementWindow(),
): void {
  if (!win) return;
  win.__PI_ENH_NATIVE_PROCESS_COLLAPSE__ = NATIVE_PROCESS_COLLAPSE_VERSION;
}

if (typeof window !== "undefined") {
  installNativeProcessCollapseFlag();
}

export function isEnhancementPluginEnabled(
  id = "task-tool-auto-collapse",
  win: EnhancementWindowLike | null = getEnhancementWindow(),
): boolean {
  if (!win) return true;
  if (typeof win.__PI_ENH_IS_PLUGIN_ENABLED__ === "function") {
    try {
      return Boolean(win.__PI_ENH_IS_PLUGIN_ENABLED__(id));
    } catch {
      // Fall back to localStorage below if the runtime bridge throws.
    }
  }
  try {
    const rawSettings = win.localStorage?.getItem("pi-enh-settings-v1") || "{}";
    const config = JSON.parse(rawSettings) as {
      modules?: Record<string, { enabled?: boolean }>;
      features?: Record<string, { enabled?: boolean }>;
    };
    if (config.modules?.["conversation-navigation"]?.enabled === false) {
      return false;
    }
    const enabled = config.features?.[id]?.enabled;
    if (typeof enabled === "boolean") return enabled;
    return win.localStorage?.getItem(`pi-enh-plugin-${id}`) !== "false";
  } catch {
    return true;
  }
}

export function subscribeProcessCollapseChange(
  onChange: () => void,
  win: EnhancementWindowLike | null = getEnhancementWindow(),
): () => void {
  if (!win || typeof win.addEventListener !== "function" || typeof win.removeEventListener !== "function") {
    return () => {};
  }
  const listener = () => onChange();
  win.addEventListener(PROCESS_COLLAPSE_CHANGE_EVENT, listener);
  return () => {
    win.removeEventListener?.(PROCESS_COLLAPSE_CHANGE_EVENT, listener);
  };
}

export function withAssistantBlocks(
  message: AssistantMessage,
  content: AssistantContentBlock[],
  options: { omitUsage?: boolean } = {},
): AssistantMessage {
  const next = { ...message, content };
  if (options.omitUsage) next.usage = undefined;
  return next;
}

export function hasFinalAssistantAnswer(message: AgentMessage): boolean {
  if (message.role !== "assistant") return false;
  return splitFinalAssistantBlocks(message as AssistantMessage).answerBlocks.some((block) => (
    block.type === "image" || (block.type === "text" && block.text.trim().length > 0)
  ));
}

export function findFinalAssistantIndex(
  messages: readonly AgentMessage[],
  userIdx: number,
  endIdx: number,
): number {
  for (let candidateIdx = endIdx - 1; candidateIdx > userIdx; candidateIdx--) {
    if (hasFinalAssistantAnswer(messages[candidateIdx])) return candidateIdx;
  }
  return findLastAssistantIndex(messages, userIdx, endIdx);
}

export function findLastAssistantIndex(
  messages: readonly AgentMessage[],
  userIdx: number,
  endIdx: number,
): number {
  for (let candidateIdx = endIdx - 1; candidateIdx > userIdx; candidateIdx--) {
    if (messages[candidateIdx]?.role === "assistant") return candidateIdx;
  }
  return -1;
}

export function collectTurnPublicOutput(
  messages: readonly AgentMessage[],
  startIndex: number,
  endIndex: number,
): {
  visibleBlocks: AssistantContentBlock[];
  processByIndex: Map<number, AssistantContentBlock[]>;
} {
  const visibleBlocks: AssistantContentBlock[] = [];
  const processByIndex = new Map<number, AssistantContentBlock[]>();
  for (let index = Math.max(0, startIndex + 1); index <= endIndex; index += 1) {
    const message = messages[index];
    if (message?.role !== "assistant") continue;
    const processBlocks: AssistantContentBlock[] = [];
    for (const block of (message as AssistantMessage).content ?? []) {
      if (!block) continue;
      if (block.type === "text") {
        if (typeof block.text === "string" && block.text.trim().length > 0) {
          visibleBlocks.push(block);
        }
      } else if (block.type === "thinking" || block.type === "toolCall") {
        processBlocks.push(block);
      } else {
        // Unknown or non-process output types (image, future blocks) fail open.
        visibleBlocks.push(block);
      }
    }
    processByIndex.set(index, processBlocks);
  }
  return { visibleBlocks, processByIndex };
}

export function resolveTurnGroupRange(
  messages: readonly AgentMessage[],
  startIndex: number,
  collapseEnabled: boolean,
): { userIdx: number; endIdx: number } | null {
  const msg = messages[startIndex];
  if (!msg) return null;
  const isAnchor = isMessageGroupAnchor(msg);
  if (!isAnchor && !(startIndex === 0 && collapseEnabled)) {
    return null;
  }
  const userIdx = isAnchor ? startIndex : -1;
  let endIdx = userIdx + 1;
  while (endIdx < messages.length && !isMessageGroupAnchor(messages[endIdx])) {
    endIdx += 1;
  }
  return { userIdx, endIdx };
}

export function splitTurnMessagesForDisplay(
  messages: readonly AgentMessage[],
  userIdx: number,
  endIdx: number,
  collapseEnabled: boolean,
): {
  finalAssistantIdx: number;
  finalAnswerMessage: AssistantMessage | null;
  getProcessAssistantMessage: (processIdx: number, processMessage: AssistantMessage) => AssistantMessage;
} {
  const finalAssistantIdx = collapseEnabled
    ? findLastAssistantIndex(messages, userIdx, endIdx)
    : findFinalAssistantIndex(messages, userIdx, endIdx);

  if (finalAssistantIdx === -1) {
    return {
      finalAssistantIdx: -1,
      finalAnswerMessage: null,
      getProcessAssistantMessage: (_, processMessage) => processMessage,
    };
  }

  const finalAssistant = messages[finalAssistantIdx] as AssistantMessage;

  if (collapseEnabled) {
    const { visibleBlocks, processByIndex } = collectTurnPublicOutput(
      messages,
      userIdx,
      finalAssistantIdx,
    );
    const hasPublicAnswer = visibleBlocks.length > 0
      || Boolean(getAssistantErrorMessage(finalAssistant))
      || isAssistantTruncated(finalAssistant);
    const finalAnswerMessage = hasPublicAnswer
      ? withAssistantBlocks(finalAssistant, visibleBlocks)
      : null;

    return {
      finalAssistantIdx,
      finalAnswerMessage,
      getProcessAssistantMessage: (processIdx, processMessage) => (
        withAssistantBlocks(
          processMessage,
          processByIndex.get(processIdx) ?? [],
          { omitUsage: processIdx === finalAssistantIdx && Boolean(finalAnswerMessage) },
        )
      ),
    };
  }

  const finalSplit = splitFinalAssistantBlocks(finalAssistant);
  const finalAnswerMessage = finalSplit.answerBlocks.length > 0
    || Boolean(getAssistantErrorMessage(finalAssistant))
    || isAssistantTruncated(finalAssistant)
    ? withAssistantBlocks(finalAssistant, finalSplit.answerBlocks)
    : null;
  const finalProcessEnd = finalAssistant.content.indexOf(finalSplit.answerBlocks[0]);
  const finalProcessBlocks = finalAssistant.content.slice(
    0,
    finalProcessEnd < 0 ? undefined : finalProcessEnd,
  );

  return {
    finalAssistantIdx,
    finalAnswerMessage,
    getProcessAssistantMessage: (processIdx, processMessage) => (
      processIdx === finalAssistantIdx
        ? withAssistantBlocks(processMessage, finalProcessBlocks, {
          omitUsage: Boolean(finalAnswerMessage),
        })
        : processMessage
    ),
  };
}

export function clampHistoryLoadTail(
  requestedTail: unknown,
  fallback = HISTORY_LOAD_TAIL_DEFAULT,
): number {
  if (
    requestedTail === undefined
    || requestedTail === null
    || requestedTail === ""
    || typeof requestedTail === "boolean"
  ) {
    return fallback;
  }
  const numeric = typeof requestedTail === "number" ? requestedTail : Number(requestedTail);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(
    HISTORY_LOAD_TAIL_MIN,
    Math.min(HISTORY_LOAD_TAIL_MAX, Math.round(numeric)),
  );
}

export function buildEnhancementHistoryState(input: {
  sessionId: string | null | undefined;
  totalTurns: number | null | undefined;
  hasEarlierMessages: boolean;
  entryIds: readonly string[];
  oldestEntryId: string | null | undefined;
}): EnhancementHistoryState {
  const rawTurns = input.totalTurns;
  const totalTurns = typeof rawTurns === "number" && Number.isFinite(rawTurns) && rawTurns > 0
    ? Math.floor(rawTurns)
    : 0;
  return {
    sessionId: input.sessionId ?? null,
    totalTurns,
    hasEarlierMessages: Boolean(input.hasEarlierMessages),
    entryIds: Array.isArray(input.entryIds) ? [...input.entryIds] : [],
    oldestEntryId: input.oldestEntryId ?? null,
  };
}

export interface EarlierHistoryLoaderDeps<
  TContext extends { messages?: readonly unknown[]; entryIds?: readonly string[] } = {
    messages: AgentMessage[];
    entryIds: string[];
  },
> {
  isLoading: () => boolean;
  setLoading: (loading: boolean) => void;
  hasEarlierMessages: () => boolean;
  getOldestEntryId: () => string | null;
  getSessionId: () => string | null;
  getActiveLeafId: () => string | null;
  isMounted?: () => boolean;
  captureScrollAnchor?: () => void;
  clearScrollAnchor?: () => void;
  loadContext: (
    sessionId: string,
    leafId: string | null,
    before: string,
    options: { tail: number },
  ) => Promise<TContext | null | undefined>;
  onContextLoaded?: (context: TContext) => void;
}

export function createEarlierHistoryLoader<
  TContext extends { messages?: readonly unknown[]; entryIds?: readonly string[] },
>(deps: EarlierHistoryLoaderDeps<TContext>): (requestedTail?: unknown) => Promise<boolean> {
  return async (requestedTail?: unknown): Promise<boolean> => {
    if (deps.isLoading() || !deps.hasEarlierMessages()) return false;
    const oldestId = deps.getOldestEntryId();
    if (!oldestId) return false;
    const sessionId = deps.getSessionId();
    if (!sessionId) return false;
    const leafId = deps.getActiveLeafId();
    const tail = clampHistoryLoadTail(requestedTail);

    deps.setLoading(true);
    deps.captureScrollAnchor?.();
    try {
      const context = await deps.loadContext(sessionId, leafId, oldestId, { tail });
      if (
        !context
        || (deps.isMounted && !deps.isMounted())
        || deps.getSessionId() !== sessionId
        || deps.getActiveLeafId() !== leafId
      ) {
        deps.clearScrollAnchor?.();
        return false;
      }
      if (!Array.isArray(context.messages) || context.messages.length === 0) {
        deps.clearScrollAnchor?.();
      }
      deps.onContextLoaded?.(context);
      return true;
    } catch {
      deps.clearScrollAnchor?.();
      return false;
    } finally {
      deps.setLoading(false);
    }
  };
}

export function registerHistoryViewportBridges(
  win: EnhancementWindowLike | null | undefined,
  handlers: {
    getHistoryState: () => EnhancementHistoryState;
    loadEarlier: (requestedTail?: unknown) => Promise<boolean>;
    prepareHistoryCommit: () => void;
  },
): () => void {
  if (!win) return () => {};
  const { getHistoryState, loadEarlier, prepareHistoryCommit } = handlers;
  win.__PI_ENH_GET_HISTORY_STATE__ = getHistoryState;
  win.__PI_ENH_LOAD_EARLIER__ = loadEarlier;
  win.__PI_ENH_PREPARE_HISTORY_COMMIT__ = prepareHistoryCommit;
  return () => {
    if (win.__PI_ENH_GET_HISTORY_STATE__ === getHistoryState) {
      delete win.__PI_ENH_GET_HISTORY_STATE__;
    }
    if (win.__PI_ENH_LOAD_EARLIER__ === loadEarlier) {
      delete win.__PI_ENH_LOAD_EARLIER__;
    }
    if (win.__PI_ENH_PREPARE_HISTORY_COMMIT__ === prepareHistoryCommit) {
      delete win.__PI_ENH_PREPARE_HISTORY_COMMIT__;
    }
  };
}

interface ReloadRegistryState {
  controllers: Set<SessionReloadController>;
  reloadSessionBridge: (
    sessionId: string,
    showLoading?: boolean,
    includeState?: boolean,
    options?: { force?: boolean },
  ) => unknown;
  nativeReloadCurrentBridge: (showLoading?: boolean) => unknown;
  fallbackEnhReloadCurrentBridge: (showLoading?: boolean) => unknown;
}

const reloadRegistries = new WeakMap<EnhancementWindowLike, ReloadRegistryState>();

function resolveWindowActiveSessionId(win: EnhancementWindowLike): string | null {
  try {
    const historySid = win.__PI_ENH_GET_HISTORY_STATE__?.()?.sessionId;
    if (typeof historySid === "string" && historySid.length > 0) return historySid;
  } catch {
    // Ignore history bridge errors.
  }
  try {
    const search = win.location?.search;
    if (typeof search === "string" && search.length > 0) {
      const sid = new URLSearchParams(search).get("session");
      if (sid) return sid;
    }
  } catch {
    // Ignore URL parsing errors.
  }
  return null;
}

function findCurrentController(
  controllers: Set<SessionReloadController>,
  win: EnhancementWindowLike,
): SessionReloadController | null {
  const list = Array.from(controllers);
  if (list.length === 0) return null;

  const activeSid = resolveWindowActiveSessionId(win);
  if (activeSid) {
    for (let i = list.length - 1; i >= 0; i--) {
      const c = list[i];
      if (c.getSessionId() === activeSid && c.isActive?.() !== false) return c;
    }
    for (let i = list.length - 1; i >= 0; i--) {
      const c = list[i];
      if (c.getSessionId() === activeSid) return c;
    }
  }

  for (let i = list.length - 1; i >= 0; i--) {
    const c = list[i];
    if (c.isActive?.() === true && c.getSessionId()) return c;
  }

  for (let i = list.length - 1; i >= 0; i--) {
    const c = list[i];
    if (c.getSessionId()) return c;
  }

  return list[list.length - 1] ?? null;
}

function findControllerForSession(
  controllers: Set<SessionReloadController>,
  sessionId: string,
  win: EnhancementWindowLike,
): SessionReloadController | null {
  const list = Array.from(controllers);
  if (list.length === 0) return null;

  for (let i = list.length - 1; i >= 0; i--) {
    const c = list[i];
    if (c.getSessionId() === sessionId && c.isActive?.() !== false) return c;
  }
  for (let i = list.length - 1; i >= 0; i--) {
    const c = list[i];
    if (c.getSessionId() === sessionId) return c;
  }

  return findCurrentController(controllers, win);
}

function getOrCreateReloadRegistry(win: EnhancementWindowLike): ReloadRegistryState {
  let state = reloadRegistries.get(win);
  if (state) return state;

  const controllers = new Set<SessionReloadController>();
  const nativeReloadCurrentBridge = (showLoading = false): unknown => {
    const controller = findCurrentController(controllers, win);
    const sid = controller?.getSessionId();
    if (!controller || !sid) return false;
    return controller.reloadSession(sid, Boolean(showLoading), true);
  };
  const reloadSessionBridge = (
    sessionId: string,
    showLoading = false,
    includeState = true,
    options?: { force?: boolean },
  ): unknown => {
    if (!sessionId) return nativeReloadCurrentBridge(showLoading);
    const controller = findControllerForSession(controllers, sessionId, win);
    if (!controller) return false;
    return controller.reloadSession(sessionId, Boolean(showLoading), includeState, options);
  };
  const fallbackEnhReloadCurrentBridge = (showLoading = false): unknown => (
    nativeReloadCurrentBridge(showLoading)
  );

  state = {
    controllers,
    reloadSessionBridge,
    nativeReloadCurrentBridge,
    fallbackEnhReloadCurrentBridge,
  };
  reloadRegistries.set(win, state);
  return state;
}

export function registerSessionReloadAliases(
  win: EnhancementWindowLike | null | undefined,
  controller: SessionReloadController,
): () => void {
  if (!win) return () => {};
  const state = getOrCreateReloadRegistry(win);
  // Refresh insertion order so the latest mounted/updated active pane is preferred.
  state.controllers.delete(controller);
  state.controllers.add(controller);

  win.__PI_WEB_RELOAD_SESSION__ = state.reloadSessionBridge;
  win.__PI_WEB_NATIVE_RELOAD_CURRENT_SESSION__ = state.nativeReloadCurrentBridge;
  if (typeof win.__PI_ENH_RELOAD_CURRENT_SESSION__ !== "function") {
    win.__PI_ENH_RELOAD_CURRENT_SESSION__ = state.fallbackEnhReloadCurrentBridge;
  }

  return () => {
    state.controllers.delete(controller);
    if (state.controllers.size === 0) {
      if (win.__PI_WEB_RELOAD_SESSION__ === state.reloadSessionBridge) {
        delete win.__PI_WEB_RELOAD_SESSION__;
      }
      if (win.__PI_WEB_NATIVE_RELOAD_CURRENT_SESSION__ === state.nativeReloadCurrentBridge) {
        delete win.__PI_WEB_NATIVE_RELOAD_CURRENT_SESSION__;
      }
      if (win.__PI_ENH_RELOAD_CURRENT_SESSION__ === state.fallbackEnhReloadCurrentBridge) {
        delete win.__PI_ENH_RELOAD_CURRENT_SESSION__;
      }
    }
  };
}

export function markOptimisticUserMessage<T extends object>(message: T): T {
  try {
    Object.defineProperty(message, "__piEnhOptimistic", {
      value: true,
      configurable: true,
      enumerable: false,
    });
  } catch {
    // Ignore non-extensible objects.
  }
  return message;
}

export function reconcileDeliveredUserMessage<TMessage extends AgentMessage>(
  prevMessages: TMessage[],
  deliveredMessage: TMessage,
  options: UserMessageReconcileOptions<TMessage>,
  win: EnhancementWindowLike | null = getEnhancementWindow(),
): TMessage[] {
  try {
    const hook = win?.__PI_ENH_RECONCILE_USER_MESSAGE__;
    if (typeof hook === "function") {
      const reconciled = hook(prevMessages, deliveredMessage, options);
      if (Array.isArray(reconciled)) {
        return reconciled;
      }
    }
  } catch {
    // Fall back to native user message reconciliation if the enhancement hook throws.
  }
  return options.fallback();
}
