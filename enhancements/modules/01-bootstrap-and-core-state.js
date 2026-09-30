/**
 * Pi Web Enhancements v4.3.4:
 * 1. Session Row Context Menu (Right-click in sidebar)
 *    - Copy Session ID / Path / Prompt / CWD
 * 2. Quick Action Quote Toolbar (Select text in chat output)
 *    - Actions: [ “ 引用 | 解释 | 单测 | 排查 | 优化 ]
 *    - Formats text as Markdown quote + auto-appends targeted prompt
 * 3. Total Task Duration Breakdown Tooltip (悬浮耗时拆解气泡)
 *    - Hover on ⏱️ badge in assistant message footer
 *    - Breakdown: Thinking, Tools (with sub-tool counts), Generation/Network
 *    - Colorful segment progress bar + detail breakdown table
 * 4. Toast Notifications
 * 5. Session Scroll Position Memory & Restore (会话阅读位置记忆与恢复)
 *    - 记忆跨会话阅读位置，切换会话后自动平滑恢复至上次阅读进度
 */
(function () {
  "use strict";

  // 默认语言中文智能对齐：未设置时优先使用简体中文
  try {
    if (!localStorage.getItem("pi-locale")) {
      localStorage.setItem("pi-locale", "zh-CN");
    }
  } catch (e) {}

  // React DOM Reconciliation 物理安全防崩网：
  // 杜绝第三方脚本包裹/微调原生 DOM 节点后 React 切换 Tab 时触发的 NotFoundError: Failed to execute 'insertBefore' on 'Node'
  try {
    if (typeof Node !== "undefined" && Node.prototype && !Node.prototype.__pi_orig_insertBefore__) {
      const origInsertBefore = Node.prototype.insertBefore;
      Node.prototype.__pi_orig_insertBefore__ = origInsertBefore;
      Node.prototype.insertBefore = function (newNode, referenceNode) {
        if (referenceNode && referenceNode.parentNode !== this) {
          return this.appendChild(newNode);
        }
        return origInsertBefore.apply(this, arguments);
      };
    }
  } catch (e) {}

  // 0. 路由自愈保护：如果用户通过直连路径 (如 /01a0bf39-...) 访问导致 404，毫秒级自动重定向到合法的 Query 模式 /?session=<id>
  try {
    if (typeof window !== "undefined" && window.location) {
      const rawPath = String(window.location.pathname || "").replace(/^\/+|\/+$/g, "");
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawPath)) {
        const targetSearch = new URLSearchParams(window.location.search || "");
        targetSearch.set("session", rawPath);
        const nextUrl = "/?" + targetSearch.toString();
        window.location.replace(nextUrl);
        return;
      }
    }
  } catch (e) {}

  // 0.2 Logo 浏览器缓存与首屏秒开常驻加速引擎 (Instant Logo Preload & Cache Engine)
  function isPiWebPlusBrandingActiveEarly() {
    if (typeof isPluginEnabled === "function") {
      try {
        return Boolean(isPluginEnabled("pi-web-plus-branding"));
      } catch (e) {}
    }
    try {
      if (typeof localStorage !== "undefined" && localStorage) {
        const direct = localStorage.getItem("pi-enh-plugin-pi-web-plus-branding");
        if (direct === "false") return false;
        if (direct === "true") return true;
        const raw = localStorage.getItem("pi-enh-settings-v1") || localStorage.getItem("pi-enh-features");
        if (raw) {
          const cfg = JSON.parse(raw);
          if (cfg && cfg.modules && cfg.modules["local-workspace"] && cfg.modules["local-workspace"].enabled === false) {
            return false;
          }
          if (cfg && cfg.features && cfg.features["pi-web-plus-branding"] && cfg.features["pi-web-plus-branding"].enabled === false) {
            return false;
          }
          if (cfg && cfg["pi-web-plus-branding"] && cfg["pi-web-plus-branding"].enabled === false) {
            return false;
          }
        }
      }
    } catch (e) {}
    return true;
  }

  (function initLogoInstantCache() {
    if (typeof window === "undefined") return;
    const LOGO_PATH = "/icons/apple-touch-icon.png";
    if (isPiWebPlusBrandingActiveEarly()) {
      try {
        if (typeof document !== "undefined" && document.head) {
          for (const preloadLink of document.head.querySelectorAll(`link[rel="preload"][href*="${LOGO_PATH}"]`)) {
            preloadLink.remove();
          }
        }
        delete window.__PI_ENH_LOGO_PRELOAD_IMG__;
      } catch {}
      return;
    }

    // A. 动态注入 <link rel="preload"> 提升网络层解析优先级
    try {
      if (document.head && !document.querySelector(`link[rel="preload"][href*="${LOGO_PATH}"]`)) {
        const link = document.createElement("link");
        link.rel = "preload";
        link.as = "image";
        link.href = LOGO_PATH;
        link.type = "image/png";
        link.setAttribute("fetchpriority", "high");
        document.head.appendChild(link);
      }
    } catch {}

    // B. 浏览器内存 Image 常驻与位图提前解码 (Pre-decoded in Memory)
    try {
      if (typeof Image !== "undefined") {
        const logoImg = new Image();
        logoImg.src = LOGO_PATH;
        if (typeof logoImg.decode === "function") {
          logoImg.decode().catch(() => {});
        }
        window.__PI_ENH_LOGO_PRELOAD_IMG__ = logoImg;
      }
    } catch {}

    // C. 浏览器现代 CacheStorage 主动预存 (PWA / CacheStorage 强缓存)
    try {
      if ("caches" in window && typeof caches.open === "function") {
        caches.open("pi-web-logo-cache-v1").then((cache) => {
          cache.match(LOGO_PATH).then((existing) => {
            if (!existing) {
              fetch(LOGO_PATH, { cache: "force-cache" })
                .then((resp) => {
                  if (resp && resp.ok) cache.put(LOGO_PATH, resp.clone());
                })
                .catch(() => {});
            }
          });
        }).catch(() => {});
      }
    } catch {}

    // D. DOM 渲染优化：一旦页面挂载该 Logo，立即附加高速渲染属性 (fetchpriority/decoding/eager)
    function optimizeLogoElement(el) {
      if (!el || el.__pi_logo_optimized) return;
      el.__pi_logo_optimized = true;
      try {
        if (!el.getAttribute("fetchpriority")) el.setAttribute("fetchpriority", "high");
        if (!el.getAttribute("decoding")) el.setAttribute("decoding", "async");
        if (el.loading === "lazy") el.loading = "eager";
      } catch {}
    }

    if (typeof document !== "undefined") {
      const applyExisting = () => {
        for (const img of document.querySelectorAll(`img[src*="${LOGO_PATH}"]`)) {
          optimizeLogoElement(img);
        }
      };
      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", applyExisting, { once: true });
      } else {
        applyExisting();
      }
    }
  })();

  // 0.5 物理级去除标签页中的 Pi Web 标识与防止标题抖动（保留状态文字 🔵/🟠/🔴/🟢 等）
  function sanitizePageTitle(rawTitle) {
    if (!rawTitle) return "";
    let clean = String(rawTitle)
      .replace(/\s*[-·|_]\s*(?:π\+\s*)?\bPi\s*Web\b(?:\s+Plus\b|\s*\+)?/gi, "")
      .replace(/(?:π\+\s*)?\bPi\s*Web\b(?:\s+Plus\b|\s*\+)?\s*[-·|_]\s*/gi, "")
      .replace(/(?:π\+\s*)?\bPi\s*Web\b(?:\s+Plus\b|\s*\+)?/gi, "")
      .replace(/\s*[-·|_]\s*$/, "")
      .trim();
    return clean;
  }

  // Safe Hot-Reloading: Clean up any previous instance before re-initializing
  if (typeof window.__PI_WEB_ENHANCEMENTS_CLEANUP__ === "function") {
    try {
      window.__PI_WEB_ENHANCEMENTS_CLEANUP__();
    } catch (err) {
      console.warn("[Pi Web Enhancements] error cleaning up previous instance:", err);
    }
  }
  // 立即清除任何可能残留的孤儿 Toast 节点
  try {
    for (const t of document.querySelectorAll(".pi-enh-toast")) {
      t.remove();
    }
  } catch (e) {}

  // 本实例 lifecycle 与 ownership 标志
  let isDisposed = false;
  let hasDeferredSync = false;

  let titleObserver = null;
  let headObserver = null;
  let installedTitleGetter = null;
  let installedTitleSetter = null;
  let hadOwnTitleDesc = false;
  let prevOwnTitleDesc = null;
  // Top-level TDZ hoisted forward declarations (< line 200)
  let pendingDecorationOperations,
    latestKnownSessionGroups,
    SESSION_RECENTS_HEADER_HEIGHT = 34,
    SESSION_NORMAL_ITEM_HEIGHT = 54,
    SESSION_TAGGED_ITEM_HEIGHT = 72,
    PERSISTENT_SESSION_CACHE_NAME,
    sessionMemoryCache,
    persistentSessionEpochs,
    baseFetch,
    originalWindowFetch,
    crossDeviceSyncChannel,
    activeMenu,
    sessionArchiveIcon,
    annotationEditor,
    quoteBar,
    quoteBarInteracting,
    projectStatusModel,
    projectStatusState,
    projectStatusCatalog,
    projectStatusDisposed,
    projectStatusLeader,
    projectStatusChannel,
    projectStatusLastPayload,
    quickActionsConfig,
    quickActionsDraftConfig,
    quickActionsDraftGeneration,
    quickActionsSyncStatus,
    isComposing,
    emptySendContinuePassthrough,
    activeComposerPasteTextarea,
    activeZoomDialog,
    composerQueuePanel,
    activeFormattedComposer,
    isComposingInput,
    composerSubmissionInFlight,
    composerModesStateMap,
    pendingNewComposerMode,
    isSessionBatchMode,
    batchDeleteModal,
    durationTooltip,
    usageTooltip,
    orphanOriginalDisplay,
    minimapHistoryDisplayState,
    autoLoadEarlierTriggered,
    sessionScrollMemory,
    viewerFileContentCache,
    baseTitle,
    wasRunning,
    restoredThinkingSessionScopes,
    SHORTCUT_TIP_STORAGE_KEY,
    pendingShortcutNavigation,
    codeBlockScanObserver = null,
    lastObsidianViewerPath = null,
    cachedNativeOnOpenFile = null,
    instantDialogObserver = null,
    sidebarObserver = null,
    activeTurnStartTime = null,
    activeTurnEntryId = null,
    restoreTitleTimer = null,
    notRunningConsecutiveTicks = 0,
    isRestoringThinking = false,
    settingsDialogObserver = null,
    isPersistingShortcutsToServer = false,
    pendingPersistShortcutsTimer = null,
    initialShortcutsSyncAttempted = false,
    isForceReloading = false,
    archivedPanelSearchQuery = "",
    selectedArchivedIds = new Set(),
    lastCheckedArchivedIndex = null,
    isDateCleanPanelOpen = false,
    archivedDateCutoffValue = "",
    bridgeBaseSyncUrl = null,
    currentScriptTag = null,
    pollerIntervalId = null;

  function isProjectStatusIndicatorActive() {
    if (isDisposed) return false;
    if (typeof isPluginEnabled === "function") {
      try {
        return Boolean(isPluginEnabled("project-status-indicator"));
      } catch (e) {}
    }
    try {
      if (typeof localStorage !== "undefined") {
        const direct = localStorage.getItem("pi-enh-plugin-project-status-indicator");
        if (direct === "false") return false;
        if (direct === "true") return true;
        const raw = localStorage.getItem("pi-enh-settings-v1") || localStorage.getItem("pi-enh-features");
        if (raw) {
          const cfg = JSON.parse(raw);
          if (cfg && cfg.features && cfg.features["project-status-indicator"] && cfg.features["project-status-indicator"].enabled === false) {
            return false;
          }
          if (cfg && cfg["project-status-indicator"] && cfg["project-status-indicator"].enabled === false) {
            return false;
          }
        }
      }
    } catch (e) {}
    return true;
  }

  // 0.6 document.title setter 拦截与 DOM 更新防护（去除 Pi Web 尾缀并防止与原生 MutationObserver 死循环）
  try {
    if (typeof document !== "undefined") {
      hadOwnTitleDesc = Object.prototype.hasOwnProperty.call(document, "title");
      let desc = hadOwnTitleDesc
        ? Object.getOwnPropertyDescriptor(document, "title")
        : (Object.getOwnPropertyDescriptor(Document.prototype, "title") ||
           (typeof HTMLDocument !== "undefined" && Object.getOwnPropertyDescriptor(HTMLDocument.prototype, "title")) ||
           Object.getOwnPropertyDescriptor(Object.getPrototypeOf(document) || Document.prototype, "title"));

      let origGet = null;
      let origSet = null;

      if (desc && (desc.get || desc.set)) {
        origGet = desc.get;
        origSet = desc.set;
      } else if (desc && "value" in desc) {
        let storedVal = desc.value;
        origGet = function () { return storedVal; };
        origSet = function (val) { storedVal = val; };
      }

      if (origSet) {
        // 防止热重载重复 defineProperty 套娃，解包最底层原始方法
        if (origGet && origGet.__pi_enh_orig_get) {
          origGet = origGet.__pi_enh_orig_get;
        }
        if (origSet && origSet.__pi_enh_orig_set) {
          origSet = origSet.__pi_enh_orig_set;
        }

        prevOwnTitleDesc = hadOwnTitleDesc ? Object.getOwnPropertyDescriptor(document, "title") : null;

        let isSettingTitleInternally = false;

        installedTitleGetter = function () {
          const raw = origGet ? origGet.call(this) : "";
          if (!isProjectStatusIndicatorActive()) {
            return raw;
          }
          const sanitized = sanitizePageTitle(raw);
          return sanitized || raw;
        };
        installedTitleGetter.__pi_enh_title__ = true;
        installedTitleGetter.__pi_enh_orig_get = origGet;

        installedTitleSetter = function (val) {
          window.__PI_WEB_NATIVE_TITLE_RAW__ = val;
          // Preserve the native title before sanitizing the enhanced display.
          // Legacy cores publish it through document.title, newer cores also
          // provide __PI_WEB_NATIVE_TITLE_BASE__ directly.
          if (
            typeof val === "string" &&
            (/^(?:π\+\s*)?Pi\s*Web(?:\s+Plus|\+)?$/i.test(val.trim()) ||
             /\s-\s(?:π\+\s*)?Pi\s*Web(?:\s+Plus|\+)?$/i.test(val.trim()))
          ) {
            window.__PI_WEB_NATIVE_TITLE_BASE__ = val;
          }

          if (!isProjectStatusIndicatorActive()) {
            origSet.call(this, val);
            return;
          }

          const cleanBase = sanitizePageTitle(val);
          // A sanitized enhancer write must not replace an authoritative native base.
          if (!window.__PI_WEB_NATIVE_TITLE_BASE__ && cleanBase && !/^(?:🔵|🟠|🔴|🟢|⚠️)/.test(cleanBase)) {
            window.__PI_WEB_NATIVE_TITLE_BASE__ = cleanBase;
          }

          // 状态前缀保护：若当前 val 本身已带有状态前缀（如 🔵、🟠 需要确认、🟢 已完成等），直接使用 cleanBase
          let targetTitle = cleanBase;
          const hasStatusPrefix = /^(?:🔵|🟠|🔴|🟢|⚠️)/.test(cleanBase);

          if (!hasStatusPrefix && typeof window.__PI_ENH_COMPOSE_WINDOW_TITLE__ === "function") {
            try {
              const composed = window.__PI_ENH_COMPOSE_WINDOW_TITLE__(cleanBase);
              if (composed) targetTitle = composed;
            } catch (e) {}
          }

          if (!targetTitle) {
            targetTitle = cleanBase || (val ? sanitizePageTitle(val) : "") || "work";
          }

          // 获取当前底层真实的 title，若已等于目标值则禁止重复写入（防止与原生 MutationObserver 死循环）
          const currentTitle = origGet ? origGet.call(this) : (document.querySelector("title")?.textContent || "");
          if (currentTitle === targetTitle) {
            return;
          }

          if (isSettingTitleInternally) {
            origSet.call(this, targetTitle);
            return;
          }

          isSettingTitleInternally = true;
          try {
            origSet.call(this, targetTitle);
          } finally {
            isSettingTitleInternally = false;
          }
        };
        installedTitleSetter.__pi_enh_title__ = true;
        installedTitleSetter.__pi_enh_orig_set = origSet;

        Object.defineProperty(document, "title", {
          configurable: true,
          enumerable: true,
          get: installedTitleGetter,
          set: installedTitleSetter,
        });

        // 初始若已有标题且开启增强，同步一次净化
        if (isProjectStatusIndicatorActive() && document.title) {
          const initClean = sanitizePageTitle(document.title);
          if (initClean && initClean !== document.title) {
            installedTitleSetter.call(document, document.title);
          }
        }
      }

      let isSanitizingDomTitle = false;
      const cleanDomTitle = () => {
        if (isDisposed || isSanitizingDomTitle) return;
        if (!isProjectStatusIndicatorActive()) return;
        const titleEl = document.querySelector("title");
        if (!titleEl) return;
        const currentText = titleEl.textContent || "";
        if (!/Pi\s*Web/i.test(currentText)) return;
        let cleaned = sanitizePageTitle(currentText);
        if (!cleaned) return;
        const hasStatus = /^(?:🔵|🟠|🔴|🟢|⚠️)/.test(cleaned);
        if (!hasStatus && typeof window.__PI_ENH_COMPOSE_WINDOW_TITLE__ === "function") {
          try {
            const composed = window.__PI_ENH_COMPOSE_WINDOW_TITLE__(cleaned);
            if (composed) cleaned = composed;
          } catch (e) {}
        }
        if (titleEl.textContent !== cleaned) {
          isSanitizingDomTitle = true;
          try {
            titleEl.textContent = cleaned;
          } finally {
            isSanitizingDomTitle = false;
          }
        }
      };

      if (typeof MutationObserver !== "undefined") {
        titleObserver = new MutationObserver(cleanDomTitle);
        const attachTitleObserver = () => {
          if (isDisposed) return;
          const t = document.querySelector("title");
          if (t) {
            titleObserver.observe(t, { childList: true, characterData: true, subtree: true });
            cleanDomTitle();
          }
        };

        if (document.head) {
          headObserver = new MutationObserver(() => {
            if (isDisposed) return;
            const t = document.querySelector("title");
            if (t) {
              attachTitleObserver();
            }
          });
          headObserver.observe(document.head, { childList: true });
        }
        attachTitleObserver();
      }
    }
  } catch (e) {}

  // --- Managed Lifecycle & Zero-Leak Teardown Registry ---
  const activeCleanups = [];
  const managedTimeoutCleanups = new Map();
  let usageDashboardModal = null;
  let nativeComposerSubmissionDispatching = false;

  function clearManagedTimeout(id) {
    if (id == null) return;
    try { clearTimeout(id); } catch (e) {}
    const cleanup = managedTimeoutCleanups.get(id);
    if (cleanup) {
      managedTimeoutCleanups.delete(id);
      const idx = activeCleanups.indexOf(cleanup);
      if (idx !== -1) activeCleanups.splice(idx, 1);
    }
  }

  function addManagedListener(target, type, handler, options) {
    if (isDisposed) return;
    if (!target || typeof target.addEventListener !== "function") return;
    target.addEventListener(type, handler, options);
    activeCleanups.push(() => {
      try {
        target.removeEventListener(type, handler, options);
      } catch (e) {}
    });
  }

  function addManagedInterval(fn, ms) {
    if (isDisposed) return null;
    const id = setInterval(fn, ms);
    activeCleanups.push(() => {
      try { clearInterval(id); } catch (e) {}
    });
    return id;
  }

  function addManagedTimeout(fn, ms) {
    if (isDisposed) return null;
    let id;
    const cleanup = () => {
      try { clearTimeout(id); } catch (e) {}
      managedTimeoutCleanups.delete(id);
    };
    id = setTimeout(() => {
      managedTimeoutCleanups.delete(id);
      const idx = activeCleanups.indexOf(cleanup);
      if (idx !== -1) activeCleanups.splice(idx, 1);
      if (isDisposed) return;
      try {
        fn();
      } catch (err) {
        console.error("[Pi Web Enhancements] Error in managed timeout:", err);
      }
    }, ms);
    managedTimeoutCleanups.set(id, cleanup);
    activeCleanups.push(cleanup);
    return id;
  }

  let chatObserver = null;
  let observedTarget = null;
  let isMutatingInternally = false;
  let syncScheduled = false;
  let domSyncFrameId = null;
  let domSyncTimerId = null;

  function withMutationGuard(fn) {
    if (isDisposed) return;
    if (isMutatingInternally) {
      fn();
      return;
    }
    isMutatingInternally = true;
    try {
      fn();
    } finally {
      // Release in next microtask to absorb any synchronous mutation events
      Promise.resolve().then(() => {
        isMutatingInternally = false;
        if (hasDeferredSync && !isDisposed) {
          hasDeferredSync = false;
          scheduleDomSync();
        }
      });
    }
  }

  function isLoginPage() {
    try {
      const path = window.location.pathname || "";
      if (path === "/login" || path.startsWith("/login/")) return true;
      if (document.querySelector('input[type="password"]') && !document.querySelector('textarea, [role="textbox"], .session-row')) {
        return true;
      }
    } catch (e) {}
    return false;
  }

  // --- Styles Injection ---
  const styleEl = document.createElement("style");
  styleEl.id = "pi-web-enhancements-style";
  styleEl.textContent = `
    /* PWA 独立应用与移动端沉浸模式适配 (Safe Area Insets) */
    @media all and (display-mode: standalone) {
      html { --pi-pwa-active: 1; }
    }
    html.pi-pwa-standalone,
    body[data-pwa="standalone"] {
      --safe-top: env(safe-area-inset-top, 0px);
      --safe-bottom: env(safe-area-inset-bottom, 0px);
      --safe-left: env(safe-area-inset-left, 0px);
      --safe-right: env(safe-area-inset-right, 0px);
    }


    /* 优雅的发送/排队微光流动画 (Sent Micro-pulse Transition) */
    @keyframes pi-enh-sent-pulse {
      0% {
        opacity: 0;
        transform: scaleX(0.15);
      }
      35% {
        opacity: 0.85;
        transform: scaleX(0.65);
      }
      100% {
        opacity: 0;
        transform: scaleX(1);
      }
    }
    .pi-enh-sent-indicator {
      position: absolute !important;
      top: 0 !important;
      left: 12px !important;
      right: 12px !important;
      height: 2px !important;
      border-radius: 2px !important;
      background: linear-gradient(90deg, transparent 0%, var(--accent, #38bdf8) 50%, transparent 100%) !important;
      box-shadow: 0 0 8px color-mix(in srgb, var(--accent, #38bdf8) 60%, transparent) !important;
      pointer-events: none !important;
      animation: pi-enh-sent-pulse 0.45s cubic-bezier(0.16, 1, 0.3, 1) forwards !important;
      z-index: 50 !important;
    }

    /* 会话内存 DOM 快照瞬开平滑交接 (Session Instant Snapshot Overlay) */
    .pi-enh-session-snapshot-overlay {
      box-sizing: border-box;
    }
    /* 顶部状态栏避让前摄挖孔与系统通知区 */
    html.pi-pwa-standalone header,
    html.pi-pwa-standalone nav[role="navigation"],
    body[data-pwa="standalone"] header {
      padding-top: max(8px, env(safe-area-inset-top, 0px)) !important;
    }
    /* 底部输入框与工具面板增加安全边距，避让 Android 系统手势小白条 */
    html.pi-pwa-standalone fieldset,
    html.pi-pwa-standalone .pi-enh-cursor-composer,
    html.pi-pwa-standalone .chat-input-container,
    body[data-pwa="standalone"] fieldset,
    body[data-pwa="standalone"] .pi-enh-cursor-composer {
      padding-bottom: max(10px, env(safe-area-inset-bottom, 0px)) !important;
    }
    html.pi-pwa-standalone aside,
    body[data-pwa="standalone"] aside {
      padding-left: max(0px, env(safe-area-inset-left, 0px)) !important;
      padding-bottom: max(0px, env(safe-area-inset-bottom, 0px)) !important;
    }

    /* PWA 设置卡片样式 */
    .pi-enh-pwa-card {
      margin: 12px 20px 0;
      padding: 12px 14px;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: color-mix(in srgb, var(--bg-selected) 24%, transparent);
      font-size: 12px;
    }
    @media (max-width: 760px) {
      .pi-enh-pwa-card {
        margin: 10px 12px 0;
        padding: 10px;
      }
    }
    .pi-enh-pwa-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      flex-wrap: wrap;
      margin-bottom: 6px;
    }
    .pi-enh-pwa-title-wrap {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .pi-enh-pwa-title {
      font-weight: 600;
      color: var(--text);
    }
    .pi-enh-pwa-badge {
      font-size: 11px;
      padding: 2px 7px;
      border-radius: 9999px;
      border: 1px solid var(--border);
      background: var(--bg);
      color: var(--text-muted);
    }
    .pi-enh-pwa-badge[data-standalone="true"] {
      background: rgba(34, 197, 94, 0.12);
      border-color: rgba(34, 197, 94, 0.35);
      color: #22c55e;
    }
    .pi-enh-pwa-desc {
      margin: 0;
      color: var(--text-muted);
      line-height: 1.5;
    }
    .pi-enh-pwa-desc code {
      background: rgba(0, 0, 0, 0.2);
      padding: 1px 4px;
      border-radius: 4px;
      font-family: monospace;
      font-size: 11px;
    }

    /* 工作区选择器下拉菜单悬停与点击交互反馈 */
    html.pi-enh-workspace-picker-hover-active div[style*="position: relative"] > button[title]:hover {
      border-color: var(--text-muted) !important;
    }
    html.pi-enh-workspace-picker-hover-active div[style*="position: relative"] > div[style*="position: absolute"][style*="z-index: 100"] button {
      transition: background-color 0.12s ease, color 0.12s ease !important;
    }
    html.pi-enh-workspace-picker-hover-active div[style*="position: relative"] > div[style*="position: absolute"][style*="z-index: 100"] button:hover {
      background: var(--bg-hover) !important;
      color: var(--text) !important;
    }
    html.pi-enh-workspace-picker-hover-active div[style*="position: relative"] > div[style*="position: absolute"][style*="z-index: 100"] button:active {
      background: var(--bg-selected) !important;
      color: var(--text) !important;
    }
    html.pi-enh-workspace-picker-hover-active div[style*="position: relative"] > div[style*="position: absolute"][style*="z-index: 100"] button:focus-visible {
      outline: 2px solid var(--accent) !important;
      outline-offset: -2px !important;
    }

    /* 选择目录弹窗（DirectoryPicker）悬停与新建文件夹样式 */
    html.pi-enh-workspace-picker-hover-active .directory-picker-panel .directory-picker-entry {
      transition: background-color 0.12s ease, color 0.12s ease, padding-left 0.12s ease !important;
    }
    html.pi-enh-workspace-picker-hover-active .directory-picker-panel .directory-picker-entry:hover {
      background: var(--bg-hover) !important;
      color: var(--text) !important;
      padding-left: 10px !important;
    }
    html.pi-enh-workspace-picker-hover-active .directory-picker-panel .directory-picker-entry:active {
      background: var(--bg-selected) !important;
      color: var(--text) !important;
    }
    html.pi-enh-workspace-picker-hover-active .directory-picker-panel .directory-picker-entry:focus-visible {
      outline: 2px solid var(--accent) !important;
      outline-offset: -2px !important;
    }
    html.pi-enh-workspace-picker-hover-active .directory-picker-panel .directory-picker-entry:hover svg {
      stroke: var(--accent) !important;
    }

    /* 顶栏返回上级与转到按钮悬停反馈 */
    html.pi-enh-workspace-picker-hover-active .directory-picker-panel .directory-picker-back:not(:disabled) {
      transition: background-color 0.12s ease, color 0.12s ease, border-color 0.12s ease !important;
    }
    html.pi-enh-workspace-picker-hover-active .directory-picker-panel .directory-picker-back:not(:disabled):hover {
      background: var(--bg-selected, rgba(255, 255, 255, 0.08)) !important;
      color: var(--text) !important;
      border-color: var(--text-muted) !important;
    }
    html.pi-enh-workspace-picker-hover-active .directory-picker-panel form button.directory-picker-action:not(:disabled) {
      transition: background-color 0.12s ease, color 0.12s ease, border-color 0.12s ease !important;
    }
    html.pi-enh-workspace-picker-hover-active .directory-picker-panel form button.directory-picker-action:not(:disabled):hover {
      background: var(--bg-selected, rgba(255, 255, 255, 0.08)) !important;
      color: var(--text) !important;
      border-color: var(--text-muted) !important;
    }

    /* 顶栏关闭按钮悬停反馈 */
    html.pi-enh-workspace-picker-hover-active .directory-picker-panel > div:first-child button[title]:not(:disabled) {
      transition: background-color 0.12s ease, color 0.12s ease !important;
    }
    html.pi-enh-workspace-picker-hover-active .directory-picker-panel > div:first-child button[title]:not(:disabled):hover {
      background: var(--bg-hover) !important;
      color: var(--text) !important;
      border-radius: 4px !important;
    }

    /* 移除选择目录弹窗底部多余的“取消”按钮 */
    .directory-picker-footer button:not([style*="var(--accent)"]):not(.directory-picker-new-folder-btn) {
      display: none !important;
    }
    html.pi-enh-workspace-picker-hover-active .directory-picker-footer button:not(:disabled)[style*="var(--accent)"] {
      transition: filter 0.12s ease, box-shadow 0.12s ease !important;
    }
    html.pi-enh-workspace-picker-hover-active .directory-picker-footer button:not(:disabled)[style*="var(--accent)"]:hover {
      filter: brightness(1.12) !important;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25) !important;
    }

    /* 底栏“新建文件夹”按钮统一风格 */
    html.pi-enh-workspace-picker-hover-active .directory-picker-new-folder-btn {
      padding: 6px 14px !important;
      border: 1px solid var(--border) !important;
      border-radius: 6px !important;
      background: var(--bg-hover) !important;
      color: var(--text-muted) !important;
      cursor: pointer !important;
      font-size: 13px !important;
      display: inline-flex !important;
      align-items: center !important;
      gap: 6px !important;
      transition: background-color 0.12s ease, color 0.12s ease, border-color 0.12s ease !important;
    }
    html.pi-enh-workspace-picker-hover-active .directory-picker-new-folder-btn:hover {
      background: var(--bg-selected, rgba(255, 255, 255, 0.08)) !important;
      color: var(--text) !important;
      border-color: var(--text-muted) !important;
    }

    /* 内联新建文件夹行 */
    .directory-picker-new-folder-row {
      margin-bottom: 6px;
      padding: 6px 8px;
      border: 1px solid var(--accent);
      border-radius: 6px;
      background: var(--bg-panel);
      box-shadow: 0 2px 10px rgba(0, 0, 0, 0.18);
    }
    .directory-picker-new-folder-inner {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .directory-picker-new-folder-icon {
      stroke: var(--accent);
      flex-shrink: 0;
    }
    .directory-picker-new-folder-input {
      flex: 1;
      min-width: 0;
      height: 28px;
      padding: 0 8px;
      border: 1px solid var(--border);
      border-radius: 4px;
      background: var(--bg);
      color: var(--text);
      font-family: var(--font-mono);
      font-size: 12px;
      outline: none;
      transition: border-color 0.12s ease;
    }
    .directory-picker-new-folder-input:focus {
      border-color: var(--accent);
    }
    .directory-picker-new-folder-actions {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-shrink: 0;
    }
    .directory-picker-new-folder-btn-submit {
      padding: 4px 10px;
      border: 0;
      border-radius: 4px;
      background: var(--accent);
      color: var(--accent-contrast);
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      transition: filter 0.12s ease;
    }
    .directory-picker-new-folder-btn-submit:hover:not(:disabled) {
      filter: brightness(1.12);
    }
    .directory-picker-new-folder-btn-cancel {
      padding: 4px 8px;
      border: 1px solid var(--border);
      border-radius: 4px;
      background: none;
      color: var(--text-muted);
      font-size: 12px;
      cursor: pointer;
      transition: background-color 0.12s ease, color 0.12s ease;
    }
    .directory-picker-new-folder-btn-cancel:hover:not(:disabled) {
      background: var(--bg-hover);
      color: var(--text);
    }
    .directory-picker-new-folder-error {
      color: #ef4444;
      font-size: 11px;
      line-height: 1.35;
      padding: 4px 0 2px 24px;
    }

    @keyframes pi-enh-pulse-highlight {
      0% { outline: 2px solid var(--accent); background: var(--bg-selected); }
      50% { outline: 2px solid var(--accent); background: var(--bg-selected); }
      100% { outline: 2px solid transparent; background: none; }
    }
    .pi-enh-newly-created-pulse {
      animation: pi-enh-pulse-highlight 2s ease-out !important;
    }

    /* 任务运行时由插件恢复模型选择器的可点击视觉状态 */
    .model-selector button[data-pi-enh-running-model-switch="true"] {
      opacity: 1 !important;
      cursor: pointer !important;
      pointer-events: auto !important;
    }

    /* 历史消息无按钮自动加载：仅在插件启用的实际聊天滚动容器上生效 */
    .pi-enh-history-scroll-container {
      overscroll-behavior-y: contain;
      -webkit-overflow-scrolling: touch;
    }
    [data-pi-enh-history-sentinel] {
      min-height: 32px;
      display: flex !important;
      align-items: center;
      justify-content: center;
      gap: 7px;
      padding: 8px 0 !important;
      color: var(--text-dim, #71717a) !important;
    }
    .pi-enh-history-scroll-container.pi-enh-history-pulling > :first-child {
      translate: 0 var(--pi-history-pull, 0px);
    }
    .pi-enh-history-status {
      position: fixed;
      z-index: 45;
      transform: translateX(-50%);
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 14px;
      border-radius: 20px;
      background: var(--bg-panel, #27272a);
      color: var(--text-muted, #a1a1aa);
      box-shadow: 0 2px 12px #0002;
      font-size: 13px;
      line-height: 20px;
      pointer-events: none;
    }
    .pi-enh-history-status[hidden] { display: none; }
    /* Keep the native observer target and its geometry; only one visible prompt. */
    .pi-enh-history-scroll-container.pi-enh-history-feedback-active [data-pi-enh-history-sentinel] {
      visibility: hidden;
    }
    .pi-enh-history-status[data-state="pull"]::before { content: "↓"; }
    .pi-enh-history-status[data-state="armed"]::before { content: "↑"; color: var(--accent); }
    .pi-enh-history-status[data-state="error"] { color: var(--text, #f4f4f5); }
    .pi-enh-history-status[data-state="loading"]::before,
    .pi-enh-history-status[data-state="waiting"]::before,
    .pi-enh-history-status[data-state="slow"]::before,
    [data-pi-enh-history-sentinel][aria-busy="true"]::before {
      content: "";
      width: 12px;
      height: 12px;
      flex: 0 0 12px;
      border: 2px solid color-mix(in srgb, var(--text-dim, #71717a) 35%, transparent);
      border-top-color: var(--accent, #60a5fa);
      border-radius: 50%;
      animation: pi-enh-history-spin 0.8s linear infinite;
    }
    @keyframes pi-enh-history-spin { to { transform: rotate(360deg); } }

    /* Usage & Cost Dashboard (Vercel / Linear / Gemini 极简暗色科技美学规范) */
    .settings-dialog-main.pi-enh-usage-panel {
      display: block;
      flex: 1 1 auto !important;
      width: 100% !important;
      height: 100% !important;
      max-height: 100% !important;
      min-height: 0 !important;
      overflow-x: hidden !important;
      overflow-y: auto !important;
      -webkit-overflow-scrolling: touch !important;
      overscroll-behavior-y: contain !important;
      scrollbar-gutter: stable !important;
      box-sizing: border-box !important;
      padding: 24px clamp(28px, 5vw, 48px) 60px !important;
      container-type: inline-size;
      container-name: usage-panel;
    }
    .pi-enh-usage-panel-content {
      width: 100%;
      max-width: 940px;
      margin: 0 auto;
      padding: 0 8px;
      box-sizing: border-box;
      container-type: inline-size;
      container-name: usage-panel;
    }
    .pi-enh-usage-header-pro {
      padding-bottom: 16px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      margin-bottom: 20px;
    }
    /* 顶部控件双列对齐网格（默认单列安全布局，宽容器>=640px双列对齐） */
    .pi-enh-usage-controls-grid {
      display: grid;
      grid-template-columns: 1fr;
      row-gap: 12px;
      align-items: center;
      margin-bottom: 12px;
      width: 100%;
      box-sizing: border-box;
    }
    .pi-enh-usage-grid-col-left {
      grid-column: 1;
      justify-self: start;
      width: 100%;
      min-width: 0;
    }
    .pi-enh-usage-grid-col-right {
      grid-column: 1;
      justify-self: start;
      width: 100%;
      min-width: 0;
    }
    .pi-enh-usage-grid-full {
      grid-column: 1 / -1;
      width: 100%;
      box-sizing: border-box;
    }
    .pi-enh-usage-controls-grid label {
      white-space: nowrap;
      min-width: 0;
      max-width: 100%;
    }
    .pi-enh-usage-controls-grid label > span {
      white-space: nowrap;
      flex-shrink: 0;
    }
    [data-pi-usage-sync-btn],
    [data-pi-usage-top-sync-btn],
    [data-pi-usage-audit-sync-btn] {
      white-space: nowrap !important;
      flex-shrink: 0 !important;
    }
    @container usage-panel (min-width: 640px) {
      .pi-enh-usage-controls-grid {
        grid-template-columns: minmax(0, 1fr) auto;
        column-gap: 24px;
        row-gap: 12px;
      }
      .pi-enh-usage-grid-col-left {
        grid-column: 1;
        width: auto;
      }
      .pi-enh-usage-grid-col-right {
        grid-column: 2;
        width: auto;
      }
    }
    @media (max-width: 640px) {
      .pi-enh-kpi-pro-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
        gap: 8px !important;
        margin-bottom: 18px !important;
      }
      .pi-enh-kpi-pro-card {
        padding: 10px 12px !important;
      }
      .pi-enh-kpi-pro-card .kpi-pro-label {
        font-size: 10.5px !important;
        margin-bottom: 3px !important;
      }
      .pi-enh-kpi-pro-card .kpi-pro-value {
        font-size: 19px !important;
      }
      .pi-enh-kpi-pro-card .kpi-pro-hint {
        font-size: 10px !important;
        line-height: 1.35 !important;
        margin-top: 4px !important;
      }
      .pi-enh-usage-controls-grid {
        grid-template-columns: 1fr;
        row-gap: 10px;
      }
      .pi-enh-usage-grid-col-right {
        grid-column: 1;
      }
    }
    .pi-enh-usage-title-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 12px;
      margin-bottom: 10px;
    }
    .pi-enh-usage-tag {
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.08em;
      padding: 2px 7px;
      border-radius: 4px;
      background: rgba(56, 189, 248, 0.12);
      color: #38bdf8;
      border: 1px solid rgba(56, 189, 248, 0.25);
    }
    .pi-enh-usage-sub-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 12px;
    }
    /* 胶囊分段控制器 (Segmented Control) */
    .pi-enh-segmented-control {
      display: inline-flex;
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 8px;
      padding: 3px;
      gap: 2px;
      position: relative;
      overflow: visible !important;
      max-width: 100%;
      box-sizing: border-box;
    }
    .pi-enh-segment-btn {
      border: none;
      background: transparent;
      color: #a1a1aa;
      font-size: 12px;
      font-weight: 500;
      padding: 5px 14px;
      border-radius: 6px;
      cursor: pointer;
      transition: all 0.15s ease;
      white-space: nowrap;
      min-height: 30px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      box-sizing: border-box;
    }
    .pi-enh-segment-btn:hover {
      color: #ffffff;
      background: rgba(255, 255, 255, 0.06);
    }
    .pi-enh-segment-btn.active {
      background: #27272a;
      color: #ffffff;
      font-weight: 600;
      box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
      border: 1px solid rgba(255, 255, 255, 0.12);
    }
    .pi-enh-time-dropdown-wrap {
      position: relative;
      display: inline-flex;
    }
    .pi-enh-time-dropdown-btn {
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }
    .pi-enh-dropdown-triangle {
      transition: transform 0.15s ease;
      flex-shrink: 0;
    }
    .pi-enh-time-dropdown-menu {
      position: absolute;
      top: calc(100% + 4px);
      right: 0;
      z-index: 100;
      min-width: 130px;
      background: #27272a;
      border: 1px solid rgba(255, 255, 255, 0.14);
      border-radius: 8px;
      padding: 4px;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
      box-sizing: border-box;
    }
    .pi-enh-usage-custom-dates {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      flex-wrap: wrap;
      max-width: 100%;
      box-sizing: border-box;
    }
    .pi-enh-usage-custom-dates .pi-enh-pro-date-input {
      min-width: 0;
      box-sizing: border-box;
      min-height: 30px;
    }
    @container usage-panel (max-width: 540px) {
      .pi-enh-kpi-pro-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
        gap: 8px !important;
        margin-bottom: 18px !important;
      }
      .pi-enh-kpi-pro-card {
        padding: 10px 12px !important;
      }
      .pi-enh-kpi-pro-card .kpi-pro-label {
        font-size: 10.5px !important;
        margin-bottom: 3px !important;
      }
      .pi-enh-kpi-pro-card .kpi-pro-value {
        font-size: 19px !important;
      }
      .pi-enh-kpi-pro-card .kpi-pro-hint {
        font-size: 10px !important;
        line-height: 1.35 !important;
        margin-top: 4px !important;
      }
    }
    @container usage-panel (max-width: 440px) {
      .pi-enh-segmented-control {
        display: grid !important;
        grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
        width: 100% !important;
        gap: 3px !important;
        overflow: visible !important;
      }
      .pi-enh-segmented-control .pi-enh-segment-btn,
      .pi-enh-segmented-control .pi-enh-time-dropdown-wrap {
        width: 100% !important;
        display: flex !important;
        justify-content: center !important;
        text-align: center !important;
        padding: 5px 8px !important;
        font-size: 11.5px !important;
        box-sizing: border-box !important;
      }
      .pi-enh-segmented-control .pi-enh-time-dropdown-wrap {
        padding: 0 !important;
      }
      .pi-enh-segmented-control .pi-enh-time-dropdown-wrap .pi-enh-time-dropdown-btn {
        width: 100% !important;
        justify-content: center !important;
      }
      .pi-enh-usage-custom-dates {
        width: 100%;
      }
      .pi-enh-usage-custom-dates .pi-enh-pro-date-input {
        flex: 1 1 110px;
        min-width: 0;
        max-width: calc(50% - 15px);
      }
    }
    .pi-enh-dropdown-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 6px 10px;
      font-size: 12px;
      background: transparent;
      color: #e4e4e7;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      text-align: left;
      white-space: nowrap;
      transition: all 0.12s ease;
      width: 100%;
      box-sizing: border-box;
    }
    .pi-enh-dropdown-item:hover {
      background: rgba(255, 255, 255, 0.08);
      color: #ffffff;
    }
    .pi-enh-dropdown-item.active {
      background: rgba(56, 189, 248, 0.15);
      color: #38bdf8;
      font-weight: 600;
    }
    .pi-enh-dropdown-divider {
      height: 1px;
      background: rgba(255, 255, 255, 0.08);
      margin: 3px 0;
    }
    .pi-enh-pro-select {
      padding: 4px 10px;
      border-radius: 6px;
      background: #18181b;
      border: 1px solid rgba(255, 255, 255, 0.15);
      color: #f4f4f5;
      font-size: 12px;
      cursor: pointer;
      outline: none;
      color-scheme: dark;
      min-height: 32px;
      box-sizing: border-box;
      max-width: 100%;
    }
    .pi-enh-pro-select:hover {
      border-color: rgba(255, 255, 255, 0.25);
    }
    .pi-enh-pro-select:focus {
      border-color: #38bdf8;
      box-shadow: 0 0 0 1px #38bdf8;
    }
    .pi-enh-pro-select option {
      background-color: #18181b;
      color: #f4f4f5;
      padding: 6px 10px;
    }
    .pi-enh-pro-select option:checked {
      background-color: #27272a;
      color: #38bdf8;
    }
    /* Usage 提示与刷新按钮横条布局 */
    .pi-enh-yesterday-notice,
    .pi-enh-incomplete-audit-notice {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      box-sizing: border-box;
      width: 100%;
    }
    .pi-enh-yesterday-notice-body,
    .pi-enh-incomplete-audit-notice-body {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      flex: 1 1 200px;
      min-width: 0;
    }
    .pi-enh-yesterday-notice [data-pi-usage-quick-today-btn],
    .pi-enh-incomplete-audit-notice [data-pi-usage-audit-sync-btn] {
      flex-shrink: 0;
      box-sizing: border-box;
    }
    .pi-enh-usage-sync-row {
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
    }
    .pi-enh-usage-sync-btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 14px;
      background: #2563eb;
      color: #ffffff;
      border: 1px solid #3b82f6;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      box-shadow: 0 2px 6px rgba(37,99,235,0.25);
      transition: all 0.15s ease;
      box-sizing: border-box;
    }
    /* KPI 卡片网格（电脑端默认 4 列同行紧凑精致，手机端自适应 2 列） */
    .pi-enh-kpi-pro-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 10px;
      margin-bottom: 24px;
    }
    .pi-enh-kpi-pro-card {
      background: rgba(255, 255, 255, 0.025);
      border: 1px solid rgba(255, 255, 255, 0.07);
      border-radius: 10px;
      padding: 12px 12px;
      box-sizing: border-box;
      transition: border-color 0.15s ease;
      min-width: 0;
      display: flex;
      flex-direction: column;
      justify-content: flex-start;
    }
    .pi-enh-kpi-pro-card:hover {
      border-color: rgba(255, 255, 255, 0.15);
    }
    .pi-enh-kpi-pro-card .kpi-pro-label {
      font-size: 10.5px;
      text-transform: uppercase;
      letter-spacing: 0.03em;
      color: #71717a;
      font-weight: 600;
      margin-bottom: 4px;
      line-height: 1.25;
      min-height: 27px;
      display: flex;
      align-items: flex-end;
      word-break: break-word;
    }
    .pi-enh-kpi-pro-card .kpi-pro-value {
      font-size: 19px;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
      line-height: 1.25;
      color: #f4f4f5;
      white-space: nowrap;
    }
    .pi-enh-kpi-pro-card .kpi-pro-value.highlight-cyan {
      color: #38bdf8;
    }
    .pi-enh-kpi-pro-card .kpi-pro-value.highlight-green {
      color: #34d399;
    }
    .pi-enh-kpi-pro-card .kpi-pro-hint {
      font-size: 10.5px;
      color: #71717a;
      margin-top: 5px;
      line-height: 1.4;
      word-break: break-word;
    }
    @container usage-panel (min-width: 541px) and (max-width: 760px) {
      .pi-enh-kpi-pro-grid {
        gap: 8px !important;
      }
      .pi-enh-kpi-pro-card {
        padding: 10px 8px !important;
      }
      .pi-enh-kpi-pro-card .kpi-pro-label {
        font-size: 10px !important;
        line-height: 1.25 !important;
        min-height: 25px !important;
      }
      .pi-enh-kpi-pro-card .kpi-pro-value {
        font-size: 17px !important;
      }
      .pi-enh-kpi-pro-card .kpi-pro-hint {
        font-size: 9.5px !important;
        line-height: 1.35 !important;
      }
    }
    /* 分模型卡片矩阵：智能自适应 (默认 1 列，宽容器自适应多列) */
    .pi-enh-model-cards-grid {
      display: grid;
      grid-template-columns: 1fr;
      gap: 16px;
      margin-bottom: 24px;
    }
    /* 执行角色卡片矩阵（宽时 3 列，窄时 1 列） */
    .pi-enh-role-cards-grid,
    .pi-enh-model-cards-grid.pi-enh-role-cards-grid {
      display: grid !important;
      grid-template-columns: 1fr !important;
      gap: 12px !important;
      margin: 18px 0 28px !important;
    }
    .pi-enh-role-card {
      padding: 16px 18px !important;
      display: flex !important;
      flex-direction: column !important;
      justify-content: space-between !important;
      min-width: 0 !important;
      box-sizing: border-box !important;
    }
    .pi-enh-model-card {
      background: rgba(255, 255, 255, 0.02);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 10px;
      padding: 18px 20px;
      box-sizing: border-box;
      transition: all 0.15s ease;
      container-type: inline-size;
      container-name: modelcard;
      min-width: 0;
      max-width: 100%;
    }
    @container usage-panel (min-width: 640px) {
      .pi-enh-model-cards-grid {
        grid-template-columns: repeat(auto-fit, minmax(min(100%, 340px), 1fr)) !important;
        gap: 18px !important;
      }
      .pi-enh-role-cards-grid,
      .pi-enh-model-cards-grid.pi-enh-role-cards-grid {
        grid-template-columns: repeat(3, minmax(0, 1fr)) !important;
        gap: 14px !important;
      }
    }
    .pi-enh-model-card:hover {
      background: rgba(255, 255, 255, 0.035);
      border-color: rgba(56, 189, 248, 0.3);
    }
    .pi-enh-model-card-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 12px;
      padding-bottom: 8px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.05);
    }
    .pi-enh-model-card-title {
      font-size: 13px;
      font-weight: 600;
      color: #f4f4f5;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .pi-enh-model-dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: #38bdf8;
      box-shadow: 0 0 6px rgba(56, 189, 248, 0.6);
      flex-shrink: 0;
    }
    .pi-enh-model-card-badge {
      font-size: 11px;
      padding: 2px 7px;
      border-radius: 4px;
      background: rgba(56, 189, 248, 0.12);
      color: #38bdf8;
      font-weight: 600;
    }
    .pi-enh-model-card-kpis {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      column-gap: 22px;
      row-gap: 9px;
      font-size: 12px;
      padding: 2px 0;
    }
    .pi-enh-model-card-kpis .metric-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      min-width: 0;
    }
    .pi-enh-model-card-kpis .lbl {
      color: #71717a;
      font-size: 11px;
      white-space: nowrap;
      flex-shrink: 0;
    }
    .pi-enh-model-card-kpis .val {
      font-weight: 600;
      color: #d4d4d8;
      font-variant-numeric: tabular-nums;
      text-align: right;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .pi-enh-model-card-kpis .val.highlight {
      color: #38bdf8;
    }
    .pi-enh-model-card-kpis .val.cost {
      color: #7dd3fc;
    }

    /* 容器查询：卡片本身可用宽度不足 370px（如窄屏手机外屏）时，KPI 自动流式单列防截断 */
    @container modelcard (max-width: 370px) {
      .pi-enh-model-card-kpis {
        grid-template-columns: 1fr !important;
        row-gap: 8px;
        padding: 4px 0;
      }
      .pi-enh-model-card-kpis .metric-item {
        padding: 4px 0;
        border-bottom: 1px dashed rgba(255, 255, 255, 0.05);
      }
      .pi-enh-model-card-kpis .metric-item:last-child {
        border-bottom: none;
      }
      .pi-enh-model-card-kpis .lbl {
        font-size: 12px;
      }
      .pi-enh-model-card-kpis .val {
        font-size: 13px;
        text-align: right;
      }
    }

    /* 容器查询：当卡片在折叠屏展开态或宽屏下宽度充裕（>= 371px）时，自动采用双列宽大看板 */
    @container modelcard (min-width: 371px) {
      .pi-enh-model-card-kpis {
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) !important;
        column-gap: 24px;
        row-gap: 9px;
      }
      .pi-enh-model-card-kpis .metric-item {
        border-bottom: none !important;
      }
    }

    /* 移动端媒体查询：针对外屏手机与极小屏幕（<= 520px）的全局边距修饰 */
    @media (max-width: 520px) {
      html.pi-enh-settings-sidebar-active .pi-enh-sidebar-shortcut-tip {
        display: none !important;
      }
      .settings-dialog-main.pi-enh-usage-panel {
        padding: 16px 12px 60px !important;
      }
      .pi-enh-usage-panel-content {
        padding: 0 4px;
      }
      .pi-enh-segmented-control {
        display: grid !important;
        grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
        width: 100% !important;
        gap: 3px !important;
        overflow: visible !important;
      }
      .pi-enh-segmented-control .pi-enh-segment-btn,
      .pi-enh-segmented-control .pi-enh-time-dropdown-wrap {
        width: 100% !important;
        display: flex !important;
        justify-content: center !important;
        text-align: center !important;
        padding: 5px 8px !important;
        font-size: 11.5px !important;
        box-sizing: border-box !important;
      }
      .pi-enh-segmented-control .pi-enh-time-dropdown-wrap {
        padding: 0 !important;
      }
      .pi-enh-segmented-control .pi-enh-time-dropdown-wrap .pi-enh-time-dropdown-btn {
        width: 100% !important;
        justify-content: center !important;
      }
      .pi-enh-model-cards-grid,
      .pi-enh-role-cards-grid {
        grid-template-columns: 1fr !important;
        gap: 12px !important;
      }
      .pi-enh-model-card {
        padding: 16px 16px;
      }
      .pi-enh-yesterday-notice,
      .pi-enh-incomplete-audit-notice {
        flex-direction: column;
        align-items: flex-start;
        gap: 10px;
        padding: 10px 12px !important;
      }
      .pi-enh-yesterday-notice-body,
      .pi-enh-incomplete-audit-notice-body {
        width: 100%;
        flex: 0 0 auto;
      }
      .pi-enh-yesterday-notice [data-pi-usage-quick-today-btn],
      .pi-enh-incomplete-audit-notice [data-pi-usage-audit-sync-btn] {
        align-self: flex-start;
        max-width: 100%;
      }
      .pi-enh-usage-sync-row {
        flex-direction: column;
        align-items: flex-start !important;
        gap: 8px !important;
      }
      .pi-enh-usage-sync-btn {
        max-width: 100%;
        box-sizing: border-box;
      }
    }

    /* 折叠屏展开态或平板设备（521px ~ 880px）：充分利用展开后的宽大屏幕使用更宽看板 */
    @media (min-width: 521px) and (max-width: 880px) {
      .settings-dialog-main.pi-enh-usage-panel {
        padding: 20px 20px 60px !important;
      }
      .pi-enh-usage-panel-content {
        max-width: 100%;
        padding: 0 8px;
      }
      .pi-enh-model-cards-grid {
        gap: 16px;
      }
      .pi-enh-model-card {
        padding: 18px 22px;
      }
    }
    .pi-enh-progress-track {
      height: 4px;
      background: rgba(255, 255, 255, 0.06);
      border-radius: 2px;
      overflow: hidden;
      margin-top: 12px;
    }
    .pi-enh-progress-fill {
      height: 100%;
      background: linear-gradient(90deg, #22d3ee, #3b82f6);
      border-radius: 2px;
    }
    /* 高消耗会话排行榜 */
    .pi-enh-top-sessions-list {
      display: flex;
      flex-direction: column;
      gap: 6px;
      margin-bottom: 24px;
    }
    .pi-enh-top-session-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 14px;
      border-radius: 8px;
      background: rgba(255, 255, 255, 0.02);
      border: 1px solid rgba(255, 255, 255, 0.06);
      cursor: pointer;
      transition: all 0.15s ease;
    }
    .pi-enh-top-session-row:hover {
      background: rgba(56, 189, 248, 0.06);
      border-color: rgba(56, 189, 248, 0.3);
      transform: translateX(2px);
    }
    .pi-enh-session-rank-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 22px;
      height: 22px;
      border-radius: 5px;
      background: rgba(255, 255, 255, 0.06);
      color: #a1a1aa;
      font-size: 11px;
      font-weight: 600;
      margin-right: 10px;
      flex-shrink: 0;
    }
    .pi-enh-top-session-row:hover .pi-enh-session-rank-badge {
      background: rgba(56, 189, 248, 0.2);
      color: #38bdf8;
    }
    .pi-enh-top-session-row .session-title {
      font-size: 13px;
      font-weight: 500;
      color: #f4f4f5;
      display: block;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 480px;
    }
    .pi-enh-top-session-row .session-sub {
      font-size: 11px;
      color: #71717a;
      margin-top: 2px;
    }
    .pi-enh-top-session-row .session-tokens {
      font-size: 12px;
      font-weight: 600;
      color: #38bdf8;
      font-variant-numeric: tabular-nums;
      display: flex;
      align-items: center;
      gap: 8px;
      flex-shrink: 0;
    }
    .pi-enh-cost-pill {
      font-size: 11px;
      padding: 2px 6px;
      border-radius: 4px;
      background: rgba(56, 189, 248, 0.12);
      color: #7dd3fc;
      font-weight: 600;
    }

    /* Usage & Cost Dashboard Light Mode (html:not(.dark)) */
    html:not(.dark) .settings-dialog-main.pi-enh-usage-panel {
      color: #0f172a;
    }
    html:not(.dark) .pi-enh-usage-panel h2 {
      color: #0f172a !important;
    }
    html:not(.dark) .pi-enh-usage-panel h3 {
      color: #0f172a !important;
    }
    html:not(.dark) .pi-enh-usage-panel .pi-enh-usage-header-pro {
      border-bottom-color: #e2e8f0 !important;
    }
    html:not(.dark) .pi-enh-usage-panel [data-pi-usage-top-sync-btn] {
      background: rgba(37, 99, 235, 0.08) !important;
      color: #1d4ed8 !important;
      border-color: rgba(37, 99, 235, 0.3) !important;
    }
    html:not(.dark) .pi-enh-usage-panel .pi-enh-usage-title-row div[style*="color:#38bdf8"],
    html:not(.dark) .pi-enh-usage-panel .pi-enh-usage-title-row div[style*="color: #38bdf8"] {
      color: #0369a1 !important;
    }
    html:not(.dark) .pi-enh-usage-panel .pi-enh-segmented-control {
      background: #f1f5f9 !important;
      border-color: #e2e8f0 !important;
    }
    html:not(.dark) .pi-enh-usage-panel .pi-enh-segment-btn {
      color: #475569 !important;
    }
    html:not(.dark) .pi-enh-usage-panel .pi-enh-segment-btn:hover {
      color: #0f172a !important;
      background: rgba(0, 0, 0, 0.04) !important;
    }
    html:not(.dark) .pi-enh-usage-panel .pi-enh-segment-btn.active {
      background: #ffffff !important;
      color: #0f172a !important;
      border-color: #cbd5e1 !important;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1) !important;
    }
    html:not(.dark) .pi-enh-time-dropdown-menu {
      background: #ffffff !important;
      border-color: #cbd5e1 !important;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12) !important;
    }
    html:not(.dark) .pi-enh-dropdown-item {
      color: #0f172a !important;
    }
    html:not(.dark) .pi-enh-dropdown-item:hover {
      background: #f1f5f9 !important;
      color: #0f172a !important;
    }
    html:not(.dark) .pi-enh-dropdown-item.active {
      background: rgba(3, 105, 161, 0.1) !important;
      color: #0369a1 !important;
    }
    html:not(.dark) .pi-enh-dropdown-divider {
      background: #e2e8f0 !important;
    }
    html:not(.dark) .pi-enh-usage-panel .pi-enh-pro-date-input {
      background: #ffffff !important;
      color: #0f172a !important;
      border-color: #cbd5e1 !important;
      color-scheme: light !important;
    }
    html:not(.dark) .pi-enh-usage-panel .pi-enh-usage-custom-dates span {
      color: #475569 !important;
    }
    html:not(.dark) .pi-enh-usage-panel .pi-enh-usage-sub-row label {
      color: #475569 !important;
    }
    html:not(.dark) .pi-enh-usage-panel .pi-enh-pro-select {
      background: #ffffff !important;
      color: #0f172a !important;
      border-color: #cbd5e1 !important;
      color-scheme: light !important;
    }
    html:not(.dark) .pi-enh-usage-panel .pi-enh-pro-select:focus {
      border-color: #0284c7 !important;
      box-shadow: 0 0 0 1px #0284c7 !important;
    }
    html:not(.dark) .pi-enh-usage-panel .pi-enh-pro-select option {
      background-color: #ffffff !important;
      color: #0f172a !important;
    }
    html:not(.dark) .pi-enh-usage-panel .pi-enh-pro-select option:checked {
      background-color: #f1f5f9 !important;
      color: #0369a1 !important;
    }
    html:not(.dark) .pi-enh-usage-panel [data-usage-provenance],
    html:not(.dark) .pi-enh-usage-panel p {
      color: #475569 !important;
    }
    html:not(.dark) .pi-enh-usage-panel p strong {
      color: #0f172a !important;
    }
    html:not(.dark) .pi-enh-usage-panel [data-usage-refresh-status] {
      color: #0369a1 !important;
    }
    html:not(.dark) .pi-enh-usage-panel .pi-enh-yesterday-notice,
    html:not(.dark) .pi-enh-usage-panel .pi-enh-incomplete-audit-notice {
      background: #fefce8 !important;
      border-color: #facc15 !important;
      color: #713f12 !important;
    }
    html:not(.dark) .pi-enh-usage-panel .pi-enh-yesterday-notice strong,
    html:not(.dark) .pi-enh-usage-panel .pi-enh-incomplete-audit-notice strong {
      color: #713f12 !important;
    }
    html:not(.dark) .pi-enh-usage-panel .pi-enh-yesterday-notice [data-pi-usage-quick-today-btn],
    html:not(.dark) .pi-enh-usage-panel .pi-enh-incomplete-audit-notice [data-pi-usage-audit-sync-btn] {
      background: #eab308 !important;
      color: #000000 !important;
    }
    html:not(.dark) .pi-enh-usage-panel .pi-enh-time-coverage-warning {
      background: #fffbeb !important;
      border-color: #fde68a !important;
      color: #854d0e !important;
    }
    html:not(.dark) .pi-enh-usage-panel div[style*="rgba(56,189,248,0.08)"],
    html:not(.dark) .pi-enh-usage-panel div[style*="rgba(56, 189, 248, 0.08)"] {
      background: #f0f9ff !important;
      border-color: #bae6fd !important;
      color: #0369a1 !important;
    }
    html:not(.dark) .pi-enh-usage-panel div[style*="rgba(56,189,248,0.08)"] strong,
    html:not(.dark) .pi-enh-usage-panel div[style*="rgba(56, 189, 248, 0.08)"] strong {
      color: #0c4a6e !important;
    }
    html:not(.dark) .pi-enh-usage-panel .pi-enh-kpi-pro-card {
      background: #ffffff !important;
      border-color: #e2e8f0 !important;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04) !important;
    }
    html:not(.dark) .pi-enh-usage-panel .pi-enh-kpi-pro-card:hover {
      border-color: #cbd5e1 !important;
    }
    html:not(.dark) .pi-enh-usage-panel .pi-enh-kpi-pro-card .kpi-pro-label {
      color: #64748b !important;
    }
    html:not(.dark) .pi-enh-usage-panel .pi-enh-kpi-pro-card .kpi-pro-value {
      color: #0f172a !important;
    }
    html:not(.dark) .pi-enh-usage-panel .pi-enh-kpi-pro-card .kpi-pro-value.highlight-cyan {
      color: #0369a1 !important;
    }
    html:not(.dark) .pi-enh-usage-panel .pi-enh-kpi-pro-card .kpi-pro-value.highlight-green {
      color: #047857 !important;
    }
    html:not(.dark) .pi-enh-usage-panel .pi-enh-kpi-pro-card .kpi-pro-hint {
      color: #64748b !important;
    }
    html:not(.dark) .pi-enh-usage-panel .pi-enh-model-card {
      background: #ffffff !important;
      border-color: #e2e8f0 !important;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04) !important;
    }
    html:not(.dark) .pi-enh-usage-panel .pi-enh-model-card:hover {
      background: #f8fafc !important;
      border-color: #94a3b8 !important;
    }
    html:not(.dark) .pi-enh-usage-panel .pi-enh-model-card-header {
      border-bottom-color: #e2e8f0 !important;
    }
    html:not(.dark) .pi-enh-usage-panel .pi-enh-model-card-title {
      color: #0f172a !important;
    }
    html:not(.dark) .pi-enh-usage-panel .pi-enh-model-dot {
      background: #0284c7 !important;
      box-shadow: 0 0 4px rgba(2, 132, 199, 0.4) !important;
    }
    html:not(.dark) .pi-enh-usage-panel .pi-enh-model-card-badge {
      background: rgba(3, 105, 161, 0.1) !important;
      color: #0369a1 !important;
    }
    html:not(.dark) .pi-enh-usage-panel .pi-enh-model-card-kpis .lbl {
      color: #64748b !important;
    }
    html:not(.dark) .pi-enh-usage-panel .pi-enh-model-card-kpis .val {
      color: #0f172a !important;
    }
    html:not(.dark) .pi-enh-usage-panel .pi-enh-model-card-kpis .val.highlight {
      color: #0369a1 !important;
    }
    html:not(.dark) .pi-enh-usage-panel .pi-enh-model-card-kpis .val.cost {
      color: #0369a1 !important;
    }
    html:not(.dark) .pi-enh-usage-panel [data-usage-roles] .pi-enh-model-card > div[style*="font-size:22px"],
    html:not(.dark) .pi-enh-usage-panel [data-usage-roles] .pi-enh-model-card > div[style*="font-size: 22px"],
    html:not(.dark) .pi-enh-role-card .role-token-value {
      color: #0f172a !important;
    }
    html:not(.dark) .pi-enh-subagent-savings-panel {
      background: rgba(6, 182, 212, 0.08);
      border-color: rgba(8, 145, 178, 0.3);
    }
    html:not(.dark) .pi-enh-savings-title,
    html:not(.dark) .pi-enh-savings-badge {
      color: #0891b2;
    }
    html:not(.dark) .pi-enh-savings-breakdown {
      color: #1e293b;
    }
    html:not(.dark) .pi-enh-savings-subnote {
      color: #0e7490;
    }
    html:not(.dark) .pi-enh-dispatch-lbl,
    html:not(.dark) .pi-enh-dispatch-badge {
      color: #b45309;
      background: rgba(245, 158, 11, 0.12);
    }
    html:not(.dark) .pi-enh-dispatch-total-lbl,
    html:not(.dark) .pi-enh-dispatch-total-val,
    html:not(.dark) .pi-enh-dispatch-note {
      color: #b45309;
    }
    html:not(.dark) .pi-enh-usage-panel [data-usage-roles] .pi-enh-model-card > div[style*="color:#38bdf8"],
    html:not(.dark) .pi-enh-usage-panel [data-usage-roles] .pi-enh-model-card > div[style*="color: #38bdf8"],
    html:not(.dark) .pi-enh-role-card .role-cost-value {
      color: #0369a1 !important;
    }
    html:not(.dark) .pi-enh-role-card .role-meta-text {
      color: #64748b !important;
    }
    html:not(.dark) .pi-enh-usage-panel [data-usage-models] .pi-enh-model-card > div[style*="color:#38bdf8"],
    html:not(.dark) .pi-enh-usage-panel [data-usage-models] .pi-enh-model-card > div[style*="color: #38bdf8"] {
      color: #0369a1 !important;
    }
    html:not(.dark) .pi-enh-usage-panel .pi-enh-model-card div[style*="rgba(255,255,255,0.025)"],
    html:not(.dark) .pi-enh-usage-panel .pi-enh-model-card div[style*="rgba(255, 255, 255, 0.025)"] {
      background: #f8fafc !important;
      border-color: #e2e8f0 !important;
    }
    html:not(.dark) .pi-enh-usage-panel .pi-enh-model-card span[style*="color:#a1a1aa"],
    html:not(.dark) .pi-enh-usage-panel .pi-enh-model-card span[style*="color: #a1a1aa"] {
      color: #64748b !important;
    }
    html:not(.dark) .pi-enh-usage-panel .pi-enh-model-card span[style*="color:#f4f4f5"],
    html:not(.dark) .pi-enh-usage-panel .pi-enh-model-card span[style*="color: #f4f4f5"] {
      color: #0f172a !important;
    }
    html:not(.dark) .pi-enh-usage-panel .pi-enh-model-card span[style*="color:#38bdf8"],
    html:not(.dark) .pi-enh-usage-panel .pi-enh-model-card span[style*="color: #38bdf8"] {
      color: #0369a1 !important;
    }
    html:not(.dark) .pi-enh-usage-panel .pi-enh-model-card span[style*="rgba(56,189,248,0.14)"],
    html:not(.dark) .pi-enh-usage-panel .pi-enh-model-card span[style*="rgba(56, 189, 248, 0.14)"] {
      background: rgba(3, 105, 161, 0.1) !important;
      color: #0369a1 !important;
    }
    html:not(.dark) .pi-enh-usage-panel .pi-enh-model-card span[style*="color:#a78bfa"],
    html:not(.dark) .pi-enh-usage-panel .pi-enh-model-card span[style*="color: #a78bfa"] {
      color: #6d28d9 !important;
    }
    html:not(.dark) .pi-enh-usage-panel .pi-enh-model-card span[style*="rgba(167,139,250,0.14)"],
    html:not(.dark) .pi-enh-usage-panel .pi-enh-model-card span[style*="rgba(167, 139, 250, 0.14)"] {
      background: rgba(109, 40, 217, 0.1) !important;
      color: #6d28d9 !important;
    }
    html:not(.dark) .pi-enh-usage-panel .pi-enh-model-card div[style*="rgba(167,139,250,0.25)"],
    html:not(.dark) .pi-enh-usage-panel .pi-enh-model-card div[style*="rgba(167, 139, 250, 0.25)"] {
      border-top-color: rgba(109, 40, 217, 0.25) !important;
    }
    html:not(.dark) .pi-enh-usage-panel .pi-enh-model-card span[style*="color:#d8b4fe"],
    html:not(.dark) .pi-enh-usage-panel .pi-enh-model-card span[style*="color: #d8b4fe"] {
      color: #6d28d9 !important;
    }
    html:not(.dark) .pi-enh-usage-panel .pi-enh-model-card span[style*="color:#fbbf24"],
    html:not(.dark) .pi-enh-usage-panel .pi-enh-model-card span[style*="color: #fbbf24"] {
      color: #92400e !important;
    }
    html:not(.dark) .pi-enh-usage-panel .pi-enh-role-ratio-bar,
    html:not(.dark) .pi-enh-usage-panel .pi-enh-progress-track {
      background: #e2e8f0 !important;
    }
    html:not(.dark) .pi-enh-usage-panel .pi-enh-model-card div[style*="font-size:10px"],
    html:not(.dark) .pi-enh-usage-panel .pi-enh-model-card div[style*="font-size: 10px"] {
      color: #64748b !important;
    }
    html:not(.dark) .pi-enh-usage-panel .pi-enh-model-card div[style*="rgba(16,185,129,0.08)"],
    html:not(.dark) .pi-enh-usage-panel .pi-enh-model-card div[style*="rgba(16, 185, 129, 0.08)"] {
      background: #ecfdf5 !important;
      border-color: #a7f3d0 !important;
    }
    html:not(.dark) .pi-enh-usage-panel .pi-enh-model-card span[style*="color:#10b981"],
    html:not(.dark) .pi-enh-usage-panel .pi-enh-model-card span[style*="color: #10b981"] {
      color: #047857 !important;
    }
    html:not(.dark) .pi-enh-usage-panel .pi-enh-model-card div[style*="color:#6ee7b7"],
    html:not(.dark) .pi-enh-usage-panel .pi-enh-model-card div[style*="color: #6ee7b7"] {
      color: #065f46 !important;
    }
    html:not(.dark) .pi-enh-usage-panel .pi-enh-model-card div[style*="rgba(56,189,248,0.05)"],
    html:not(.dark) .pi-enh-usage-panel .pi-enh-model-card div[style*="rgba(56, 189, 248, 0.05)"] {
      background: #f0f9ff !important;
      border-color: #bae6fd !important;
    }
    html:not(.dark) .pi-enh-usage-panel .pi-enh-model-card span[style*="color:#38bdf8"],
    html:not(.dark) .pi-enh-usage-panel .pi-enh-model-card span[style*="color: #38bdf8"] {
      color: #0369a1 !important;
    }
    html:not(.dark) .pi-enh-usage-panel .pi-enh-model-card span[style*="color:#7dd3fc"],
    html:not(.dark) .pi-enh-usage-panel .pi-enh-model-card span[style*="color: #7dd3fc"] {
      color: #0369a1 !important;
      border-color: #bae6fd !important;
    }
    html:not(.dark) .pi-enh-usage-panel .pi-enh-model-card div[style*="color:#7dd3fc"],
    html:not(.dark) .pi-enh-usage-panel .pi-enh-model-card div[style*="color: #7dd3fc"] {
      color: #0369a1 !important;
    }
    html:not(.dark) .pi-enh-usage-panel .pi-enh-model-card span[style*="color:#71717a"],
    html:not(.dark) .pi-enh-usage-panel .pi-enh-model-card span[style*="color: #71717a"] {
      color: #64748b !important;
      border-color: #cbd5e1 !important;
    }
    html:not(.dark) .pi-enh-usage-panel .pi-enh-top-session-row {
      background: #ffffff !important;
      border-color: #e2e8f0 !important;
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03) !important;
    }
    html:not(.dark) .pi-enh-usage-panel .pi-enh-top-session-row:hover {
      background: #f0f9ff !important;
      border-color: #7dd3fc !important;
    }
    html:not(.dark) .pi-enh-usage-panel .pi-enh-session-rank-badge {
      background: #f1f5f9 !important;
      color: #475569 !important;
    }
    html:not(.dark) .pi-enh-usage-panel .pi-enh-top-session-row:hover .pi-enh-session-rank-badge {
      background: rgba(3, 105, 161, 0.15) !important;
      color: #0369a1 !important;
    }
    html:not(.dark) .pi-enh-usage-panel .pi-enh-top-session-row .session-title {
      color: #0f172a !important;
    }
    html:not(.dark) .pi-enh-usage-panel .pi-enh-top-session-row .session-sub {
      color: #64748b !important;
    }
    html:not(.dark) .pi-enh-usage-panel .pi-enh-top-session-row .session-tokens {
      color: #0369a1 !important;
    }
    html:not(.dark) .pi-enh-usage-panel .pi-enh-cost-pill {
      background: rgba(3, 105, 161, 0.1) !important;
      color: #0369a1 !important;
    }
    html:not(.dark) .pi-enh-usage-panel p[style*="color:#fbbf24"],
    html:not(.dark) .pi-enh-usage-panel p[style*="color: #fbbf24"] {
      color: #92400e !important;
    }

    /* 审批队列排队样式 */
    .pi-enh-queue-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 8px;
      padding-bottom: 6px;
      border-bottom: 1px solid rgba(245, 158, 11, 0.2);
    }
    .pi-enh-queue-title {
      display: flex;
      align-items: center;
      font-size: 12px;
      font-weight: 600;
      color: #fbbf24;
    }
    .pi-enh-queue-badge {
      background: rgba(245, 158, 11, 0.2);
      color: #fbbf24;
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 600;
      margin-right: 6px;
    }
    .pi-enh-queue-nav-btn {
      background: rgba(255, 255, 255, 0.1);
      border: none;
      color: #fff;
      border-radius: 4px;
      padding: 2px 8px;
      font-size: 11px;
      cursor: pointer;
      margin-left: 4px;
    }
    .pi-enh-queue-nav-btn:hover {
      background: rgba(255, 255, 255, 0.2);
    }

    /* 会话压缩卡片默认折叠与交互样式（含首帧 0ms 原生结构直折，杜绝先展开再折叠造成的高度跳变） */
    html.pi-enh-compaction-collapse-active .chat-content div[style*="border-radius: 8px"]:has(.markdown-compaction-message) > div:nth-child(2):not([data-user-expanded="true"]),
    html.pi-enh-compaction-collapse-active .pi-enh-compaction-body:not([data-user-expanded="true"]) {
      display: none !important;
    }
    html.pi-enh-compaction-collapse-active .chat-content div[style*="border-radius: 8px"]:has(.markdown-compaction-message) > div:first-child:not([data-user-expanded="true"]),
    html.pi-enh-compaction-collapse-active .pi-enh-compaction-header:not([data-user-expanded="true"]) {
      border-bottom: none !important;
    }

    /* 孤立纯过程消息与前置过程块首帧 0ms 原生直折（加载即以折叠态出现，对齐原生 React eI() 过程块判定，杜绝先加载展开再异步折叠引发的往返跳动） */
    html.pi-enh-tool-collapse-active:not(.pi-enh-chat-running) .chat-content [data-entry-id]:has(> div[data-message-role="assistant"] button):not(:has([data-message-text="true"])):not(:has([role="alert"])):not([data-pi-enh-orphan-expanded="true"]),
    html.pi-enh-tool-collapse-active:not(.pi-enh-chat-running) .chat-content [data-entry-id]:has(> div[data-message-role="assistant"] > div[style*="flex-direction: column"] > div:last-child:not([data-message-text="true"]):has(button)):not(:has([role="alert"])):not([data-pi-enh-orphan-expanded="true"]),
    html.pi-enh-tool-collapse-active .chat-content [data-entry-id]:has(> div[data-message-role="assistant"] button):not(:has([data-message-text="true"])):not(:has([role="alert"])):not([data-pi-enh-orphan-expanded="true"]):has(~ [data-entry-id] [data-message-text="true"], ~ [data-entry-id] .markdown-compaction-message, ~ [data-entry-id] [data-message-role="user"], ~ [data-entry-id] .markdown-user-message),
    html.pi-enh-tool-collapse-active .chat-content [data-entry-id]:has(> div[data-message-role="assistant"] > div[style*="flex-direction: column"] > div:last-child:not([data-message-text="true"]):has(button)):not(:has([role="alert"])):not([data-pi-enh-orphan-expanded="true"]):has(~ [data-entry-id] [data-message-text="true"], ~ [data-entry-id] .markdown-compaction-message, ~ [data-entry-id] [data-message-role="user"], ~ [data-entry-id] .markdown-user-message),
    html.pi-enh-tool-collapse-active .chat-content [data-pi-enh-orphan-grouped="true"]:not([data-pi-enh-orphan-expanded="true"]) {
      display: none !important;
    }
    html.pi-enh-tool-collapse-active:not(.pi-enh-chat-running) .chat-content div[data-message-role="assistant"] > div[style*="flex-direction: column"] > div:has(~ div:not([data-message-text="true"]) button):not([data-pi-enh-orphan-expanded="true"]),
    html.pi-enh-tool-collapse-active:not(.pi-enh-chat-running) .chat-content div[data-message-role="assistant"] > div[style*="flex-direction: column"] > div:not([data-message-text="true"]):has(button):has(~ [data-message-text="true"]):not([data-pi-enh-orphan-expanded="true"]),
    html.pi-enh-tool-collapse-active .chat-content [data-entry-id]:has(~ [data-entry-id]) div[data-message-role="assistant"] > div[style*="flex-direction: column"] > div:has(~ div:not([data-message-text="true"]) button):not([data-pi-enh-orphan-expanded="true"]),
    html.pi-enh-tool-collapse-active .chat-content [data-entry-id]:has(~ [data-entry-id]) div[data-message-role="assistant"] > div[style*="flex-direction: column"] > div:not([data-message-text="true"]):has(button):has(~ [data-message-text="true"]):not([data-pi-enh-orphan-expanded="true"]) {
      display: none !important;
    }

    /* 消息底部 footer 容器：移动端与窄屏弹性自适应与防挤压换行（精确命中包含 margin-top: 4px 的 footer，杜绝误伤工具列容器） */
    div[data-message-role="assistant"] > div[style*="margin-top: 4px"],
    div[data-message-role="assistant"] > div[style*="marginTop: 4px"],
    div[data-message-role="assistant"] > div:last-child[style*="gap: 8px"] {
      flex-wrap: wrap !important;
      align-items: center !important;
      row-gap: 4px !important;
      column-gap: 8px !important;
    }

    /* 工具卡片布局稳定与全宽左对齐：
       强制工具垂直列与所有胶囊卡片（工具卡片、思考卡片等）在移动端与桌面端均 100% 撑满聊天列宽度，且内部文字与图标保持左对齐 */
    html.pi-enh-tool-card-layout-stability-active div[data-message-role="assistant"] {
      align-self: stretch !important;
      box-sizing: border-box !important;
      width: 100% !important;
      min-width: 0 !important;
      max-width: 100% !important;
    }
    html.pi-enh-tool-card-layout-stability-active div[data-message-role="assistant"] > div[style*="flex-direction: column"] {
      width: 100% !important;
      min-width: 0 !important;
      max-width: 100% !important;
      align-items: stretch !important;
    }
    html.pi-enh-tool-card-layout-stability-active div[data-message-role="assistant"] div[style*="border-radius: 7px"],
    html.pi-enh-tool-card-layout-stability-active div[data-message-role="assistant"] [data-pi-enh-tool-card],
    html.pi-enh-tool-card-layout-stability-active [data-pi-enh-native-process] div[style*="border-radius: 7px"],
    html.pi-enh-tool-card-layout-stability-active .pi-enh-orphan-process-group div[style*="border-radius: 7px"] {
      box-sizing: border-box !important;
      width: 100% !important;
      min-width: 0 !important;
      max-width: 100% !important;
      align-self: stretch !important;
      text-align: left !important;
    }
    html.pi-enh-tool-card-layout-stability-active div[data-message-role="assistant"] div[style*="border-radius: 7px"] button:not([aria-expanded="true"]) {
      text-align: left !important;
      justify-content: flex-start !important;
    }
    html.pi-enh-tool-card-layout-stability-active div[data-message-role="assistant"] div[style*="border-radius: 7px"] pre,
    html.pi-enh-tool-card-layout-stability-active div[data-message-role="assistant"] div[style*="border-radius: 7px"] code {
      text-align: left !important;
      white-space: pre-wrap !important;
      word-break: break-word !important;
      overflow-wrap: anywhere !important;
    }

    @media (max-width: 768px) {
      div[data-message-role="assistant"] > div[style*="flex-direction: column"] {
        width: 100% !important;
        align-items: stretch !important;
      }
      div[data-message-role="assistant"] div[style*="border-radius: 7px"] {
        box-sizing: border-box !important;
        width: 100% !important;
        align-self: stretch !important;
        text-align: left !important;
      }
    }

    /* 恢复助手正文原生字号；不触碰消息 footer、时间或 Token 消耗 */
    .pi-enh-native-message-font-active div[data-message-role="assistant"] .markdown-body {
      font-size: var(--chat-content-font-size, 14px) !important;
      line-height: 1.7 !important;
      font-family: inherit !important;
      font-weight: inherit !important;
    }

    /* 流式思考聚合守卫样式 */
    html.pi-enh-streaming-thinking-guard-active [data-pi-enh-thinking-folded="true"] {
      display: none !important;
    }
    .pi-enh-thinking-aggregate-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 11px;
      line-height: 1.4;
      padding: 3px 8px;
      margin: 4px 0;
      border-radius: 6px;
      background: color-mix(in srgb, var(--accent, #60a5fa) 12%, transparent);
      color: var(--accent, #60a5fa);
      border: 1px solid color-mix(in srgb, var(--accent, #60a5fa) 25%, transparent);
      animation: pi-enh-thinking-pulse 2s ease-in-out infinite;
    }
    @keyframes pi-enh-thinking-pulse {
      0%, 100% { opacity: 0.85; }
      50% { opacity: 1; }
    }

    /* Token 消耗统计徽章：简洁纯净自然文本，保留原子项防尴尬折断，支持大热区 */
    .pi-enh-usage-badge {
      display: inline-flex !important;
      align-items: center !important;
      flex-wrap: wrap !important;
      row-gap: 2px !important;
      column-gap: 3px !important;
      font-size: 11px !important;
      line-height: 1.4 !important;
      color: var(--text-dim, #71717a) !important;
      background: transparent !important;
      border: none !important;
      padding: 2px 2px !important;
      cursor: pointer !important;
      max-width: 100% !important;
      box-sizing: border-box !important;
      transition: color 0.15s !important;
      user-select: none !important;
      position: relative !important;
    }
    .pi-enh-usage-badge:hover,
    .pi-enh-usage-badge:active {
      color: var(--text, #f4f4f5) !important;
    }
    .pi-enh-usage-badge::after {
      content: "";
      position: absolute;
      top: -8px;
      bottom: -8px;
      left: -4px;
      right: -4px;
    }
    .pi-enh-usage-chunk {
      display: inline-block !important;
      white-space: nowrap !important;
    }
    .pi-enh-usage-dot {
      opacity: 0.55 !important;
      font-size: 10px !important;
      user-select: none !important;
      margin: 0 1px !important;
    }

    /* 对话轮次序号徽章 (Turn Number Indicator) */
    .pi-enh-turn-number-badge {
      display: inline-flex !important;
      align-items: center !important;
      font-size: 11px !important;
      line-height: 1.2 !important;
      font-weight: 500 !important;
      font-variant-numeric: tabular-nums !important;
      color: var(--text-muted, #a1a1aa) !important;
      opacity: 0.82 !important;
      margin-right: 5px !important;
      user-select: none !important;
      white-space: nowrap !important;
      letter-spacing: -0.01em !important;
      transition: opacity 0.15s ease, color 0.15s ease !important;
      cursor: default !important;
      flex-shrink: 0 !important;
    }
    .pi-enh-turn-number-badge:hover {
      opacity: 1 !important;
      color: var(--text, #f4f4f5) !important;
    }

    /* 子 Agent 省钱摘要卡片（独立全宽紧凑区域） */
    .pi-enh-subagent-savings-box {
      margin: 0 0 10px 0 !important;
      padding: 9px 12px !important;
      background: rgba(255, 255, 255, 0.03) !important;
      border: 1px solid rgba(255, 255, 255, 0.1) !important;
      border-radius: 6px !important;
      box-sizing: border-box !important;
      max-width: 100% !important;
      flex-shrink: 0 !important;
    }

    /* 降本统计区域语义配色体系：中性深色卡面 + 冷蓝(实际) + 琥珀(假设/调度) + 青色(节省结果) */
    .pi-enh-subagent-savings-panel {
      margin-top: 10px;
      padding: 8px 10px;
      background: rgba(6, 182, 212, 0.08);
      border: 1px solid rgba(6, 182, 212, 0.25);
      border-radius: 6px;
      box-sizing: border-box;
    }
    .pi-enh-savings-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 4px 8px;
    }
    .pi-enh-savings-title {
      font-size: 12px;
      font-weight: 700;
      color: #22d3ee;
      white-space: nowrap;
    }
    .pi-enh-savings-badge {
      margin-left: auto;
      font-size: 11px;
      font-weight: 700;
      color: #22d3ee;
      white-space: nowrap;
    }
    .pi-enh-savings-breakdown {
      font-size: 11px;
      color: #e4e4e7;
      margin-top: 5px;
      display: flex;
      align-items: center;
      gap: 5px;
      flex-wrap: wrap;
    }
    .pi-enh-savings-sep {
      color: #71717a;
    }
    .pi-enh-savings-subnote {
      font-size: 10px;
      color: #67e8f9;
      margin-top: 4px;
      line-height: 1.4;
    }
    .pi-enh-dispatch-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      font-size: 11px;
      line-height: 1.4;
      margin-top: 4px;
    }
    .pi-enh-dispatch-lbl {
      color: #fbbf24;
      font-weight: 500;
      white-space: nowrap;
    }
    .pi-enh-dispatch-badge {
      font-weight: 700;
      color: #fbbf24;
      background: rgba(245, 158, 11, 0.14);
      padding: 1px 6px;
      border-radius: 3px;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    .pi-enh-dispatch-total-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      font-size: 11px;
      line-height: 1.4;
      margin-top: 6px;
      padding-top: 5px;
      border-top: 1px dashed rgba(245, 158, 11, 0.25);
    }
    .pi-enh-dispatch-total-lbl {
      color: #f59e0b;
      font-weight: 600;
      white-space: nowrap;
    }
    .pi-enh-dispatch-total-val {
      font-weight: 700;
      color: #f59e0b;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    .pi-enh-dispatch-note {
      color: #fbbf24;
    }

    /* 消耗明细专用浮层与明细滚动容器：限制最大高度并允许内部滚动 */
    .pi-enh-usage-tooltip {
      flex-direction: column !important;
      overflow-x: hidden !important;
      overflow-y: hidden !important;
      box-sizing: border-box !important;
    }
    .pi-enh-usage-detail-scroll {
      flex: 1 1 auto !important;
      min-height: 0 !important;
      overflow-y: auto !important;
      overscroll-behavior: contain !important;
      padding-right: 2px !important;
      padding-bottom: 6px !important;
      scrollbar-width: thin !important;
    }

    /* 回合消耗明细表格：严格 3 列网格对齐体系 */
    .pi-enh-usage-grid {
      display: grid !important;
      grid-template-columns: minmax(185px, 1.6fr) minmax(115px, 1fr) minmax(95px, 0.85fr) !important;
      column-gap: 8px !important;
      row-gap: 4.5px !important;
      font-size: 11px !important;
      line-height: 1.45 !important;
      align-items: center !important;
    }

    /* 移动端 360px/390px 局部响应式收敛（仅限制在 usage tooltip 内部） */
    @media (max-width: 480px) {
      .pi-enh-usage-tooltip {
        padding: 9px 10px !important;
        min-width: 0 !important;
        max-width: calc(100vw - 20px) !important;
      }
      .pi-enh-usage-tooltip .pi-enh-usage-grid {
        grid-template-columns: minmax(95px, 1.3fr) minmax(80px, 1.1fr) minmax(75px, 1fr) !important;
        column-gap: 4px !important;
        row-gap: 4px !important;
        font-size: 10px !important;
      }
      .pi-enh-usage-tooltip .pi-enh-subagent-savings-box {
        padding: 7px 9px !important;
        margin-bottom: 7px !important;
      }
      .pi-enh-usage-tooltip .pi-enh-grid-col-left,
      .pi-enh-usage-tooltip .pi-enh-grid-col-right {
        font-size: 10px !important;
      }
    }
    .pi-enh-grid-header {
      font-weight: 600 !important;
      color: var(--text-dim, #a1a1aa) !important;
      border-bottom: 1px solid rgba(255, 255, 255, 0.12) !important;
      padding-bottom: 5px !important;
      margin-bottom: 2px !important;
    }
    .pi-enh-grid-col-left {
      text-align: left !important;
      white-space: nowrap !important;
      overflow: hidden !important;
      text-overflow: ellipsis !important;
    }
    .pi-enh-grid-col-right {
      text-align: right !important;
      font-variant-numeric: tabular-nums !important;
      white-space: nowrap !important;
    }
    .pi-enh-grid-divider {
      grid-column: 1 / -1 !important;
      height: 1px !important;
      background: rgba(255, 255, 255, 0.05) !important;
      margin: 1px 0 !important;
    }

    /* 任务总耗时徽章：靠右锚定在时间戳左侧，与时间戳组成稳定的右侧信息群 */
    .pi-enh-duration-badge {
      display: inline-flex !important;
      align-items: center !important;
      gap: 2px !important;
      white-space: nowrap !important;
      flex-shrink: 0 !important;
      font-size: 11px !important;
      font-weight: 500 !important;
      font-variant-numeric: tabular-nums !important;
      line-height: 1.2 !important;
      padding: 2px 4px !important;
      color: #38bdf8 !important;
      background: transparent !important;
      border: none !important;
      cursor: pointer !important;
      margin-left: auto !important;
      margin-right: 4px !important;
      user-select: none !important;
      transition: color 0.15s ease !important;
      position: relative !important;
    }
    .pi-enh-duration-badge:hover,
    .pi-enh-duration-badge:active {
      color: #7dd3fc !important;
    }
    .pi-enh-duration-badge::after {
      content: "";
      position: absolute;
      top: -8px;
      bottom: -8px;
      left: -4px;
      right: -4px;
    }

    /* 任务执行中实时计时器徽章：同款靠右锚定，平滑替代耗时位置 */
    .pi-enh-live-timer {
      display: inline-flex !important;
      align-items: center !important;
      gap: 2px !important;
      white-space: nowrap !important;
      flex-shrink: 0 !important;
      font-size: 11px !important;
      font-weight: 500 !important;
      font-variant-numeric: tabular-nums !important;
      line-height: 1.2 !important;
      padding: 2px 4px !important;
      color: #38bdf8 !important;
      background: transparent !important;
      border: none !important;
      cursor: default !important;
      margin-left: auto !important;
      margin-right: 4px !important;
      user-select: none !important;
    }

    /* 当耗时徽章或秒表位于时间戳前面时，时间戳不再独立拥有 auto 边距，彻底杜绝两个 auto 抢占空间带来的抽动 */
    .pi-enh-duration-badge ~ span[data-pi-enh-timestamp],
    .pi-enh-live-timer ~ span[data-pi-enh-timestamp],
    .pi-enh-duration-badge + span,
    .pi-enh-live-timer + span {
      margin-left: 0 !important;
    }
    .pi-enh-compaction-header {
      cursor: pointer;
      user-select: none;
      transition: background 0.12s ease;
    }
    .pi-enh-compaction-header:hover {
      background: var(--bg-hover, rgba(255, 255, 255, 0.08)) !important;
    }
    .pi-enh-compaction-header:hover .pi-enh-compaction-toggle-btn {
      color: var(--text, #f4f4f5);
    }
    .pi-enh-compaction-toggle-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 18px;
      height: 18px;
      margin-left: 2px;
      margin-right: -2px;
      padding: 0;
      border: none !important;
      background: transparent !important;
      color: var(--text-dim, #71717a);
      cursor: pointer;
      flex-shrink: 0;
      transition: color 0.15s ease;
      outline: none;
      box-shadow: none !important;
    }
    .pi-enh-compaction-toggle-btn:hover {
      color: var(--text, #f4f4f5);
    }
    .pi-enh-compaction-arrow {
      display: block;
      transition: transform 0.15s ease;
      transform-origin: center;
    }
    .pi-enh-compaction-toggle-btn[aria-expanded="true"] .pi-enh-compaction-arrow,
    .pi-enh-compaction-header[data-user-expanded="true"] .pi-enh-compaction-arrow {
      transform: rotate(180deg);
    }

    /* Context Menu */
    .pi-enh-menu {
      position: fixed;
      z-index: 99999;
      background: var(--bg, #18181b);
      color: var(--text, #f4f4f5);
      border: 1px solid var(--border, #27272a);
      border-radius: 8px;
      box-shadow: 0 10px 28px rgba(0, 0, 0, 0.45), 0 2px 8px rgba(0, 0, 0, 0.25);
      padding: 5px;
      min-width: 230px;
      max-height: calc(100vh - 16px);
      max-height: calc(100dvh - 16px);
      box-sizing: border-box;
      overflow-y: auto;
      overscroll-behavior: contain;
      scrollbar-width: thin;
      scrollbar-color: rgba(255, 255, 255, 0.2) transparent;
      font-size: 13px;
      user-select: none;
      backdrop-filter: blur(16px);
      animation: piEnhFadeIn 0.12s cubic-bezier(0.16, 1, 0.3, 1);
    }
    .pi-enh-menu::-webkit-scrollbar {
      width: 4px;
    }
    .pi-enh-menu::-webkit-scrollbar-track {
      background: transparent;
    }
    .pi-enh-menu::-webkit-scrollbar-thumb {
      background: rgba(255, 255, 255, 0.2);
      border-radius: 4px;
    }
    .pi-enh-menu::-webkit-scrollbar-thumb:hover {
      background: rgba(255, 255, 255, 0.35);
    }
    .pi-enh-menu-item {
      display: flex;
      align-items: center;
      gap: 9px;
      padding: 7px 10px;
      border-radius: 6px;
      cursor: pointer;
      color: var(--text, #f4f4f5);
      transition: background 0.1s, color 0.1s;
    }
    .pi-enh-menu-item:hover {
      background: var(--bg-hover, rgba(255, 255, 255, 0.08));
      color: var(--accent, #60a5fa);
    }
    .pi-enh-menu-item svg {
      flex-shrink: 0;
      opacity: 0.85;
    }
    .pi-enh-menu-sep {
      height: 1px;
      background: var(--border, #27272a);
      margin: 4px 6px;
      opacity: 0.7;
    }
    .pi-enh-menu-header {
      padding: 6px 10px 4px 10px;
      font-size: 11px;
      color: var(--text-muted, #71717a);
      font-weight: 500;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      max-width: 240px;
    }

    /* Codex-style Session Pin & Archive */
    .pi-enh-session-overflow {
      /* Final action slot: later status/model decorations cannot move past it. */
      order: 2147483647;
      display: inline-flex;
      flex: 0 0 auto;
      align-items: center;
      justify-content: center;
      width: 26px;
      height: 26px;
      padding: 0;
      border: 0;
      border-radius: 5px;
      background: transparent;
      color: var(--text-muted, #a1a1aa);
      cursor: pointer;
      opacity: 0;
      pointer-events: none;
      transition: opacity 120ms ease, background 120ms ease, color 120ms ease;
    }
    .pi-enh-session-row-host:hover .pi-enh-session-overflow,
    .pi-enh-session-row-host:focus-within .pi-enh-session-overflow {
      opacity: 1;
      pointer-events: auto;
    }
    .pi-enh-session-overflow:hover,
    .pi-enh-session-overflow:focus-visible {
      background: var(--bg-hover, rgba(255, 255, 255, 0.08));
      color: var(--text, #f4f4f5);
      outline: none;
    }
    .pi-enh-session-pinned-indicator {
      order: 2147483640 !important;
      display: inline-flex;
      flex: 0 0 auto;
      align-items: center;
      justify-content: center;
      width: 26px;
      height: 26px;
      padding: 0;
      border: 0;
      border-radius: 5px;
      background: transparent;
      color: var(--text-muted, #a1a1aa);
      cursor: pointer;
      transition: background 120ms ease, color 120ms ease;
    }
    .pi-enh-session-pinned-indicator:hover,
    .pi-enh-session-pinned-indicator:focus-visible {
      background: var(--bg-hover, rgba(255, 255, 255, 0.08));
      color: var(--text, #f4f4f5);
      outline: none;
    }
    /* 会话置顶与最近分组小标题 (Session Section Headers) */
    .pi-enh-session-section-header {
      font-family: var(--font-sans, system-ui, -apple-system, sans-serif);
      font-size: 12px;
      font-weight: 400;
      color: var(--text-muted, #71717a);
      user-select: none;
      pointer-events: none;
      letter-spacing: 0.01em;
      box-sizing: border-box;
      line-height: 1;
    }
    .pi-enh-session-model-badge {
      display: inline-block;
      vertical-align: middle;
      max-width: 100%;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      padding: 0;
      border: 0;
      background: transparent;
      color: inherit;
      font: inherit;
      line-height: inherit;
      flex: 0 1 auto;
    }
    html:not(.pi-enh-session-compact-active) .pi-enh-session-model-badge {
      display: inline;
      margin-left: 12px;
      white-space: nowrap;
    }
    html.pi-enh-session-compact-active .pi-enh-session-model-badge {
      margin-left: 0 !important;
    }

    /* 会话行主体内容与行内编辑输入框：视觉锁定在左侧最前，排版稳定 */
    .pi-enh-session-row-host {
      touch-action: pan-y manipulation !important;
      -webkit-tap-highlight-color: transparent;
    }
    /* 彻底杜绝长按会话选中文字及误唤起系统菜单/引用工具条 */
    #session-sidebar,
    .sidebar-container,
    .pi-enh-session-row-host,
    .pi-enh-session-title,
    .pi-enh-session-meta,
    .pi-enh-session-msg-count,
    .pi-enh-session-model-badge,
    .pi-enh-session-time {
      -webkit-user-select: none !important;
      -moz-user-select: none !important;
      -ms-user-select: none !important;
      user-select: none !important;
      -webkit-touch-callout: none !important;
    }
    .pi-enh-session-row-host input {
      -webkit-user-select: text !important;
      user-select: text !important;
      -webkit-touch-callout: default !important;
    }
    .pi-enh-session-row-host > div:not(.pi-enh-native-session-actions):not(.pi-enh-session-overflow):not(.pi-enh-session-pinned-indicator):not(.pi-enh-session-model-badge),
    .pi-enh-session-row-host > input {
      order: 1 !important;
      flex: 1 1 0 !important;
      min-width: 0 !important;
    }

    /* 编辑状态下的会话名称输入框：占满整行宽度，边界对齐 */
    .pi-enh-session-row-host > input {
      box-sizing: border-box !important;
      width: 100% !important;
    }

    /* 编辑状态下：严禁强行显示模型名字，隐藏置顶图钉与标签徽标以提供最大输入空间 */
    .pi-enh-session-row-host:has(input) .pi-enh-session-model-badge,
    .pi-enh-session-row-host[data-pi-enh-editing="true"] .pi-enh-session-model-badge,
    .pi-enh-session-row-host:has(input) .pi-enh-session-pinned-indicator,
    .pi-enh-session-row-host[data-pi-enh-editing="true"] .pi-enh-session-pinned-indicator,
    .pi-enh-session-row-host:has(input) .pi-enh-session-tags-row,
    .pi-enh-session-row-host[data-pi-enh-editing="true"] .pi-enh-session-tags-row {
      display: none !important;
    }

    /* 会话列表紧凑与排版自适应 (Session Item Compact) */
    html.pi-enh-session-compact-active .pi-enh-session-row-host {
      overflow: hidden !important;
    }
    html.pi-enh-session-compact-active .pi-enh-session-row-host > div:not(.pi-enh-native-session-actions) {
      min-width: 0 !important;
    }

    /* 标题行：强制单行省略截断，稳固锁定在首行 */
    html.pi-enh-session-compact-active .pi-enh-session-title,
    html.pi-enh-session-compact-active .pi-enh-session-row-host > div:not(.pi-enh-native-session-actions):not(.pi-enh-session-odoo-addons) > div:first-child {
      min-width: 0 !important;
      max-width: 100% !important;
      overflow: hidden !important;
      text-overflow: ellipsis !important;
      white-space: nowrap !important;
      line-height: 20px !important;
    }

    /* 元数据行：强制单行、高度锁定最大 18px，彻底杜绝任何折行撑高与挤爆 */
    html.pi-enh-session-compact-active .pi-enh-session-meta,
    html.pi-enh-session-compact-active .pi-enh-session-row-host:not([data-pi-enh-has-tags="true"]) > div:not(.pi-enh-native-session-actions):not(.pi-enh-session-odoo-addons) > div:last-child:not(.pi-enh-session-odoo-addons) {
      display: flex !important;
      align-items: center !important;
      min-width: 0 !important;
      max-width: 100% !important;
      max-height: 18px !important;
      line-height: 18px !important;
      overflow: hidden !important;
      white-space: nowrap !important;
      gap: 6px !important;
      margin-top: 2px !important;
    }

    /* 元数据内所有子元素禁止垂直折行 */
    html.pi-enh-session-compact-active .pi-enh-session-meta > * {
      white-space: nowrap !important;
    }

    /* 时间与运行图标防挤压防折行 */
    html.pi-enh-session-compact-active .pi-enh-session-time,
    html.pi-enh-session-compact-active .pi-enh-session-meta > span:first-child {
      white-space: nowrap !important;
      flex-shrink: 0 !important;
      font-variant-numeric: tabular-nums;
    }

    /* 消息数量文本基础样式：单行禁止折行 */
    html.pi-enh-session-compact-active .pi-enh-session-msg-count {
      white-space: nowrap !important;
      flex-shrink: 0 !important;
    }

    /* 手机端 / 触屏设备 / 窄屏视口：精简掉“多少条消息”，优化状态胶囊与操作按钮 */
    @media (max-width: 768px), (pointer: coarse) {
      /* 触屏会把 :hover 留在刚选中的行；原生编辑/删除按钮会挤垮内容列，
         统一使用右侧的更多操作入口，避免选中行出现竖排元数据。 */
      html.pi-enh-session-compact-active .pi-enh-session-row-host .pi-enh-native-session-actions,
      .pi-enh-session-row-host .pi-enh-native-session-actions {
        display: none !important;
      }
      .pi-enh-session-overflow {
        opacity: 0.72 !important;
        pointer-events: auto !important;
      }
      html.pi-enh-session-compact-active .pi-enh-session-meta {
        flex-direction: row !important;
        flex-wrap: nowrap !important;
      }
      html.pi-enh-session-compact-active .pi-enh-session-meta > * {
        display: inline-flex !important;
        align-items: center !important;
        flex: 0 0 auto !important;
        min-width: 0 !important;
        white-space: nowrap !important;
      }
      html.pi-enh-session-compact-active .pi-enh-session-msg-count,
      html.pi-enh-session-compact-active .pi-enh-session-model-badge {
        overflow: hidden !important;
        text-overflow: ellipsis !important;
      }
      html.pi-enh-session-compact-active .pi-enh-session-msg-count {
        max-width: 40% !important;
      }
      html.pi-enh-session-compact-active .pi-enh-session-model-badge {
        flex: 1 1 auto !important;
        max-width: 100% !important;
      }
      html.pi-enh-session-compact-active .pi-enh-session-msg-count {
        display: none !important;
      }
      html.pi-enh-session-compact-active .pi-enh-session-status-label {
        font-size: 10px !important;
        line-height: 16px !important;
        padding: 0 4px !important;
        max-width: 56px !important;
      }
      html.pi-enh-session-compact-active .pi-enh-session-overflow {
        width: 22px !important;
        height: 22px !important;
      }
    }

    /* JS 环境检测移动端兜底 (html.pi-enh-mobile) */
    html.pi-enh-mobile.pi-enh-session-compact-active .pi-enh-session-msg-count,
    html.pi-enh-mobile .pi-enh-session-msg-count {
      display: none !important;
    }
    html.pi-enh-mobile .pi-enh-session-row-host .pi-enh-native-session-actions {
      display: none !important;
    }
    html.pi-enh-mobile .pi-enh-session-overflow {
      opacity: 0.72 !important;
      pointer-events: auto !important;
    }

    /* 移动端与触屏设备：消息底部操作按钮（复制/编辑/分叉）常驻可见，彻底消除“半天没加载出来”假象 */
    html.pi-enh-mobile div[data-message-role="assistant"] button[title*="复制" i],
    html.pi-enh-mobile div[data-message-role="assistant"] button[title*="Copy" i],
    html.pi-enh-mobile div[data-message-role="assistant"] button.pi-enh-copy-msg-btn {
      opacity: 0.85 !important;
      pointer-events: auto !important;
    }
    html.pi-enh-mobile div[data-message-role="assistant"] button[title*="复制" i]:active,
    html.pi-enh-mobile div[data-message-role="assistant"] button[title*="Copy" i]:active,
    html.pi-enh-mobile div[data-message-role="assistant"] button.pi-enh-copy-msg-btn:active {
      opacity: 1 !important;
      color: var(--accent, #38bdf8) !important;
    }
    html.pi-enh-mobile div[style*="align-items: flex-end"] > div[style*="justify-content: flex-end"] > div,
    html.pi-enh-mobile div[style*="alignItems: flex-end"] > div[style*="justifyContent: flex-end"] > div {
      opacity: 0.85 !important;
      pointer-events: auto !important;
    }

    /* 触屏与窄屏媒体查询兜底 (无论是否已挂载 html.pi-enh-mobile) */
    @media (hover: none), (pointer: coarse), (max-width: 768px) {
      div[data-message-role="assistant"] button[title*="复制" i],
      div[data-message-role="assistant"] button[title*="Copy" i],
      div[data-message-role="assistant"] button.pi-enh-copy-msg-btn {
        opacity: 0.85 !important;
        pointer-events: auto !important;
      }
      div[data-message-role="assistant"] button[title*="复制" i]:active,
      div[data-message-role="assistant"] button[title*="Copy" i]:active,
      div[data-message-role="assistant"] button.pi-enh-copy-msg-btn:active {
        opacity: 1 !important;
        color: var(--accent, #38bdf8) !important;
      }
      div[style*="align-items: flex-end"] > div[style*="justify-content: flex-end"] > div,
      div[style*="alignItems: flex-end"] > div[style*="justifyContent: flex-end"] > div {
        opacity: 0.85 !important;
        pointer-events: auto !important;
      }
    }

    /* 桌面端消息卡片悬停即时 0 延时高亮复制与操作按钮 */
    div[data-message-role="assistant"]:hover button[title*="复制" i],
    div[data-message-role="assistant"]:hover button[title*="Copy" i] {
      opacity: 1 !important;
      pointer-events: auto !important;
    }
    div[style*="align-items: flex-end"]:hover > div[style*="justify-content: flex-end"] > div,
    div[style*="alignItems: flex-end"]:hover > div[style*="justifyContent: flex-end"] > div {
      opacity: 1 !important;
      pointer-events: auto !important;
    }
    html.pi-enh-mobile.pi-enh-session-compact-active .pi-enh-session-status-label {
      font-size: 10px !important;
      line-height: 16px !important;
      padding: 0 4px !important;
      max-width: 56px !important;
    }
    html.pi-enh-mobile.pi-enh-session-compact-active .pi-enh-session-overflow {
      width: 22px !important;
      height: 22px !important;
    }
    .pi-enh-session-row-host[data-pi-enh-session-color] {
      background: color-mix(in srgb, var(--pi-enh-session-color) 16%, transparent) !important;
      box-shadow: inset 3px 0 0 var(--pi-enh-session-color);
    }
    .pi-enh-session-row-host[data-pi-enh-session-color="blue"] { --pi-enh-session-color: #60a5fa; }
    .pi-enh-session-row-host[data-pi-enh-session-color="green"] { --pi-enh-session-color: #34d399; }
    .pi-enh-session-row-host[data-pi-enh-session-color="yellow"] { --pi-enh-session-color: #fbbf24; }
    .pi-enh-session-row-host[data-pi-enh-session-color="orange"] { --pi-enh-session-color: #fb923c; }
    .pi-enh-session-row-host[data-pi-enh-session-color="red"] { --pi-enh-session-color: #fb7185; }
    .pi-enh-session-row-host[data-pi-enh-session-color="purple"] { --pi-enh-session-color: #a78bfa; }
    .pi-enh-session-color-label {
      margin: 5px 10px 3px;
      color: var(--text-muted, #a1a1aa);
      font-size: 10px;
      font-weight: 600;
    }
    .pi-enh-session-color-grid {
      display: grid;
      grid-template-columns: repeat(6, 1fr);
      gap: 6px;
      padding: 2px 10px 8px;
    }
    .pi-enh-session-color-choice {
      width: 20px;
      height: 20px;
      padding: 0;
      border: 2px solid transparent;
      border-radius: 50%;
      background: var(--pi-enh-session-color-choice);
      cursor: pointer;
    }
    .pi-enh-session-color-choice:hover,
    .pi-enh-session-color-choice:focus-visible,
    .pi-enh-session-color-choice.is-selected {
      border-color: var(--text, #f4f4f5);
      outline: none;
      transform: scale(1.08);
    }

    /* ==========================================
       会话彩色标签 (Session Tags)
       ========================================== */
    /* 立即同步提升包含有标签行的外层绝对定位容器高度，绝不延迟溢出 */
    div:has(> .pi-enh-session-row-host[data-pi-enh-has-tags="true"]:not([data-pi-enh-has-odoo-addons="true"])) {
      height: 72px !important;
    }
    .pi-enh-session-row-host[data-pi-enh-has-tags="true"]:not([data-pi-enh-has-odoo-addons="true"]) {
      height: 72px !important;
      min-height: 72px !important;
      padding-top: 7px !important;
      padding-bottom: 8px !important;
      box-sizing: border-box !important;
    }
    .pi-enh-session-row-host[data-pi-enh-has-odoo-addons="true"] {
      display: grid !important;
      grid-template-columns: minmax(0, 1fr) repeat(3, max-content);
      align-content: center;
      column-gap: 6px !important;
      row-gap: 0 !important;
      padding-top: 6px !important;
      padding-bottom: 6px !important;
      box-sizing: border-box !important;
    }
    .pi-enh-session-row-host[data-pi-enh-has-odoo-addons="true"][hidden],
    .pi-enh-session-row-host[data-pi-enh-has-odoo-addons="true"][style*="display: none"] {
      display: none !important;
    }
    .pi-enh-session-row-host[data-pi-enh-has-odoo-addons="true"] > :not(.pi-enh-session-odoo-addons) {
      grid-row: 1;
    }
    .pi-enh-session-row-host[data-pi-enh-has-odoo-addons="true"] > .pi-enh-session-odoo-addons {
      grid-row: 2;
      grid-column: 1 / -1;
    }
    .pi-enh-session-row-host[data-pi-enh-has-odoo-addons="true"] .pi-enh-session-tags-row {
      margin-top: 2px;
      margin-bottom: 0;
      flex-wrap: nowrap;
    }
    .pi-enh-session-tags-row {
      display: flex;
      align-items: center;
      gap: 5px;
      margin-top: 6px;
      margin-bottom: 1px;
      padding: 0;
      flex-wrap: nowrap;
      width: 100%;
      min-width: 0;
      line-height: normal;
      box-sizing: border-box;
      overflow: hidden;
    }
    .pi-enh-session-tag-pill {
      height: 19px;
      line-height: 17px;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 0 6px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 500;
      white-space: nowrap;
      max-width: 110px;
      min-width: 0;
      flex: 0 1 auto;
      box-sizing: border-box;
      user-select: none;
    }
    .pi-enh-session-tag-pill .pi-enh-tag-dot {
      width: 5.5px;
      height: 5.5px;
      border-radius: 50%;
      flex-shrink: 0;
    }
    .pi-enh-session-tag-pill .pi-enh-tag-name {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      min-width: 0;
    }
    .pi-enh-session-tag-more {
      cursor: default;
      font-weight: 600;
      padding: 0 5px;
      flex-shrink: 0;
      max-width: none;
    }

    /* ==========================================
       Odoo 插件更新状态胶囊药丸 (Odoo Addon Update Badges)
       纯白外框、圆形胶囊药丸、纯白字体、底纹微光发光质感
       ========================================== */
    .pi-enh-session-row-host:has(input) .pi-enh-session-odoo-addons,
    .pi-enh-session-row-host[data-pi-enh-editing="true"] .pi-enh-session-odoo-addons {
      display: none !important;
    }
    .pi-enh-session-odoo-addons {
      display: flex;
      flex-direction: column;
      gap: 4px;
      margin-top: 4px;
      margin-bottom: 4px;
      padding: 0;
      width: 100%;
      min-width: 0;
      line-height: normal;
      box-sizing: border-box;
    }
    .pi-enh-odoo-addon-row {
      flex: 0 0 20px;
      display: flex;
      align-items: center;
      width: 100%;
      min-width: 0;
      height: 20px;
      box-sizing: border-box;
    }
    .pi-enh-odoo-addon-pill {
      height: 20px;
      line-height: 18px;
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 0 7px;
      border-radius: 9999px; /* 完全圆润的圆形药丸胶囊 */
      border: 1px solid rgba(255, 255, 255, 0.75); /* 白色的框 */
      color: #ffffff; /* 字体也是白色的 */
      font-size: 11px;
      font-weight: 500;
      white-space: nowrap;
      max-width: 100%;
      box-sizing: border-box;
      user-select: none;
      /* 里面底纹稍微有一点发光的感觉：微透白底 + 双重微光发光阴影 + 发光文字阴影 */
      background: radial-gradient(ellipse at 50% 50%, rgba(255, 255, 255, 0.16) 0%, rgba(255, 255, 255, 0.05) 100%);
      background-color: #343943; /* 白色文字在浅色主题中仍有足够对比度 */
      box-shadow: 0 0 8px rgba(255, 255, 255, 0.18), inset 0 0 5px rgba(255, 255, 255, 0.12);
      text-shadow: 0 0 4px rgba(255, 255, 255, 0.45);
      backdrop-filter: blur(4px);
      transition: all 0.15s ease-in-out;
      cursor: default;
    }
    .pi-enh-odoo-addon-pill:hover {
      border-color: rgba(255, 255, 255, 0.98);
      background: radial-gradient(ellipse at 50% 50%, rgba(255, 255, 255, 0.24) 0%, rgba(255, 255, 255, 0.08) 100%);
      background-color: #343943;
      box-shadow: 0 0 12px rgba(255, 255, 255, 0.32), inset 0 0 7px rgba(255, 255, 255, 0.2);
      text-shadow: 0 0 6px rgba(255, 255, 255, 0.7);
    }
    .pi-enh-odoo-addon-dot {
      width: 5px;
      height: 5px;
      border-radius: 50%;
      background-color: #ffffff;
      box-shadow: 0 0 5px #ffffff, 0 0 8px rgba(255, 255, 255, 0.6);
      flex-shrink: 0;
    }
    .pi-enh-odoo-addon-pill.is-latest,
    html:not(.dark) .pi-enh-odoo-addon-pill.is-latest {
      border-color: #65c988;
      box-shadow: 0 0 4px rgba(132, 174, 144, 0.11), inset 0 0 3px rgba(132, 174, 144, 0.07);
    }
    .pi-enh-odoo-addon-pill.is-latest:hover,
    html:not(.dark) .pi-enh-odoo-addon-pill.is-latest:hover {
      border-color: #83dda2;
      box-shadow: 0 0 7px rgba(132, 174, 144, 0.19), inset 0 0 4px rgba(132, 174, 144, 0.1);
    }
    .pi-enh-odoo-addon-pill.is-latest .pi-enh-odoo-addon-dot,
    html:not(.dark) .pi-enh-odoo-addon-pill.is-latest .pi-enh-odoo-addon-dot {
      background-color: #22c55e;
      box-shadow: 0 0 3px rgba(34, 197, 94, 0.32);
    }
    .pi-enh-odoo-addon-name {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
      font-size: 10.5px;
      font-weight: 500;
      color: #ffffff;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      letter-spacing: 0;
    }
    .pi-enh-odoo-addon-tech {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
      font-size: 10.5px;
      color: rgba(255, 255, 255, 0.85);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      flex-shrink: 1;
    }

    /* 搜索栏下方标签一键过滤胶囊条 (Session Tag Filter Bar) */
    .pi-enh-session-tag-filter-bar {
      display: flex;
      align-items: center;
      gap: 5px;
      padding: 4px 0 6px;
      margin-top: 4px;
      margin-bottom: 4px;
      overflow-x: auto;
      white-space: nowrap;
      scrollbar-width: none;
      -webkit-overflow-scrolling: touch;
    }
    .pi-enh-session-tag-filter-bar::-webkit-scrollbar {
      display: none;
    }
    /* 1. 基础胶囊（未选中状态）：白边框 1px 细线、白字不加粗、微透白底（与全部底纹一致） */
    .pi-enh-tag-filter-pill {
      height: 19px;
      line-height: 17px;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 0 6px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 400;
      cursor: pointer;
      box-sizing: border-box;
      user-select: none;
      flex-shrink: 0;
      outline: none;
      transition: all 0.12s ease;
      background: rgba(255, 255, 255, 0.06);
      border: 1px solid rgba(255, 255, 255, 0.25);
      color: #ffffff;
      box-shadow: none !important;
    }
    .pi-enh-tag-filter-pill:hover {
      background: rgba(255, 255, 255, 0.12);
      border-color: rgba(255, 255, 255, 0.55);
      color: #ffffff;
    }
    /* 2. 「全部」标签选中状态：纯白细边、纯白字、微透提亮白底 */
    .pi-enh-tag-filter-pill[data-tag-filter-id="all"].is-active {
      background: rgba(255, 255, 255, 0.2) !important;
      border: 1px solid #ffffff !important;
      color: #ffffff !important;
      font-weight: 500 !important;
      box-shadow: none !important;
    }
    /* 3. 业务标签选中状态：字体颜色变化、边框变化、底色变化，完全等于会话卡片下面的胶囊样式！ */
    .pi-enh-tag-filter-pill:not([data-tag-filter-id="all"]).is-active {
      background: var(--filter-pill-bg) !important;
      border: 1px solid var(--filter-pill-border) !important;
      color: var(--filter-pill-color) !important;
      font-weight: 500 !important;
      box-shadow: none !important;
    }
    /* 色点：始终保持鲜艳的自身颜色 */
    .pi-enh-tag-filter-pill .pi-enh-tag-dot {
      width: 5.5px;
      height: 5.5px;
      border-radius: 50%;
      flex-shrink: 0;
    }

    /* 搜索结果关键词高亮 (Search Highlight) */
    mark.pi-enh-search-highlight {
      background: rgba(250, 204, 21, 0.32) !important;
      color: #fef08a !important;
      border-radius: 3px !important;
      padding: 0 3px !important;
      font-weight: 600 !important;
      font-size: inherit !important;
      display: inline !important;
      transform: none !important;
      box-shadow: none !important;
    }
    mark.pi-enh-search-highlight.is-focused-mark {
      background: #eab308 !important;
      color: #18181b !important;
      border-radius: 3px !important;
      padding: 0 3px !important;
      font-weight: 600 !important;
      font-size: inherit !important;
      display: inline !important;
      transform: none !important;
      box-shadow: none !important;
    }
    /* 搜索结果多片段高亮方向键定位导航器 (Snippet Navigator) */
    .pi-enh-search-snippet-nav {
      display: inline-flex;
      align-items: center;
      gap: 2px;
      margin-left: 6px;
      background: var(--bg-subtle, rgba(255, 255, 255, 0.08));
      border: 1px solid var(--border, #27272a);
      border-radius: 3px;
      padding: 0 4px;
      font-size: 10px;
      color: var(--text-muted, #a1a1aa);
      user-select: none;
      vertical-align: middle;
      line-height: 16px;
    }
    .pi-enh-snip-btn {
      background: none;
      border: none;
      color: var(--text-muted, #a1a1aa);
      cursor: pointer;
      padding: 0 2px;
      font-size: 8px;
      line-height: 1;
    }
    .pi-enh-snip-btn:hover {
      color: var(--accent, #38bdf8);
    }

    /* 标签 Popover 浮层 */
    .pi-enh-session-tags-popover {
      position: fixed;
      z-index: 100000;
      width: 230px;
      background: var(--bg, #18181b);
      border: 1px solid var(--border, #27272a);
      border-radius: 8px;
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.45), 0 8px 10px -6px rgba(0, 0, 0, 0.3);
      padding: 8px;
      box-sizing: border-box;
      font-size: 12px;
      color: var(--text, #f4f4f5);
      animation: piEnhFadeIn 0.12s ease-out;
      backdrop-filter: blur(16px);
      pointer-events: auto;
    }
    .pi-enh-menu-item.is-submenu-open {
      background: var(--bg-hover, rgba(125, 125, 125, 0.12));
      color: var(--text, #f4f4f5);
    }
    .pi-enh-menu-item.is-submenu-open .pi-enh-menu-arrow {
      opacity: 1 !important;
      color: var(--accent, #38bdf8);
      transform: translateX(2px);
      transition: transform 0.15s ease, opacity 0.15s ease, color 0.15s ease;
    }
    .pi-enh-tags-search-box {
      margin-bottom: 6px;
    }
    .pi-enh-tags-search-input {
      width: 100%;
      box-sizing: border-box;
      background: var(--bg-subtle, rgba(125, 125, 125, 0.08));
      border: 1px solid var(--border, #27272a);
      border-radius: 5px;
      padding: 5px 8px;
      font-size: 12px;
      color: var(--text, #f4f4f5);
      outline: none;
    }
    .pi-enh-tags-search-input:focus {
      border-color: var(--accent, #38bdf8);
    }
    .pi-enh-tags-list {
      max-height: 180px;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 2px;
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .pi-enh-tag-option {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 5px 6px;
      border-radius: 4px;
      cursor: pointer;
      user-select: none;
      transition: background 0.1s ease;
    }
    .pi-enh-tag-option:hover {
      background: var(--bg-hover, rgba(125, 125, 125, 0.1));
    }
    .pi-enh-tag-option .pi-enh-tag-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      flex-shrink: 0;
    }
    .pi-enh-tag-option .pi-enh-tag-name {
      flex: 1 1 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .pi-enh-tag-option .pi-enh-tag-check {
      width: 14px;
      font-size: 12px;
      font-weight: bold;
      color: var(--accent, #38bdf8);
      text-align: right;
      flex-shrink: 0;
    }
    .pi-enh-tag-create-option {
      color: var(--accent, #38bdf8);
      font-weight: 500;
      border-bottom: 1px dashed var(--border, #27272a);
      margin-bottom: 3px;
      padding-bottom: 6px;
    }
    .pi-enh-tag-empty {
      padding: 12px 6px;
      text-align: center;
      color: var(--text-muted, #71717a);
      font-size: 11px;
    }
    .pi-enh-tags-popover-footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-top: 1px solid var(--border, #27272a);
      margin-top: 6px;
      padding-top: 6px;
    }
    .pi-enh-tags-footer-btn {
      background: none;
      border: none;
      padding: 3px 6px;
      border-radius: 4px;
      font-size: 11px;
      color: var(--text-muted, #71717a);
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 3px;
    }
    .pi-enh-tags-footer-btn:hover {
      background: var(--bg-hover, rgba(125, 125, 125, 0.1));
      color: var(--text, #f4f4f5);
    }
    .pi-enh-tags-clear-btn:hover {
      color: #fb7185;
    }

    /* 设置面板 - 会话标签管理 */
    .settings-dialog-main.pi-enh-tags-panel {
      display: block;
      flex: 1 1 auto;
      width: 100%;
      max-width: 100%;
      min-height: 0;
      box-sizing: border-box;
      padding: 24px 28px 40px;
      overflow-x: hidden;
      overflow-y: auto;
      color: var(--text, #f4f4f5);
    }
    .settings-dialog-main.pi-enh-tags-panel[style*="display: none"],
    .settings-dialog-main.pi-enh-tags-panel[hidden] {
      display: none !important;
    }
    .pi-enh-tags-card {
      background: var(--bg-subtle, rgba(125, 125, 125, 0.05));
      border: 1px solid var(--border, #27272a);
      border-radius: 8px;
      padding: 18px 20px;
      margin-bottom: 20px;
      box-sizing: border-box;
      width: 100%;
    }
    .pi-enh-tag-color-palette-grid {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-wrap: wrap;
    }
    .pi-enh-tag-color-dot-choice {
      width: 22px;
      height: 22px;
      border-radius: 50%;
      border: 2px solid transparent;
      cursor: pointer;
      padding: 0;
      transition: transform 0.1s ease, border-color 0.1s ease;
    }
    .pi-enh-tag-color-dot-choice:hover {
      transform: scale(1.15);
    }
    .pi-enh-tag-color-dot-choice.is-active {
      border-color: var(--text, #ffffff);
      box-shadow: 0 0 0 2px var(--border, rgba(0, 0, 0, 0.5));
    }
    .pi-enh-tag-table-wrap {
      width: 100%;
      overflow-x: auto;
    }
    .pi-enh-tag-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }
    .pi-enh-tag-table th {
      text-align: left;
      padding: 10px 14px;
      color: var(--text-muted, #71717a);
      font-size: 11.5px;
      font-weight: 600;
      border-bottom: 1px solid var(--border, #27272a);
      white-space: nowrap !important;
    }
    .pi-enh-tag-table td {
      padding: 12px 14px;
      border-bottom: 1px solid var(--border, #27272a);
      vertical-align: middle;
      color: var(--text, #f4f4f5);
      white-space: nowrap !important;
    }
    .pi-enh-tag-table tr:hover td {
      background: var(--bg-hover, rgba(125, 125, 125, 0.05));
    }

    html.pi-enh-session-pin-archive-active .pi-enh-native-session-actions {
      display: none !important;
    }
    html:not(.pi-enh-session-pin-archive-active) .pi-enh-session-row-host:not(:hover):not(:focus-within) .pi-enh-native-session-actions {
      display: none !important;
    }
    .pi-enh-session-menu {
      min-width: 190px;
    }
    .pi-enh-menu-item.pi-enh-menu-item-danger {
      color: var(--danger, #f87171);
    }
    .pi-enh-menu-item.pi-enh-menu-item-danger:hover {
      color: var(--danger, #fca5a5);
      background: color-mix(in srgb, var(--danger, #ef4444) 12%, transparent);
    }
    .pi-enh-menu-item.pi-enh-menu-item-confirming,
    .pi-enh-menu-item.pi-enh-menu-item-confirming:hover {
      color: #fff;
      background: #ef4444;
      border-radius: 6px;
    }
    .pi-enh-session-row-host[data-pi-enh-pending-delete="true"] {
      opacity: 0.55 !important;
      pointer-events: none !important;
    }

    /* Archived Chats Panel & Responsive Polish */
    .pi-enh-archived-panel {
      box-sizing: border-box;
      display: block;
      height: 100%;
      min-height: 0;
      overflow-x: hidden;
      overflow-y: auto;
      overscroll-behavior: contain;
      scrollbar-gutter: stable;
      -webkit-overflow-scrolling: touch;
      padding: 20px 24px;
    }
    .pi-enh-archived-toolbar {
      position: static;
      background: transparent;
      padding-bottom: 12px;
      margin-bottom: 12px;
      border-bottom: 1px solid var(--border, #27272a);
    }
    .pi-enh-archived-header-row {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 16px;
      margin-bottom: 12px;
    }
    @media (min-width: 641px) {
      .pi-enh-archived-header-row { padding-right: 32px; }
    }
    .pi-enh-archived-item {
      display: flex;
      flex-direction: column;
      gap: 7px;
      padding: 10px 12px;
      border: 1px solid var(--border, #27272a);
      border-radius: 9px;
      background: color-mix(in srgb, var(--bg-selected, #27272a) 32%, transparent);
      box-sizing: border-box;
      max-width: 100%;
      min-width: 0;
      transition: background 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease;
    }
    .pi-enh-archived-item:hover {
      background: color-mix(in srgb, var(--bg-selected, #27272a) 55%, transparent);
      border-color: color-mix(in srgb, var(--border, #27272a) 85%, var(--accent, #3b82f6));
    }
    .pi-enh-archived-item.is-selected {
      border-color: var(--accent, #3b82f6);
      background: color-mix(in srgb, var(--accent, #3b82f6) 12%, color-mix(in srgb, var(--bg-selected, #27272a) 48%, transparent));
      box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent, #3b82f6) 35%, transparent);
    }
    .pi-enh-archived-item-main {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      min-width: 0;
      width: 100%;
    }
    .pi-enh-archived-checkbox-wrap {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      user-select: none;
      flex-shrink: 0;
      padding: 3px;
      margin: -1px 0 0 -1px;
      border-radius: 4px;
      transition: background 0.12s ease;
    }
    .pi-enh-archived-checkbox-wrap:hover {
      background: color-mix(in srgb, var(--accent, #3b82f6) 18%, transparent);
    }
    .pi-enh-archived-checkbox {
      width: 15px;
      height: 15px;
      cursor: pointer;
      accent-color: var(--accent, #3b82f6);
      border-radius: 3px;
      margin: 0;
      vertical-align: middle;
    }
    .pi-enh-archived-title-row {
      display: flex;
      align-items: flex-start;
      gap: 6px;
      flex: 1 1 auto;
      min-width: 0;
    }
    .pi-enh-archived-title-icon {
      flex-shrink: 0;
      margin-top: 2.5px;
      opacity: 0.65;
      color: var(--text-muted, #a1a1aa);
    }
    .pi-enh-archived-title {
      font-size: 13px;
      font-weight: 500;
      color: var(--text, #f4f4f5);
      line-height: 1.45;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
      text-overflow: ellipsis;
      word-break: break-word;
      overflow-wrap: anywhere;
      margin: 0;
      flex: 1 1 auto;
      cursor: pointer;
      transition: color 0.12s ease;
    }
    .pi-enh-archived-title:hover {
      color: var(--accent, #3b82f6);
    }
    .pi-enh-archived-title.is-expanded {
      display: block !important;
      -webkit-line-clamp: unset !important;
      overflow: visible !important;
      text-overflow: clip !important;
    }
    .pi-enh-archived-item-footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px 10px;
      flex-wrap: wrap;
      min-width: 0;
      padding-top: 3px;
      padding-left: 26px;
    }
    .pi-enh-archived-meta-row {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 4px 6px;
      min-width: 0;
      flex: 1 1 auto;
    }
    .pi-enh-archived-meta-tag {
      display: inline-flex;
      align-items: center;
      gap: 3.5px;
      font-size: 11px;
      color: var(--text-muted, #a1a1aa);
      background: color-mix(in srgb, var(--text-muted, #a1a1aa) 9%, transparent);
      border: 1px solid color-mix(in srgb, var(--border, #27272a) 65%, transparent);
      padding: 1.5px 6px;
      border-radius: 4px;
      line-height: 1.35;
      max-width: 170px;
      box-sizing: border-box;
    }
    .pi-enh-archived-tag-text {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .pi-enh-archived-meta-tag svg {
      flex-shrink: 0;
      opacity: 0.75;
    }
    .pi-enh-archived-actions {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      flex-shrink: 0;
      margin-left: auto;
    }
    .pi-enh-archived-restore-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 4px;
      padding: 4px 10px;
      font-size: 11.5px;
      font-weight: 500;
      border-radius: 6px;
      background: color-mix(in srgb, var(--accent, #3b82f6) 12%, transparent);
      border: 1px solid color-mix(in srgb, var(--accent, #3b82f6) 30%, transparent);
      color: var(--accent, #3b82f6);
      cursor: pointer;
      white-space: nowrap;
      flex-shrink: 0;
      min-height: 28px;
      transition: all 0.15s ease;
    }
    .pi-enh-archived-restore-btn:hover {
      background: color-mix(in srgb, var(--accent, #3b82f6) 22%, transparent);
      border-color: var(--accent, #3b82f6);
    }
    .pi-enh-archived-delete-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 4px;
      padding: 4px 10px;
      font-size: 11.5px;
      font-weight: 500;
      border-radius: 6px;
      background: var(--bg-hover, #27272a);
      border: 1px solid var(--border, #3f3f46);
      color: var(--text-muted, #a1a1aa);
      cursor: pointer;
      white-space: nowrap;
      flex-shrink: 0;
      min-height: 28px;
      transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease, box-shadow 0.15s ease;
    }
    .pi-enh-archived-delete-btn:hover:not(.pi-enh-archived-delete-confirming) {
      color: #ef4444 !important;
      border-color: rgba(239, 68, 68, 0.4) !important;
      background: rgba(239, 68, 68, 0.08) !important;
    }
    .pi-enh-archived-delete-btn.pi-enh-archived-delete-confirming {
      background: #dc2626 !important;
      border-color: #b91c1c !important;
      color: #ffffff !important;
      font-weight: 500 !important;
      box-shadow: 0 1px 3px rgba(220, 38, 38, 0.4) !important;
    }
    .pi-enh-archived-delete-btn.pi-enh-archived-delete-confirming svg {
      stroke: #ffffff !important;
    }
    .pi-enh-archived-delete-btn.pi-enh-archived-delete-confirming:hover {
      background: #ef4444 !important;
      border-color: #dc2626 !important;
      color: #ffffff !important;
    }
    .pi-enh-archived-batch-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 8px 12px;
      border-radius: 8px;
      background: color-mix(in srgb, var(--bg-selected, #27272a) 25%, transparent);
      border: 1px dashed color-mix(in srgb, var(--border, #27272a) 80%, transparent);
      margin-top: 8px;
      box-sizing: border-box;
    }
    .pi-enh-archived-date-panel {
      display: flex;
      flex-direction: column;
      gap: 10px;
      padding: 12px 14px;
      border-radius: 8px;
      background: color-mix(in srgb, var(--bg-selected, #27272a) 40%, transparent);
      border: 1px solid var(--border, #27272a);
      margin-top: 8px;
      box-sizing: border-box;
    }
    .pi-enh-archived-date-input {
      padding: 4px 8px;
      font-size: 12px;
      border-radius: 6px;
      border: 1px solid var(--border, #27272a);
      background: var(--bg, #18181b);
      color: var(--text, #f4f4f5);
      outline: none;
      font-family: inherit;
    }
    .pi-enh-archived-date-input:focus {
      border-color: var(--accent, #3b82f6);
    }

    /* 会话列表批量管理与删除 (Session Batch Actions) */
    .pi-enh-session-batch-trigger {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 32px;
      flex-shrink: 0;
      background: var(--bg-hover);
      border: 1px solid var(--border);
      border-radius: 7px;
      color: var(--text-muted);
      cursor: pointer;
      transition: background 0.12s ease, color 0.12s ease, border-color 0.12s ease;
    }
    .pi-enh-session-batch-trigger:hover {
      background: var(--bg-selected, #27272a);
      color: var(--text);
      border-color: var(--text-muted);
    }
    .pi-enh-session-batch-trigger.is-active {
      background: color-mix(in srgb, var(--accent, #3b82f6) 16%, transparent) !important;
      border-color: var(--accent, #3b82f6) !important;
      color: var(--accent, #3b82f6) !important;
    }

    .pi-enh-session-batch-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 7px 10px;
      background: color-mix(in srgb, var(--bg-selected, #27272a) 40%, transparent);
      border-bottom: 1px solid var(--border);
      flex-shrink: 0;
      user-select: none;
      animation: piEnhBatchBarSlide 0.12s ease-out;
    }
    @keyframes piEnhBatchBarSlide {
      from { opacity: 0; transform: translateY(-4px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .pi-enh-session-batch-select-all {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      cursor: pointer;
      font-size: 12px;
      font-weight: 500;
      color: var(--text);
      user-select: none;
    }
    .pi-enh-session-batch-select-all input[type="checkbox"] {
      width: 15px;
      height: 15px;
      cursor: pointer;
      accent-color: var(--accent, #3b82f6);
      border-radius: 3px;
      margin: 0;
    }

    .pi-enh-session-batch-actions {
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    .pi-enh-session-batch-btn {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 4px 8px;
      font-size: 11.5px;
      font-weight: 500;
      border-radius: 6px;
      border: 1px solid var(--border);
      background: var(--bg);
      color: var(--text);
      cursor: pointer;
      line-height: 1.2;
      transition: background 0.12s, border-color 0.12s, color 0.12s, opacity 0.12s;
    }
    .pi-enh-session-batch-btn:hover:not(:disabled) {
      background: var(--bg-hover);
      border-color: var(--text-muted);
    }
    .pi-enh-session-batch-btn:disabled {
      opacity: 0.45;
      cursor: not-allowed;
    }
    .pi-enh-session-batch-btn-danger {
      color: #ef4444;
      border-color: color-mix(in srgb, #ef4444 35%, var(--border));
    }
    .pi-enh-session-batch-btn-danger:hover:not(:disabled) {
      background: color-mix(in srgb, #ef4444 14%, transparent);
      border-color: #ef4444;
    }
    .pi-enh-session-batch-btn-exit {
      color: var(--text-muted);
    }
    .pi-enh-session-batch-btn-exit:hover {
      color: var(--text);
    }

    /* 列表项复选框容器 */
    .pi-enh-session-batch-checkbox-wrap {
      order: 0 !important;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 20px;
      height: 20px;
      flex-shrink: 0 !important;
      margin-right: 4px;
      cursor: pointer;
      user-select: none;
      z-index: 2;
    }
    .pi-enh-session-batch-checkbox {
      width: 15px;
      height: 15px;
      cursor: pointer;
      accent-color: var(--accent, #3b82f6);
      border-radius: 3px;
      margin: 0;
      vertical-align: middle;
    }

    /* 批量模式下的会话行样式 */
    .pi-enh-session-batch-active .pi-enh-session-row-host {
      cursor: pointer !important;
      user-select: none !important;
      transition: background 0.12s ease, border-color 0.12s ease;
    }
    .pi-enh-session-batch-active .pi-enh-session-row-host:hover {
      background: color-mix(in srgb, var(--accent, #3b82f6) 8%, var(--bg-hover, #27272a)) !important;
    }
    .pi-enh-session-batch-active .pi-enh-session-row-host.is-batch-selected {
      background: color-mix(in srgb, var(--accent, #3b82f6) 15%, var(--bg-hover, #27272a)) !important;
      border-left-color: var(--accent, #3b82f6) !important;
    }
    .pi-enh-session-batch-active .pi-enh-session-overflow,
    .pi-enh-session-batch-active .pi-enh-native-session-actions {
      display: none !important;
    }

    /* 批量删除确认模态框 */
    .pi-enh-batch-modal-backdrop {
      position: fixed;
      inset: 0;
      z-index: 100002;
      background: rgba(0, 0, 0, 0.65);
      backdrop-filter: blur(4px);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 16px;
      animation: piEnhFadeIn 0.15s ease-out;
    }
    .pi-enh-batch-modal {
      width: 100%;
      max-width: 440px;
      background: var(--bg, #18181b);
      border: 1px solid var(--border, #27272a);
      border-radius: 12px;
      box-shadow: 0 20px 40px rgba(0, 0, 0, 0.45);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      box-sizing: border-box;
    }
    .pi-enh-batch-modal-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 16px 18px 12px;
      font-size: 15px;
      font-weight: 600;
      color: var(--text);
      border-bottom: 1px solid var(--border);
    }
    .pi-enh-batch-modal-body {
      padding: 16px 18px;
      font-size: 13px;
      line-height: 1.5;
      color: var(--text);
    }
    .pi-enh-batch-modal-list {
      margin-top: 10px;
      max-height: 150px;
      overflow-y: auto;
      background: var(--bg-hover);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 6px 10px;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .pi-enh-batch-modal-item {
      font-size: 12px;
      color: var(--text-muted);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .pi-enh-batch-modal-footer {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 10px;
      padding: 12px 18px 16px;
      border-top: 1px solid var(--border);
    }

    /* Search Results Grouping for Archived Chats: React owns the first-row
       marker, so rapid query updates cannot accumulate duplicate dividers. */
    button[data-search-archived="true"] {
      opacity: 0.82;
      transition: opacity 0.12s ease, background 0.12s ease;
    }
    button[data-search-archived="true"]:hover {
      opacity: 1;
    }
    button[data-search-archived-first="true"] {
      margin-top: 8px;
      border-top: 1px solid var(--border, #27272a);
    }
    button[data-search-archived-first="true"]::before {
      content: attr(data-search-archive-divider);
      display: block;
      box-sizing: border-box;
      min-height: 20px;
      padding: 1px 0 7px 20px;
      margin-bottom: 7px;
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%2371717a' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M3 7h18'/%3E%3Cpath d='M5 7V4h14v3'/%3E%3Cpath d='M5 11h14v8H5z'/%3E%3C/svg%3E");
      background-repeat: no-repeat;
      background-position: left 2px top 2px;
      background-size: 14px 14px;
      color: var(--text-muted, #71717a);
      font-size: 11px;
      font-weight: 600;
      line-height: 1.25;
      user-select: none;
    }

    /* 会话搜索项目与归档折叠栏 (Search Group Folding) */
    .pi-enh-search-results-container button[data-search-archived-first="true"]::before {
      display: none !important;
    }
    .pi-enh-search-group-toggle {
      display: flex;
      align-items: center;
      gap: 7px;
      width: 100%;
      box-sizing: border-box;
      padding: 7px 12px;
      margin: 6px 0 2px;
      background: color-mix(in srgb, var(--bg-hover, #27272a) 65%, transparent);
      border-top: 1px solid var(--border, #27272a);
      border-bottom: 1px solid var(--border, #27272a);
      color: var(--text-muted, #a1a1aa);
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
      user-select: none;
      -webkit-user-select: none;
      transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
    }
    .pi-enh-search-group-toggle:hover {
      background: var(--bg-hover, #27272a);
      color: var(--text, #f4f4f5);
    }
    .pi-enh-search-group-toggle .pi-enh-search-group-arrow {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 10px;
      height: 10px;
      font-size: 8px;
      transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1);
      transform: rotate(0deg);
      flex-shrink: 0;
      color: var(--text-dim, #71717a);
    }
    .pi-enh-search-group-toggle.is-expanded .pi-enh-search-group-arrow {
      transform: rotate(90deg);
      color: var(--text, #f4f4f5);
    }
    .pi-enh-search-group-toggle .pi-enh-search-group-icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 14px;
      height: 14px;
      flex-shrink: 0;
      color: var(--text-muted, #a1a1aa);
    }
    .pi-enh-search-group-toggle .pi-enh-search-group-title {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      letter-spacing: 0.01em;
    }
    .pi-enh-search-group-toggle .pi-enh-search-group-count {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 1px 7px;
      border-radius: 9999px;
      background: var(--bg-selected, rgba(255, 255, 255, 0.08));
      border: 1px solid var(--border, #3f3f46);
      color: var(--text, #e4e4e7);
      font-family: var(--font-mono, monospace);
      font-size: 10px;
      font-weight: 500;
      line-height: 1.3;
      flex-shrink: 0;
    }
    .pi-enh-search-empty-current-hint {
      padding: 6px 12px 8px;
      font-size: 11px;
      color: var(--text-dim, #71717a);
      line-height: 1.4;
      border-bottom: 1px dashed var(--border, #27272a);
      margin-bottom: 4px;
    }

    /* 纯 CSS 折叠控制 */
    .pi-enh-search-results-container button[data-search-session-id].is-search-collapsed {
      display: none !important;
    }
    .pi-enh-search-archived-badge {
      display: inline-flex;
      align-items: center;
      gap: 3px;
      padding: 1px 6px;
      border-radius: 4px;
      border: 1px solid var(--border, #27272a);
      background: color-mix(in srgb, var(--bg-selected, #27272a) 60%, transparent);
      color: var(--text-muted, #a1a1aa);
      font-size: 10px;
      line-height: 1.3;
      margin-left: 6px;
      vertical-align: middle;
      flex-shrink: 0;
    }
    .pi-enh-search-restore-btn {
      margin-left: auto;
      display: none;
      align-items: center;
      gap: 3px;
      padding: 2px 7px;
      border-radius: 4px;
      border: 1px solid var(--border, #27272a);
      background: var(--bg-hover, rgba(255, 255, 255, 0.08));
      color: var(--text, #f4f4f5);
      font-size: 10.5px;
      cursor: pointer;
      flex-shrink: 0;
    }
    .pi-enh-search-archived-item:hover .pi-enh-search-restore-btn {
      display: inline-flex;
    }

    /* Include landscape phones, whose CSS viewport can exceed 768px. */
    @media (max-width: 1200px), (hover: none) and (pointer: coarse) {
      .pi-enh-archived-panel {
        padding: 12px 10px;
        overscroll-behavior: auto;
      }
      .pi-enh-archived-toolbar {
        padding-bottom: 8px;
        margin-bottom: 8px;
      }
      .pi-enh-archived-header-row {
        flex-direction: row;
        align-items: center !important;
        justify-content: space-between !important;
        gap: 8px !important;
        flex-wrap: wrap;
      }
      .pi-enh-archived-header-row button[data-action="restore-all-archived"] {
        align-self: center;
        padding: 4px 10px !important;
        font-size: 11.5px !important;
      }
      .pi-enh-archived-item {
        padding: 9px 10px;
        gap: 6px;
      }
      .pi-enh-archived-item-footer {
        padding-left: 0;
      }
      .pi-enh-archived-title {
        display: -webkit-box !important;
        -webkit-line-clamp: 2 !important;
        -webkit-box-orient: vertical !important;
        overflow: hidden !important;
        text-overflow: ellipsis !important;
        white-space: normal !important;
        overflow-wrap: anywhere;
        word-break: break-word;
        max-width: 100% !important;
      }
      .pi-enh-archived-title.is-expanded {
        display: block !important;
        -webkit-line-clamp: unset !important;
        overflow: visible !important;
      }
      .pi-enh-archived-meta-row {
        gap: 3px 5px;
      }
      .pi-enh-archived-meta-tag {
        font-size: 10.5px;
        padding: 1px 5px;
        max-width: 130px;
      }
      .pi-enh-archived-actions {
        margin-left: auto;
      }
      .pi-enh-archived-item button[data-action="restore-archived-session"],
      .pi-enh-archived-item button[data-action="delete-archived-session"] {
        padding: 4px 8px !important;
        font-size: 11px !important;
        min-height: 26px !important;
      }
      html.pi-enh-session-pin-archive-active .settings-section-tabs {
        max-width: 100%;
        padding-right: 0 !important;
        overflow-x: auto;
        scrollbar-width: none;
        -webkit-overflow-scrolling: touch;
      }
      html.pi-enh-session-pin-archive-active .settings-section-tabs::-webkit-scrollbar {
        display: none;
      }
      html.pi-enh-session-pin-archive-active .settings-section-tabs > * {
        flex: 0 0 auto;
      }
    }
    /* 侧边栏底部快捷入口与设置选项卡双击快捷 */
    [data-pi-enh-shortcuts-host="true"]:not([data-pi-enh-shortcuts-disabled="true"]) > button:not(.pi-enh-shortcut-btn),
    .sidebar-container > div:last-child:not([data-pi-enh-shortcuts-disabled="true"]) > button:not(.pi-enh-shortcut-btn) {
      display: none !important;
    }
    /* 快捷入口直达秒开守卫：直达目标面板时，瞬间屏蔽常规面板的第一帧绘制，彻底消除跳动 */
    html[data-pi-opening-tab="usage"] .settings-dialog-surface .settings-general,
    html[data-pi-opening-tab="enhancements"] .settings-dialog-surface .settings-general,
    html[data-pi-opening-tab="archived"] .settings-dialog-surface .settings-general,
    html[data-pi-opening-tab="notifications"] .settings-dialog-surface .settings-general,
    html[data-pi-opening-tab="tags"] .settings-dialog-surface .settings-general {
      display: none !important;
    }
    .pi-enh-shortcuts-bar {
      display: flex;
      align-items: center;
      gap: 2px;
      width: 100%;
      flex-wrap: nowrap;
    }
    .pi-enh-shortcut-btn {
      flex: 1 1 0;
      min-width: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 2px;
      height: 32px;
      padding: 0 1px;
      background: none;
      border: none;
      border-radius: 8px;
      color: var(--text-muted, #a1a1aa);
      cursor: pointer;
      font-size: 11px;
      letter-spacing: -0.02em;
      line-height: normal;
      white-space: nowrap;
      outline: none !important;
      transition: background 0.12s ease, color 0.12s ease, transform 0.08s ease;
      user-select: none;
      -webkit-user-select: none;
    }
    .pi-enh-shortcut-btn:focus,
    .pi-enh-shortcut-btn:focus-visible {
      outline: none !important;
      box-shadow: none !important;
    }
    .pi-enh-shortcut-btn:hover {
      background: var(--bg-hover, rgba(255, 255, 255, 0.08));
      color: var(--text, #f4f4f5);
    }
    .pi-enh-shortcut-btn:active {
      transform: scale(0.96);
    }
    .pi-enh-shortcut-btn svg {
      width: 13px;
      height: 13px;
      flex-shrink: 0;
    }
    .pi-enh-shortcut-btn span {
      display: inline-block;
      line-height: 1.4;
      padding-bottom: 2px;
      margin-bottom: -2px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 10.5px;
    }
    .settings-section-tab {
      position: relative;
    }
    .pi-enh-tab-pin-indicator {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 6px;
      height: 6px;
      margin-left: 4px;
      border-radius: 50%;
      background: var(--accent, #38bdf8);
      box-shadow: 0 0 6px var(--accent, #38bdf8);
      flex-shrink: 0;
      animation: pi-enh-pin-pop 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275);
    }
    @keyframes pi-enh-pin-pop {
      from { transform: scale(0); opacity: 0; }
      to { transform: scale(1); opacity: 1; }
    }

    /* ==========================================================================
       设置对话框左侧侧边栏导航与加宽布局 (Settings Dialog Sidebar Layout)
       ========================================================================== */
    @media (min-width: 641px) {
      html.pi-enh-settings-sidebar-active .settings-dialog-surface {
        display: flex !important;
        flex-direction: row !important;
        position: relative !important;
        width: var(--settings-dialog-width, 1220px) !important;
        max-width: calc(100vw - 32px) !important;
        height: var(--settings-dialog-height, 86vh) !important;
        max-height: calc(100dvh - 32px) !important;
        border-radius: 12px !important;
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.35) !important;
        box-sizing: border-box !important;
      }

      html.pi-enh-settings-sidebar-active .settings-dialog-surface.is-resizing,
      html.pi-enh-settings-sidebar-active .settings-dialog-surface.is-resizing *,
      html.pi-enh-settings-resizing,
      html.pi-enh-settings-resizing * {
        user-select: none !important;
        -webkit-user-select: none !important;
        transition: none !important;
      }

      html.pi-enh-settings-sidebar-active .settings-dialog-surface.is-resizing > .settings-dialog-header,
      html.pi-enh-settings-resizing .settings-dialog-surface > .settings-dialog-header {
        transition: none !important;
      }

      html.pi-enh-settings-sidebar-active .settings-dialog-surface > .settings-dialog-header {
        position: static !important;
        display: flex !important;
        flex-direction: column !important;
        align-items: stretch !important;
        justify-content: flex-start !important;
        flex-shrink: 0 !important;
        width: var(--settings-sidebar-width, 200px) !important;
        min-width: var(--settings-sidebar-width, 200px) !important;
        max-width: var(--settings-sidebar-width, 200px) !important;
        height: 100% !important;
        min-height: 100% !important;
        padding: 16px 8px 16px 10px !important;
        margin: 0 !important;
        border-bottom: none !important;
        border-right: 1px solid var(--border) !important;
        background: var(--bg-panel, rgba(255, 255, 255, 0.02)) !important;
        box-sizing: border-box !important;
        overflow: hidden !important;
        transition: width 0.22s cubic-bezier(0.4, 0, 0.2, 1), min-width 0.22s cubic-bezier(0.4, 0, 0.2, 1), max-width 0.22s cubic-bezier(0.4, 0, 0.2, 1), padding 0.22s ease !important;
      }

      /* 侧边栏折叠状态 (Collapsed Mini Sidebar) */
      html.pi-enh-settings-sidebar-active.pi-enh-settings-sidebar-collapsed .settings-dialog-surface > .settings-dialog-header {
        width: 58px !important;
        min-width: 58px !important;
        max-width: 58px !important;
        padding: 16px 6px 16px 6px !important;
      }

      /* 侧边栏与内容区分割手柄 (Splitter) */
      html.pi-enh-settings-sidebar-active .pi-enh-sidebar-resizer {
        position: absolute !important;
        top: 0 !important;
        left: calc(var(--settings-sidebar-width, 200px) - 7px) !important;
        width: 14px !important;
        height: 100% !important;
        cursor: col-resize !important;
        z-index: 35 !important;
        user-select: none !important;
        -webkit-user-select: none !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        touch-action: none !important;
      }
      html.pi-enh-settings-sidebar-active .pi-enh-sidebar-resizer-line {
        width: 2px !important;
        height: 100% !important;
        background: transparent !important;
        border-radius: 1px !important;
        pointer-events: none !important;
        transition: background-color 0.15s ease, box-shadow 0.15s ease !important;
      }
      html.pi-enh-settings-sidebar-active .pi-enh-sidebar-resizer:hover .pi-enh-sidebar-resizer-line,
      html.pi-enh-settings-sidebar-active .pi-enh-sidebar-resizer.is-dragging .pi-enh-sidebar-resizer-line {
        background: var(--accent, #6366f1) !important;
        box-shadow: 0 0 8px rgba(99, 102, 241, 0.6) !important;
      }

      /* 弹窗四周拖拽调整手柄 (Dialog Resizers) */
      html.pi-enh-settings-sidebar-active .pi-enh-dialog-resizer {
        position: absolute !important;
        z-index: 40 !important;
        user-select: none !important;
        touch-action: none !important;
      }
      html.pi-enh-settings-sidebar-active .pi-enh-dialog-resizer-east {
        top: 0 !important;
        right: -4px !important;
        width: 8px !important;
        height: 100% !important;
        cursor: ew-resize !important;
      }
      html.pi-enh-settings-sidebar-active .pi-enh-dialog-resizer-south {
        bottom: -4px !important;
        left: 0 !important;
        width: 100% !important;
        height: 8px !important;
        cursor: ns-resize !important;
      }
      html.pi-enh-settings-sidebar-active .pi-enh-dialog-resizer-se {
        bottom: 0 !important;
        right: 0 !important;
        width: 18px !important;
        height: 18px !important;
        cursor: nwse-resize !important;
        z-index: 45 !important;
        display: flex !important;
        align-items: flex-end !important;
        justify-content: flex-end !important;
        padding: 3px 4px !important;
        box-sizing: border-box !important;
        opacity: 0.35 !important;
        transition: opacity 0.15s ease !important;
      }
      html.pi-enh-settings-sidebar-active .pi-enh-dialog-resizer-se:hover,
      html.pi-enh-settings-sidebar-active .pi-enh-dialog-resizer-se.is-dragging {
        opacity: 0.9 !important;
      }
      html.pi-enh-settings-sidebar-active .pi-enh-dialog-resizer-grip {
        color: var(--text-muted, #a1a1aa) !important;
      }
      html.pi-enh-settings-sidebar-active .pi-enh-dialog-resizer-se:hover .pi-enh-dialog-resizer-grip {
        color: var(--accent, #6366f1) !important;
      }

      html.pi-enh-settings-sidebar-active .settings-dialog-title {
        display: flex !important;
        align-items: center !important;
        justify-content: space-between !important;
        height: 38px !important;
        min-height: 38px !important;
        padding: 0 4px 10px 8px !important;
        margin-bottom: 6px !important;
        font-size: 16px !important;
        font-weight: 700 !important;
        color: var(--text) !important;
        letter-spacing: -0.01em !important;
        border-bottom: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.06)) !important;
        box-sizing: border-box !important;
        position: relative !important;
      }

      /* 侧边栏折叠按钮 (Gemini / 主流侧边栏切换按钮风格) */
      .pi-enh-sidebar-collapse-btn {
        display: inline-flex !important;
        align-items: center !important;
        justify-content: center !important;
        width: 28px !important;
        height: 28px !important;
        min-width: 28px !important;
        min-height: 28px !important;
        padding: 0 !important;
        border: none !important;
        border-radius: 6px !important;
        background: transparent !important;
        color: var(--text-muted, #94a3b8) !important;
        cursor: pointer !important;
        transition: background-color 0.15s ease, color 0.15s ease, transform 0.1s ease !important;
        user-select: none !important;
        box-sizing: border-box !important;
        flex-shrink: 0 !important;
      }
      .pi-enh-sidebar-collapse-btn:hover {
        background: var(--bg-hover, rgba(255, 255, 255, 0.08)) !important;
        color: var(--text, #f8fafc) !important;
      }
      .pi-enh-sidebar-collapse-btn:active {
        transform: scale(0.92) !important;
      }

      /* 折叠态标题行与折叠按钮居中 */
      html.pi-enh-settings-sidebar-active.pi-enh-settings-sidebar-collapsed .settings-dialog-title {
        justify-content: center !important;
        padding: 0 0 10px 0 !important;
      }
      html.pi-enh-settings-sidebar-active.pi-enh-settings-sidebar-collapsed .settings-dialog-title .pi-enh-sidebar-title-text {
        display: none !important;
      }
      html.pi-enh-settings-sidebar-active.pi-enh-settings-sidebar-collapsed .pi-enh-sidebar-collapse-btn {
        margin: 0 auto !important;
      }

      /* 折叠态选项卡容器 */
      html.pi-enh-settings-sidebar-active.pi-enh-settings-sidebar-collapsed .settings-section-tabs {
        align-items: center !important;
        padding: 2px 0 8px 0 !important;
      }

      /* 折叠态单个选项卡 - 仅显示居中图标 */
      html.pi-enh-settings-sidebar-active.pi-enh-settings-sidebar-collapsed .settings-section-tab {
        width: 44px !important;
        min-width: 44px !important;
        height: 38px !important;
        min-height: 38px !important;
        padding: 0 !important;
        justify-content: center !important;
        border-radius: 8px !important;
        gap: 0 !important;
        margin: 0 auto 3px auto !important;
      }
      html.pi-enh-settings-sidebar-active.pi-enh-settings-sidebar-collapsed .settings-section-tab > span:not(.pi-enh-tab-pin-indicator) {
        display: none !important;
      }
      html.pi-enh-settings-sidebar-active.pi-enh-settings-sidebar-collapsed .settings-section-tab .settings-section-icon,
      html.pi-enh-settings-sidebar-active.pi-enh-settings-sidebar-collapsed .settings-section-tab svg:not(.pi-enh-tab-pin-indicator) {
        margin: 0 auto !important;
        width: 18px !important;
        height: 18px !important;
        display: block !important;
      }
      html.pi-enh-settings-sidebar-active.pi-enh-settings-sidebar-collapsed .settings-section-tab[aria-current=page] {
        background: var(--bg-selected, rgba(255, 255, 255, 0.08)) !important;
      }
      html.pi-enh-settings-sidebar-active.pi-enh-settings-sidebar-collapsed .settings-section-tab:after {
        left: 2px !important;
        top: 8px !important;
        bottom: 8px !important;
        width: 3px !important;
        border-radius: 2px !important;
      }
      html.pi-enh-settings-sidebar-active.pi-enh-settings-sidebar-collapsed .settings-section-tab .pi-enh-tab-pin-indicator {
        position: absolute !important;
        top: 6px !important;
        right: 6px !important;
        margin: 0 !important;
        width: 5px !important;
        height: 5px !important;
        box-shadow: 0 0 4px var(--accent, #38bdf8) !important;
      }

      /* 折叠态隐藏底部快捷入口提示与拖拽手柄 */
      html.pi-enh-settings-sidebar-active.pi-enh-settings-sidebar-collapsed .pi-enh-sidebar-shortcut-tip {
        display: none !important;
      }
      html.pi-enh-settings-sidebar-active.pi-enh-settings-sidebar-collapsed .pi-enh-sidebar-resizer {
        display: none !important;
        pointer-events: none !important;
      }

      html.pi-enh-settings-sidebar-active .settings-section-tabs {
        display: flex !important;
        flex-direction: column !important;
        align-items: stretch !important;
        gap: 3px !important;
        width: 100% !important;
        height: 100% !important;
        margin: 0 !important;
        padding: 2px 0 8px 0 !important;
        overflow-x: hidden !important;
        overflow-y: auto !important;
        scrollbar-width: thin !important;
      }

      /* 大屏/折叠屏展开 (>= 641px) 下严禁显示移动端下拉选择器 */
      .settings-mobile-section-picker,
      html.pi-enh-settings-sidebar-active .settings-mobile-section-picker {
        display: none !important;
      }

      /* 折叠屏展开态 (641px ~ 900px) 左侧竖向标签栏比例与提示框无孤字优化 */
      @media (max-width: 900px) {
        html.pi-enh-settings-sidebar-active:not(.pi-enh-settings-sidebar-collapsed) .settings-dialog-surface > .settings-dialog-header {
          width: var(--settings-sidebar-width, 190px) !important;
          min-width: var(--settings-sidebar-width, 190px) !important;
          max-width: var(--settings-sidebar-width, 190px) !important;
        }
        html.pi-enh-settings-sidebar-active:not(.pi-enh-settings-sidebar-collapsed) .pi-enh-sidebar-resizer {
          left: calc(var(--settings-sidebar-width, 190px) - 7px) !important;
        }
        html.pi-enh-settings-sidebar-active .pi-enh-sidebar-shortcut-tip {
          padding: 7px 7px !important;
          gap: 4px !important;
        }
        html.pi-enh-settings-sidebar-active .pi-enh-sidebar-tip-main {
          gap: 5px !important;
        }
        html.pi-enh-settings-sidebar-active .pi-enh-sidebar-tip-title {
          font-size: 11px !important;
          white-space: nowrap !important;
        }
        html.pi-enh-settings-sidebar-active .pi-enh-sidebar-tip-sub {
          font-size: 10px !important;
          white-space: nowrap !important;
        }
      }

      html.pi-enh-settings-sidebar-active .settings-section-tabs::-webkit-scrollbar {
        width: 4px !important;
      }

      html.pi-enh-settings-sidebar-active .settings-section-tabs::-webkit-scrollbar-thumb {
        background: var(--border) !important;
        border-radius: 4px !important;
      }

      html.pi-enh-settings-sidebar-active .settings-section-tab {
        position: relative !important;
        display: flex !important;
        flex: 0 0 auto !important;
        align-items: center !important;
        justify-content: flex-start !important;
        gap: 9px !important;
        width: 100% !important;
        height: 36px !important;
        min-height: 36px !important;
        padding: 0 10px !important;
        border: none !important;
        border-radius: 6px !important;
        background: transparent !important;
        color: var(--text-muted) !important;
        cursor: pointer !important;
        font-size: 13px !important;
        font-weight: 400 !important;
        text-align: left !important;
        white-space: nowrap !important;
        transition: all 0.15s ease !important;
        user-select: none !important;
        box-sizing: border-box !important;
      }

      html.pi-enh-settings-sidebar-active .settings-section-tab:not(:disabled):hover {
        background: var(--bg-hover) !important;
        color: var(--text) !important;
      }

      html.pi-enh-settings-sidebar-active .settings-section-tab[aria-current=page] {
        background: var(--bg-selected, rgba(255, 255, 255, 0.08)) !important;
        color: var(--accent, #6366f1) !important;
        font-weight: 600 !important;
      }

      html.pi-enh-settings-sidebar-active .settings-section-tab:after {
        position: absolute !important;
        bottom: 7px !important;
        top: 7px !important;
        left: 0 !important;
        width: 3px !important;
        height: auto !important;
        border-radius: 0 2px 2px 0 !important;
        background: var(--accent, #6366f1) !important;
        content: "" !important;
        opacity: 0 !important;
        transform: scaleY(0.4) !important;
        transition: opacity 0.15s ease, transform 0.15s ease !important;
      }

      html.pi-enh-settings-sidebar-active .settings-section-tab[aria-current=page]:after {
        opacity: 1 !important;
        transform: scaleY(1) !important;
      }

      html.pi-enh-settings-sidebar-active .settings-section-tab .settings-section-icon {
        flex-shrink: 0 !important;
        width: 16px !important;
        height: 16px !important;
        opacity: 0.85 !important;
      }

      html.pi-enh-settings-sidebar-active .settings-section-tab[aria-current=page] .settings-section-icon {
        opacity: 1 !important;
        color: var(--accent, #6366f1) !important;
      }

      html.pi-enh-settings-sidebar-active .settings-section-tab > span:not(.pi-enh-tab-pin-indicator) {
        flex: 1 !important;
        line-height: 1.4 !important;
        padding-bottom: 2px !important;
        margin-bottom: -2px !important;
        overflow: hidden !important;
        text-overflow: ellipsis !important;
        white-space: nowrap !important;
      }

      html.pi-enh-settings-sidebar-active .settings-section-tab .pi-enh-tab-pin-indicator {
        flex: 0 0 auto !important;
        width: 6px !important;
        height: 6px !important;
        margin-left: auto !important;
        display: inline-flex !important;
        align-items: center !important;
        justify-content: center !important;
      }

      html.pi-enh-settings-sidebar-active .settings-dialog-close {
        position: absolute !important;
        top: 10px !important;
        right: 14px !important;
        z-index: 50 !important;
        width: 32px !important;
        height: 32px !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        border-radius: 6px !important;
        background: transparent !important;
        color: var(--text-muted) !important;
        border: none !important;
        cursor: pointer !important;
        transition: background-color 0.15s ease, color 0.15s ease !important;
      }

      html.pi-enh-settings-sidebar-active .settings-dialog-close:hover {
        background: var(--bg-hover) !important;
        color: var(--text) !important;
      }

      html.pi-enh-settings-sidebar-active .settings-dialog-surface > main.settings-dialog-main {
        flex: 1 1 auto !important;
        width: auto !important;
        min-width: 0 !important;
        min-height: 0 !important;
        height: 100% !important;
        max-height: 100% !important;
        overflow-y: auto !important;
      }

      html.pi-enh-settings-sidebar-active .agents-feature-actions,
      html.pi-enh-settings-sidebar-active .config-detail-actions,
      html.pi-enh-settings-sidebar-active .enabled-models-banner,
      html.pi-enh-settings-sidebar-active .config-panel-header,
      html.pi-enh-settings-sidebar-active .pi-enh-plugins-toolbar,
      html.pi-enh-settings-sidebar-active .pi-enh-archived-header-actions,
      html.pi-enh-settings-sidebar-active .pi-enh-tags-header-actions,
      html.pi-enh-settings-sidebar-active .pi-enh-notifications-header-actions,
      html.pi-enh-settings-sidebar-active .pi-enh-usage-title-row {
        padding-right: 52px !important;
        box-sizing: border-box !important;
      }

      html.pi-enh-settings-sidebar-active .enabled-models-banner-text {
        min-width: 0 !important;
        flex: 1 1 auto !important;
        overflow: hidden !important;
      }

      /* 侧边栏底部快捷入口双击提示 */
      html.pi-enh-settings-sidebar-active .pi-enh-sidebar-shortcut-tip {
        margin-top: auto !important;
        margin-bottom: 2px !important;
        padding: 8px 9px !important;
        border-radius: 8px !important;
        background: rgba(255, 255, 255, 0.04) !important;
        border: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.08)) !important;
        display: flex !important;
        align-items: flex-start !important;
        justify-content: space-between !important;
        gap: 6px !important;
        flex-shrink: 0 !important;
        box-sizing: border-box !important;
        transition: opacity 0.2s ease, transform 0.2s ease !important;
        animation: pi-enh-tip-fadein 0.25s ease !important;
      }
      @keyframes pi-enh-tip-fadein {
        from { opacity: 0; transform: translateY(6px); }
        to { opacity: 1; transform: translateY(0); }
      }
      html.pi-enh-settings-sidebar-active .pi-enh-sidebar-tip-main {
        display: flex !important;
        align-items: flex-start !important;
        gap: 7px !important;
        min-width: 0 !important;
        flex: 1 !important;
      }
      html.pi-enh-settings-sidebar-active .pi-enh-sidebar-tip-icon {
        flex-shrink: 0 !important;
        margin-top: 1.5px !important;
        color: #f59e0b !important;
      }
      html.pi-enh-settings-sidebar-active .pi-enh-sidebar-tip-text {
        display: flex !important;
        flex-direction: column !important;
        gap: 2px !important;
        min-width: 0 !important;
        flex: 1 !important;
      }
      html.pi-enh-settings-sidebar-active .pi-enh-sidebar-tip-title {
        font-size: 11.5px !important;
        font-weight: 600 !important;
        color: var(--text, #f4f4f5) !important;
        line-height: 1.35 !important;
        letter-spacing: -0.01em !important;
      }
      html.pi-enh-settings-sidebar-active .pi-enh-sidebar-tip-sub {
        font-size: 10.5px !important;
        color: var(--text-dim, #71717a) !important;
        line-height: 1.35 !important;
      }
      html.pi-enh-settings-sidebar-active .pi-enh-sidebar-tip-close {
        border: none !important;
        background: transparent !important;
        color: var(--text-dim, #71717a) !important;
        cursor: pointer !important;
        font-size: 14px !important;
        line-height: 1 !important;
        padding: 0 2px !important;
        border-radius: 4px !important;
        transition: all 0.12s ease !important;
        flex-shrink: 0 !important;
      }
      html.pi-enh-settings-sidebar-active .pi-enh-sidebar-tip-close:hover {
        color: var(--text, #f4f4f5) !important;
        background: var(--bg-hover, rgba(255, 255, 255, 0.08)) !important;
      }
    }

    /* 非侧边栏模式或直屏手机下彻底隐藏侧边栏专属辅助节点 (防跨形态切换残留) */
    html:not(.pi-enh-settings-sidebar-active) .pi-enh-sidebar-shortcut-tip,
    html:not(.pi-enh-settings-sidebar-active) .pi-enh-sidebar-resizer,
    html:not(.pi-enh-settings-sidebar-active) .pi-enh-dialog-resizer {
      display: none !important;
      pointer-events: none !important;
    }

    /* ==========================================================================
       直屏手机 (<= 640px) 设置弹窗精致现代 UI 优化 (Mobile Portrait Settings Header Polish)
       严格限定 max-width: 640px，绝不侵入折叠屏展开态 (>= 641px) 的左侧竖向标签栏
       ========================================================================== */
    @media (max-width: 640px) {
      /* 0. 直屏手机弹窗容器保持上下布局，隐藏竖向标签页列表与侧边栏专属控件 */
      html.pi-enh-settings-sidebar-active .settings-dialog-surface,
      .settings-dialog-surface {
        display: flex !important;
        flex-direction: column !important;
      }
      .settings-section-tabs,
      html.pi-enh-settings-sidebar-active .settings-section-tabs,
      .pi-enh-sidebar-shortcut-tip,
      .pi-enh-sidebar-resizer,
      .pi-enh-dialog-resizer {
        display: none !important;
        pointer-events: none !important;
      }

      /* 1. 物理级严厉隐藏折叠按钮 (直屏手机无需且严禁展示侧边栏折叠按钮) */
      .pi-enh-sidebar-collapse-btn,
      .settings-dialog-header .pi-enh-sidebar-collapse-btn,
      html.pi-enh-settings-sidebar-active .pi-enh-sidebar-collapse-btn,
      html.pi-enh-settings-sidebar-collapsed .pi-enh-sidebar-collapse-btn {
        display: none !important;
        pointer-events: none !important;
      }

      /* 2. 移动端设置弹窗头部栏整体美化与对齐 */
      .settings-dialog-header,
      html.pi-enh-settings-sidebar-active .settings-dialog-surface > .settings-dialog-header {
        position: relative !important;
        display: flex !important;
        flex-direction: row !important;
        align-items: center !important;
        justify-content: space-between !important;
        width: 100% !important;
        max-width: 100% !important;
        min-width: 0 !important;
        height: 52px !important;
        min-height: 52px !important;
        max-height: 52px !important;
        padding: 0 14px 0 16px !important;
        margin: 0 !important;
        border-right: none !important;
        border-bottom: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.08)) !important;
        background: var(--bg-panel, rgba(24, 24, 27, 0.94)) !important;
        backdrop-filter: blur(16px) !important;
        -webkit-backdrop-filter: blur(16px) !important;
        box-sizing: border-box !important;
        gap: 10px !important;
        overflow: visible !important;
      }

      /* 3. 移动端“设置”主标题 */
      .settings-dialog-title,
      html.pi-enh-settings-sidebar-active .settings-dialog-title {
        display: inline-flex !important;
        align-items: center !important;
        font-size: 15px !important;
        font-weight: 700 !important;
        letter-spacing: -0.01em !important;
        color: var(--text, #f8fafc) !important;
        height: auto !important;
        min-height: auto !important;
        padding: 0 !important;
        margin: 0 !important;
        border: none !important;
        flex-shrink: 0 !important;
      }

      /* 4. 分类选择下拉胶囊 Modern Capsule Picker 美化 (告别原生生硬灰框) */
      .settings-mobile-section-picker {
        display: block !important;
        flex: 1 1 auto !important;
        max-width: 220px !important;
        min-width: 0 !important;
        height: 32px !important;
        line-height: 30px !important;
        margin: 0 4px 0 0 !important;
        padding: 0 28px 0 12px !important;
        border: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.14)) !important;
        border-radius: 999px !important;
        background-color: var(--bg-selected, rgba(255, 255, 255, 0.06)) !important;
        background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2.4' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E") !important;
        background-repeat: no-repeat !important;
        background-position: right 10px center !important;
        background-size: 12px 12px !important;
        color: var(--text, #f8fafc) !important;
        font-family: inherit !important;
        font-size: 13.5px !important;
        font-weight: 550 !important;
        outline: none !important;
        cursor: pointer !important;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2) !important;
        transition: border-color 0.15s ease, background-color 0.15s ease, box-shadow 0.15s ease !important;
        -webkit-appearance: none !important;
        appearance: none !important;
        text-overflow: ellipsis !important;
        white-space: nowrap !important;
      }
      .settings-mobile-section-picker:hover {
        background-color: var(--bg-hover, rgba(255, 255, 255, 0.10)) !important;
        border-color: rgba(255, 255, 255, 0.22) !important;
      }
      .settings-mobile-section-picker:focus-visible {
        border-color: var(--accent, #6366f1) !important;
        box-shadow: 0 0 0 2px var(--accent-subtle, rgba(99, 102, 241, 0.28)) !important;
      }

      /* 5. 关闭按钮精致对齐 */
      .settings-dialog-close,
      html.pi-enh-settings-sidebar-active .settings-dialog-close {
        position: relative !important;
        top: auto !important;
        right: auto !important;
        display: inline-flex !important;
        align-items: center !important;
        justify-content: center !important;
        width: 30px !important;
        height: 30px !important;
        min-width: 30px !important;
        min-height: 30px !important;
        border-radius: 8px !important;
        border: none !important;
        background: transparent !important;
        color: var(--text-muted, #94a3b8) !important;
        margin: 0 0 0 auto !important;
        padding: 0 !important;
        cursor: pointer !important;
        flex-shrink: 0 !important;
        transition: background-color 0.15s ease, color 0.15s ease !important;
      }
      .settings-dialog-close:hover {
        background: var(--bg-hover, rgba(255, 255, 255, 0.10)) !important;
        color: var(--text, #f8fafc) !important;
      }

      /* 6. 直屏手机下隐藏与顶部选择器重复的内容区一级面板大标题 (如“常规”)，消除拥挤与重复感 */
      .settings-general-title {
        display: none !important;
      }
      .settings-general {
        padding: 12px 14px 28px !important;
      }
      .settings-general-section:first-of-type {
        margin-top: 4px !important;
      }
    }

    /* Codex-style selected-text annotations */
    .pi-enh-annotation-rail {
      width: 100%;
      max-width: var(--chat-content-max-width, 820px);
      margin: 0 auto;
      box-sizing: border-box;
      display: flex;
    }
    .pi-enh-annotation-badge {
      position: relative; display: inline-flex; align-items: stretch; width: fit-content !important; max-width: fit-content !important; flex: 0 0 auto !important; align-self: flex-start !important; overflow: hidden;
      margin: 0 0 8px; padding: 0; border: 1px solid var(--border, #52525b); border-radius: 9px;
      background: color-mix(in srgb, var(--bg-selected, #27272a) 82%, transparent); color: var(--text, #f4f4f5);
      font: inherit; font-size: 13px; font-weight: 650;
    }
    .pi-enh-annotation-badge:hover, .pi-enh-annotation-badge:focus-within { border-color: var(--accent, #38bdf8); color: var(--accent, #38bdf8); }
    .pi-enh-annotation-badge-summary, .pi-enh-annotation-badge-remove { border: 0; background: transparent; color: inherit; font: inherit; cursor: pointer; }
    .pi-enh-annotation-badge-summary { display: inline-flex; align-items: center; gap: 7px; padding: 7px 10px; }
    .pi-enh-annotation-badge-summary::before { display: none !important; content: none !important; }
    .pi-enh-annotation-checkbox {
      appearance: none; -webkit-appearance: none; box-sizing: border-box; width: 14px; height: 14px; margin: 0; padding: 0;
      border: 1.5px solid currentColor; border-radius: 3.5px; background: transparent; cursor: pointer;
      position: relative; display: inline-grid; place-content: center; flex-shrink: 0; transition: all 0.12s ease; opacity: 0.85;
    }
    .pi-enh-annotation-checkbox:hover { opacity: 1; border-color: var(--accent, #38bdf8); }
    .pi-enh-annotation-checkbox:checked { opacity: 1; background: var(--accent, #38bdf8); border-color: var(--accent, #38bdf8); }
    .pi-enh-annotation-checkbox:checked::after {
      content: ""; width: 8px; height: 4px; border-left: 1.8px solid #ffffff; border-bottom: 1.8px solid #ffffff;
      transform: rotate(-45deg) translate(0.5px, -0.5px); display: block;
    }
    .pi-enh-annotation-checkbox:focus-visible { outline: 2px solid var(--accent, #38bdf8); outline-offset: 1px; }
    .pi-enh-annotation-badge-summary:focus-visible, .pi-enh-annotation-badge-remove:focus-visible { outline: 2px solid var(--accent, #38bdf8); outline-offset: -2px; }
    .pi-enh-annotation-badge-remove { display: grid; place-items: center; width: 34px; padding: 0; border-left: 1px solid color-mix(in srgb, currentColor 25%, transparent); font-size: 19px; line-height: 1; }
    .pi-enh-annotation-badge-remove:hover { background: rgba(248, 113, 113, .14); color: #fca5a5; }
    ::highlight(pi-enh-annotation-selection) { background: #0f5f9f; color: #fff; }
    .pi-enh-annotation-marker {
      position: fixed; z-index: 85; display: grid; place-items: center; width: 22px; height: 22px; padding: 0;
      border: 1.5px solid #fff; border-radius: 50%; background: #1683f3; color: #fff; box-shadow: 0 1px 4px rgba(0, 76, 180, .45);
      font: 700 10px/1 var(--font-sans, system-ui, sans-serif); cursor: pointer;
    }
    .pi-enh-annotation-editor, .pi-enh-annotation-list {
      position: fixed; z-index: 90; box-sizing: border-box; max-height: min(460px, calc(100vh - 24px));
      color: var(--text, #f4f4f5); backdrop-filter: blur(16px); animation: piEnhFadeIn 0.14s ease-out;
    }
    .pi-enh-annotation-editor {
      overflow: hidden; padding: 12px 14px 10px; border: 1px solid var(--border, rgba(255, 255, 255, 0.16)); border-radius: 16px;
      background: color-mix(in srgb, var(--bg-panel, #202023) 96%, #2d2d30);
      box-shadow: 0 16px 40px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.06);
      display: flex; flex-direction: column; min-height: 0;
      transition: border-color 0.18s ease, box-shadow 0.18s ease;
    }
    .pi-enh-annotation-editor:focus-within {
      border-color: var(--accent, #38bdf8);
      box-shadow: 0 0 0 1px var(--accent, #38bdf8), 0 18px 48px rgba(0, 0, 0, 0.55);
    }
    .pi-enh-annotation-list {
      overflow: auto; padding: 14px; border: 1px solid color-mix(in srgb, var(--text, #f4f4f5) 14%, var(--border, #3f3f46)); border-radius: 18px;
      background: color-mix(in srgb, var(--bg-panel, #292929) 96%, #3a3a3a);
      box-shadow: 0 20px 52px rgba(0, 0, 0, .5), inset 0 1px rgba(255, 255, 255, .035);
    }
    .pi-enh-annotation-quote-preview {
      display: none !important; visibility: hidden !important; height: 0 !important; margin: 0 !important; padding: 0 !important; border: none !important; overflow: hidden !important;
    }
    .pi-enh-annotation-comment {
      box-sizing: border-box; flex: 1 1 auto; width: 100%; min-height: 52px; max-height: 240px; resize: none; overflow-y: auto; padding: 2px 4px 6px;
      border: 0 !important; border-radius: 0; background: transparent !important; color: var(--text, #f4f4f5);
      font: inherit; font-size: 14.5px; line-height: 1.5; outline: none !important; box-shadow: none !important;
    }
    .pi-enh-annotation-comment:focus { border-color: transparent !important; }
    .pi-enh-annotation-comment::placeholder { color: color-mix(in srgb, var(--text-muted, #71717a) 82%, transparent); }
    .pi-enh-annotation-editor-actions, .pi-enh-annotation-list-header { display: flex; align-items: center; gap: 8px; margin-top: 6px; }
    .pi-enh-annotation-editor-actions button, .pi-enh-annotation-list-header button {
      min-height: 34px; border: 1px solid var(--border, #52525b); border-radius: 999px; background: transparent;
      color: var(--text, #f4f4f5); padding: 6px 13px; font: inherit; font-size: 13px; cursor: pointer;
    }
    .pi-enh-annotation-icon-button { display: grid; place-items: center; width: 34px; padding: 0 !important; border-color: transparent !important; }
    .pi-enh-annotation-icon-button svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 1.9; stroke-linecap: round; stroke-linejoin: round; }
    .pi-enh-annotation-editor-index {
      display: inline-flex; align-items: center; color: var(--text-muted, #a1a1aa); font: inherit;
      font-size: 12px; font-weight: 500; user-select: none; line-height: 1; opacity: 0.85; padding: 0 4px;
    }
    .pi-enh-annotation-mic { margin-left: auto; }
    .pi-enh-annotation-mic.is-listening { color: #f87171; background: rgba(248, 113, 113, .12); }
    .pi-enh-annotation-save { border-color: #f4f4f5 !important; background: #f4f4f5 !important; color: #18181b !important; font-weight: 700 !important; }
    .pi-enh-annotation-delete:hover, .pi-enh-annotation-list-delete:hover { color: #fca5a5 !important; }
    .pi-enh-annotation-cancel:hover { background: rgba(255, 255, 255, .06); }
    .pi-enh-annotation-list { width: min(390px, calc(100vw - 24px)); padding: 12px; border-radius: 14px; }
    .pi-enh-annotation-list-header { justify-content: space-between; margin-top: 0; padding: 2px 4px 9px; border-bottom: 1px solid var(--border, #3f3f46); }
    .pi-enh-annotation-list-item { display: grid; grid-template-columns: minmax(0, 1fr) 32px; gap: 7px; align-items: start; margin-top: 8px; padding: 8px; border: 1px solid var(--border, #3f3f46); border-radius: 10px; }
    .pi-enh-annotation-list-item:hover { border-color: var(--accent, #38bdf8); background: color-mix(in srgb, var(--accent, #38bdf8) 8%, transparent); }
    .pi-enh-annotation-list-edit { display: grid; min-width: 0; gap: 4px; padding: 0; border: 0; background: transparent; color: var(--text, #f4f4f5); text-align: left; cursor: pointer; }
    .pi-enh-annotation-list-quote { overflow-wrap: anywhere; font-size: 12px; font-weight: 650; line-height: 1.45; }
    .pi-enh-annotation-list-meta { overflow-wrap: anywhere; color: var(--text-muted, #a1a1aa); font-size: 11px; line-height: 1.45; }
    .pi-enh-annotation-list-delete { display: grid; place-items: center; width: 32px; height: 32px; padding: 0; border: 0; border-radius: 8px; background: transparent; color: var(--text-muted, #a1a1aa); cursor: pointer; }
    .pi-enh-annotation-list-delete:hover { background: rgba(248, 113, 113, .12); }
    .pi-enh-annotation-list-delete svg { width: 17px; height: 17px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
    button[data-pi-enh-annotation-enabled="true"],
    button[data-pi-enh-empty-send-continue="true"] {
      background: var(--accent, #3b82f6) !important;
      color: var(--accent-contrast, #fff) !important;
      cursor: pointer !important;
      opacity: 1 !important;
      pointer-events: auto !important;
      box-shadow: 0 1px 3px color-mix(in srgb, var(--accent, #3b82f6) 25%, transparent) !important;
    }
    button[data-pi-enh-annotation-enabled="true"]:hover,
    button[data-pi-enh-empty-send-continue="true"]:hover {
      background: color-mix(in srgb, var(--accent, #3b82f6) 88%, #fff) !important;
    }
    button[data-pi-enh-annotation-enabled="true"] svg,
    button[data-pi-enh-empty-send-continue="true"] svg {
      color: var(--accent-contrast, #fff) !important;
      fill: currentColor !important;
    }
    @media (max-width: 680px) {
      .pi-enh-annotation-editor, .pi-enh-annotation-list { max-height: min(400px, calc(100vh - 24px)); padding: 12px; }
      .pi-enh-annotation-marker { width: 20px; height: 20px; font-size: 9.5px; }
    }
    body:has(.settings-dialog-backdrop, .config-panel-root.is-modal) .pi-enh-annotation-marker,
    body:has(.settings-dialog-backdrop, .config-panel-root.is-modal) .pi-enh-annotation-editor,
    body:has(.settings-dialog-backdrop, .config-panel-root.is-modal) .pi-enh-annotation-list,
    body:has(.settings-dialog-backdrop, .config-panel-root.is-modal) .pi-enh-quote-bar {
      display: none !important;
    }

    /* Refined High-Contrast Quick Action Quote Toolbar */
    .pi-enh-quote-bar {
      position: fixed;
      z-index: 95;
      display: inline-flex;
      align-items: center;
      background: linear-gradient(180deg, #2d2d32 0%, #222226 100%);
      color: #f4f4f5;
      border: 1px solid rgba(255, 255, 255, 0.28);
      border-radius: 8px;
      box-shadow: 0 10px 32px rgba(0, 0, 0, 0.65), 0 0 0 1px rgba(255, 255, 255, 0.1), 0 3px 8px rgba(0, 0, 0, 0.4);
      user-select: none;
      backdrop-filter: blur(16px);
      padding: 3px 4px;
      gap: 3px;
      animation: piEnhFadeIn 0.12s cubic-bezier(0.16, 1, 0.3, 1);
      touch-action: manipulation;
    }
    .pi-enh-quote-btn {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      background: rgba(59, 130, 246, 0.22);
      color: #60a5fa;
      border: 1px solid rgba(96, 165, 250, 0.4);
      border-radius: 6px;
      padding: 4px 9px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.12s ease;
      touch-action: manipulation;
    }
    .pi-enh-quote-btn:hover {
      background: #2563eb;
      color: #ffffff;
      border-color: #2563eb;
      box-shadow: 0 2px 8px rgba(37, 99, 235, 0.4);
    }
    .pi-enh-quote-action-btn {
      display: inline-flex;
      align-items: center;
      background: none;
      color: #f4f4f5;
      border: none;
      border-radius: 6px;
      padding: 4px 8px;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.12s ease;
      touch-action: manipulation;
    }
    .pi-enh-quote-action-btn:hover {
      background: rgba(255, 255, 255, 0.16);
      color: #ffffff;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
    }
    .pi-enh-quote-copy-btn {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      background: rgba(16, 185, 129, 0.18);
      color: #34d399;
      border: 1px solid rgba(52, 211, 153, 0.35);
      border-radius: 6px;
      padding: 4px 8px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.12s ease;
      touch-action: manipulation;
    }
    .pi-enh-quote-copy-btn:hover {
      background: #059669;
      color: #ffffff;
      border-color: #059669;
      box-shadow: 0 2px 8px rgba(16, 185, 129, 0.4);
    }
    .pi-enh-quote-divider {
      width: 1px;
      height: 16px;
      background: rgba(255, 255, 255, 0.22);
      margin: 0 2px;
    }

    /* Light Mode Adaptation */
    html:not(.dark) .pi-enh-quote-bar {
      background: #ffffff;
      color: #18181b;
      border: 1px solid #d4d4d8;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.15), 0 1px 4px rgba(0, 0, 0, 0.08);
    }
    html:not(.dark) .pi-enh-quote-copy-btn {
      background: rgba(16, 185, 129, 0.12);
      color: #059669;
      border: 1px solid rgba(16, 185, 129, 0.4);
    }
    html:not(.dark) .pi-enh-quote-action-btn {
      color: #27272a;
    }
    html:not(.dark) .pi-enh-quote-action-btn:hover {
      background: #f4f4f5;
      color: #000000;
    }
    html:not(.dark) .pi-enh-quote-divider {
      background: #e4e4e7;
    }

    /* Suppress Native Mobile Context Menu Callout in Chat Area */
    .chat-window, .message-view, main, [data-message-role], .prose, .markdown-body {
      -webkit-touch-callout: none;
    }
    textarea, input, [contenteditable="true"] {
      -webkit-touch-callout: default;
    }

    /* 严格保证：侧边栏关闭时遮罩层绝对隐藏，杜绝任何黑色半透明层残留遮盖聊天区导致白字发暗变黑 */
    .sidebar-overlay-backdrop[data-drawer-active="false"],
    html:not(.pi-sidebar-drawer-active) .sidebar-overlay-backdrop[style*="opacity: 0"] {
      opacity: 0 !important;
      pointer-events: none !important;
      visibility: hidden !important;
    }

    /* Mobile / Touch Responsive Enhancement */
    @media (max-width: 768px) {
      .pi-enh-quote-bar {
        z-index: 999999;
        padding: 4px 5px;
        gap: 3px;
        border-radius: 9px;
        border: 1px solid rgba(96, 165, 250, 0.55);
        box-shadow: 0 12px 36px rgba(0, 0, 0, 0.8), 0 0 0 1px rgba(96, 165, 250, 0.35), 0 4px 14px rgba(0, 0, 0, 0.5);
      }
      .pi-enh-quote-copy-btn {
        padding: 5px 8px;
        font-size: 12px;
        min-height: 30px;
      }
      .pi-enh-quote-btn {
        padding: 5px 9px;
        font-size: 12px;
        min-height: 30px;
      }
      .pi-enh-quote-action-btn {
        padding: 5px 7px;
        font-size: 12px;
        min-height: 30px;
      }
      .pi-enh-quote-divider {
        height: 16px;
      }
      html:not(.dark) .pi-enh-quote-bar {
        border: 1px solid #3b82f6;
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2), 0 0 0 1px rgba(59, 130, 246, 0.3);
      }
    }

    /* Duration Breakdown Tooltip */
    .pi-enh-tooltip {
      position: fixed;
      z-index: 100002;
      background: rgba(24, 24, 27, 0.96);
      color: #f4f4f5;
      border: 1px solid rgba(255, 255, 255, 0.18);
      border-radius: 10px;
      box-shadow: 0 12px 36px rgba(0, 0, 0, 0.6), 0 2px 8px rgba(0, 0, 0, 0.3);
      padding: 12px 15px;
      font-size: 12px;
      user-select: text;
      backdrop-filter: blur(18px);
      pointer-events: auto;
      min-width: 260px;
      max-width: 420px;
      animation: piEnhFadeIn 0.12s ease-out;
    }
    .pi-enh-tt-title {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      font-weight: 600;
      font-size: 13px;
      margin-bottom: 8px;
      color: #fafafa;
      white-space: nowrap;
    }
    .pi-enh-tt-bar {
      display: flex;
      height: 6px;
      border-radius: 3px;
      overflow: hidden;
      background: rgba(255, 255, 255, 0.1);
      margin-bottom: 10px;
    }
    .pi-enh-tt-bar-seg {
      height: 100%;
    }
    .pi-enh-tt-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 11.5px;
      padding: 2.5px 0;
      color: #a1a1aa;
    }
    .pi-enh-tt-row span:last-child {
      font-variant-numeric: tabular-nums;
      font-weight: 500;
      color: #e4e4e7;
    }
    .pi-enh-tt-tools-detail {
      margin-top: 6px;
      padding-top: 6px;
      border-top: 1px solid rgba(255, 255, 255, 0.08);
      font-size: 11px;
      color: #71717a;
      display: flex;
      flex-wrap: wrap;
      gap: 5px;
      max-height: 140px;
      overflow-y: auto;
      overscroll-behavior: contain;
      scrollbar-width: thin;
      scrollbar-color: rgba(255, 255, 255, 0.2) transparent;
    }
    .pi-enh-tt-tools-detail::-webkit-scrollbar {
      width: 4px;
    }
    .pi-enh-tt-tools-detail::-webkit-scrollbar-thumb {
      background: rgba(255, 255, 255, 0.2);
      border-radius: 2px;
    }
    .pi-enh-tt-tool-tag {
      background: rgba(255, 255, 255, 0.06);
      padding: 1px 6px;
      border-radius: 4px;
      font-family: var(--font-mono, monospace);
      font-size: 10.5px;
      color: #93c5fd;
      border: 1px solid rgba(147, 197, 253, 0.15);
      white-space: nowrap;
      line-height: 1.5;
    }
    .pi-enh-tt-timestamps {
      margin-top: 8px;
      padding-top: 7px;
      border-top: 1px solid rgba(255, 255, 255, 0.1);
      font-size: 11px;
      color: #a1a1aa;
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-variant-numeric: tabular-nums;
      flex-wrap: wrap;
      gap: 4px 8px;
    }

    /* Toast Notification */
    .pi-enh-toast {
      position: fixed;
      top: 16px;
      left: 50%;
      transform: translateX(-50%) translateY(-20px);
      z-index: 100000;
      display: flex;
      align-items: center;
      gap: 8px;
      max-width: min(520px, calc(100vw - 32px));
      background: rgba(24, 24, 27, 0.96);
      color: #fff;
      border: 1px solid rgba(255, 255, 255, 0.15);
      padding: 8px 10px 8px 16px;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 500;
      box-shadow: 0 8px 30px rgba(0, 0, 0, 0.45);
      opacity: 0;
      pointer-events: none;
      backdrop-filter: blur(10px);
      transition: opacity 0.2s ease, transform 0.2s ease;
    }
    .pi-enh-toast.show {
      opacity: 1;
      pointer-events: auto;
      transform: translateX(-50%) translateY(0);
    }
    .pi-enh-toast-dismiss {
      flex: 0 0 auto;
      margin-left: 4px;
      padding: 0 4px;
      border: 0;
      background: transparent;
      color: rgba(255, 255, 255, 0.62);
      cursor: pointer;
      font-size: 18px;
      line-height: 1;
      border-radius: 4px;
    }
    .pi-enh-toast-dismiss:hover {
      color: #fff;
      background: rgba(255, 255, 255, 0.1);
    }

    /* Model Scope Warning Visibility */
    html.pi-enh-model-scope-warning-hidden [role="alert"][data-pi-enh-model-scope-warning] {
      display: none !important;
    }

    /* 思考深度静默恢复：防止弹窗跳动遮挡视线 */
    [data-pi-enh-thinking-silent="true"] > div,
    [data-pi-enh-thinking-silent="true"] div[style*="boxShadow"],
    [data-pi-enh-thinking-silent="true"] div[style*="box-shadow"] {
      opacity: 0 !important;
      pointer-events: none !important;
      visibility: hidden !important;
    }

    /* Plugin Settings Panel */
    .pi-enh-plugins-panel {
      display: block;
      min-height: 0;
      overflow-x: hidden;
      overflow-y: auto;
      overscroll-behavior: contain;
      scrollbar-gutter: stable;
    }
    .pi-enh-notifications-panel {
      display: block;
      min-height: 0;
      overflow-x: hidden;
      overflow-y: auto;
      overscroll-behavior: contain;
      scrollbar-gutter: stable;
    }
    .pi-enh-notification-group {
      display: grid;
      gap: 8px;
      padding: 14px 20px 0;
    }
    .pi-enh-notification-group-title {
      margin: 0;
      color: var(--text);
      font-size: 13px;
      font-weight: 650;
    }
    .pi-enh-notification-history {
      margin: 14px 20px 0;
      padding: 14px;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: color-mix(in srgb, var(--bg-selected) 24%, transparent);
    }
    .pi-enh-notification-history-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      margin-bottom: 8px;
    }
    .pi-enh-notification-history-list {
      display: grid;
      gap: 6px;
      max-height: 330px;
      overflow: auto;
    }
    .pi-enh-notification-history-item {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr);
      gap: 8px;
      padding: 7px 8px;
      border-bottom: 1px solid color-mix(in srgb, var(--border) 58%, transparent);
      font-size: 11.5px;
    }
    .pi-enh-notification-history-item:last-child { border-bottom: 0; }
    .pi-enh-notification-history-meta {
      color: var(--text-dim);
      white-space: nowrap;
      font-variant-numeric: tabular-nums;
    }
    .pi-enh-notification-history-message {
      min-width: 0;
      color: var(--text);
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    .pi-enh-notification-history-status {
      color: var(--text-muted);
      font-size: 10.5px;
    }
    .pi-enh-notification-history-status.is-suppressed { color: #f59e0b; }
    .pi-enh-notification-history-empty {
      padding: 18px 4px 4px;
      color: var(--text-muted);
      font-size: 12px;
      text-align: center;
    }
    .notice-shelf-item[data-pi-enh-notification-suppressed="true"] {
      display: none !important;
    }
    .pi-enh-plugins-shell {
      min-height: 100%;
      padding-bottom: 18px;
    }
    .pi-enh-plugins-toolbar {
      position: static;
      padding: 16px 20px 12px;
      border-bottom: 1px solid color-mix(in srgb, var(--border) 78%, transparent);
      background: color-mix(in srgb, var(--bg) 94%, transparent);
    }
    .pi-enh-plugins-heading-row,
    .pi-enh-plugins-filter-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }
    .pi-enh-plugins-title-wrap {
      min-width: 0;
    }
    .pi-enh-plugins-title {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 8px;
      margin: 0;
      color: var(--text);
      font-size: 18px;
      font-weight: 650;
      line-height: 1.35;
    }
    .pi-enh-plugins-enabled-count {
      display: inline-flex;
      align-items: center;
      min-height: 22px;
      padding: 1px 8px;
      border-radius: 999px;
      background: color-mix(in srgb, var(--accent) 15%, transparent);
      color: var(--accent);
      font-size: 11.5px;
      font-weight: 650;
      white-space: nowrap;
    }
    .pi-enh-kernel-health-badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      min-height: 22px;
      padding: 1px 9px;
      border-radius: 999px;
      border: 1px solid rgba(16, 185, 129, 0.35);
      background: rgba(16, 185, 129, 0.12);
      color: #10b981;
      font-size: 11.2px;
      font-weight: 620;
      line-height: 1.4;
      white-space: nowrap;
      cursor: help;
    }
    .pi-enh-kernel-health-badge[data-state="isolated-warn"] {
      border-color: rgba(245, 158, 11, 0.42);
      background: rgba(245, 158, 11, 0.14);
      color: #f59e0b;
    }
    .pi-enh-plugins-description {
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 8px;
      margin: 8px 0 10px;
      color: var(--text-muted);
      font-size: 12.5px;
      line-height: 1.45;
    }
    .pi-enh-plugins-actions {
      display: flex;
      flex: 0 0 auto;
      gap: 6px;
    }
    .pi-enh-btn-sm {
      min-height: 30px;
      padding: 4px 10px;
      border: 1px solid var(--border);
      border-radius: 6px;
      background: var(--bg-selected);
      color: var(--text);
      font-size: 11.5px;
      font-weight: 550;
      white-space: nowrap;
      cursor: pointer;
      transition: background 0.15s, border-color 0.15s, color 0.15s;
    }
    .pi-enh-btn-sm:hover {
      border-color: var(--accent);
      background: var(--bg-hover);
      color: var(--accent);
    }
    .pi-enh-btn-sm:focus-visible,
    .pi-enh-plugin-search:focus-visible,
    .pi-enh-category-btn:focus-visible,
    .pi-enh-plugin-item .config-switch:focus-visible {
      outline: 2px solid color-mix(in srgb, var(--accent) 72%, white);
      outline-offset: 2px;
    }
    .pi-enh-btn-primary {
      border-color: color-mix(in srgb, var(--accent) 72%, var(--border));
      color: var(--accent);
    }
    .pi-enh-plugins-filter-row {
      margin-top: 12px;
    }
    .pi-enh-plugin-search-wrap {
      position: relative;
      display: flex;
      flex: 0 1 280px;
      min-width: 190px;
    }
    .pi-enh-plugin-search-icon {
      position: absolute;
      top: 50%;
      left: 10px;
      width: 14px;
      height: 14px;
      color: var(--text-muted);
      pointer-events: none;
      transform: translateY(-50%);
    }
    .pi-enh-plugin-search {
      box-sizing: border-box;
      width: 100%;
      height: 32px;
      padding: 0 30px;
      border: 1px solid var(--border);
      border-radius: 7px;
      background: color-mix(in srgb, var(--bg-selected) 72%, transparent);
      color: var(--text);
      font: inherit;
      font-size: 12px;
    }
    .pi-enh-plugin-search::placeholder {
      color: var(--text-muted);
    }
    .pi-enh-category-filters {
      display: flex;
      flex: 1 1 auto;
      align-items: center;
      gap: 5px;
      min-width: 0;
      overflow-x: auto;
      scrollbar-width: none;
    }
    .pi-enh-category-filters::-webkit-scrollbar {
      display: none;
    }
    .pi-enh-category-btn {
      flex: 0 0 auto;
      min-height: 28px;
      padding: 3px 9px;
      border: 1px solid transparent;
      border-radius: 999px;
      background: transparent;
      color: var(--text-muted);
      font-size: 11.5px;
      white-space: nowrap;
      cursor: pointer;
    }
    .pi-enh-category-btn:hover {
      background: var(--bg-hover);
      color: var(--text);
    }
    .pi-enh-category-btn[aria-pressed="true"] {
      border-color: color-mix(in srgb, var(--accent) 32%, transparent);
      background: color-mix(in srgb, var(--accent) 14%, transparent);
      color: var(--accent);
      font-weight: 600;
    }
    .pi-enh-plugin-result-count {
      flex: 0 0 auto;
      color: var(--text-muted);
      font-size: 11.5px;
      white-space: nowrap;
    }
    .pi-enh-plugins-list {
      display: flex;
      flex-direction: column;
      gap: 7px;
      padding: 12px 20px 0;
    }
    .pi-enh-plugin-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 14px;
      padding: 10px 13px;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: color-mix(in srgb, var(--bg-selected) 26%, transparent);
      transition: border-color 0.15s, background 0.15s;
    }
    .pi-enh-plugin-item:hover {
      border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
      background: color-mix(in srgb, var(--bg-selected) 48%, transparent);
    }
    .pi-enh-module-version {
      display: inline-flex;
      align-items: center;
      padding: 1px 6px;
      border: 1px solid color-mix(in srgb, var(--accent) 32%, transparent);
      border-radius: 999px;
      color: var(--text-muted);
      font-size: 10.5px;
      font-weight: 600;
      line-height: 1.45;
      white-space: nowrap;
    }
    .pi-enh-module-item { display: block; }
    .pi-enh-module-header { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: start; gap: 12px; }
    .pi-enh-module-master { display: flex; align-items: center; gap: 8px; }
    .pi-enh-module-status { font-size: 11px; line-height: 20px; white-space: nowrap; color: var(--text-muted); }
    .pi-enh-module-status[data-state="partial"] { color: var(--text); }
    .pi-enh-module-toggle.config-switch { position: relative; box-sizing: border-box; width: 36px; height: 20px; min-width: 36px; padding: 2px; border: 1px solid var(--border); border-radius: 999px; background: var(--bg-hover); cursor: pointer; }
    .pi-enh-module-toggle.config-switch .config-switch-knob { position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%; background: var(--text-muted); transform: translateX(0); transition: transform .15s, background .15s; }
    .pi-enh-module-toggle.config-switch[data-state="on"] { background: var(--accent); border-color: var(--accent); }
    .pi-enh-module-toggle.config-switch[data-state="on"] .config-switch-knob { transform: translateX(16px); background: var(--bg); }
    .pi-enh-module-toggle.config-switch[data-state="partial"] { background: #d9a441; border-color: #d9a441; }
    .pi-enh-module-toggle.config-switch[data-state="partial"] .config-switch-knob { transform: translateX(8px); background: #29200e; }
    .pi-enh-module-toggle.config-switch[data-state="partial"] .config-switch-knob::after { content: ""; position: absolute; width: 8px; height: 2px; left: 3px; top: 6px; background: #ffe4a3; border-radius: 1px; }
    .pi-enh-module-toggle:focus-visible, .pi-enh-module-settings > summary:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
    .pi-enh-module-settings {
      margin-top: 9px;
      border-top: 1px solid color-mix(in srgb, var(--border) 75%, transparent);
      padding-top: 7px;
    }
    .pi-enh-module-settings > summary {
      width: fit-content;
      color: var(--accent);
      cursor: pointer;
      font-size: 11.5px;
      font-weight: 600;
      list-style: none;
    }
    .pi-enh-module-settings > summary::-webkit-details-marker { display: none; }
    .pi-enh-module-settings > summary::before { content: "›"; display: inline-block; margin-right: 5px; transition: transform 0.15s; }
    .pi-enh-module-settings[open] > summary::before { transform: rotate(90deg); }
    .pi-enh-module-settings-body { display: grid; gap: 10px; padding-top: 10px; }
    .pi-enh-module-settings[data-module-disabled="true"] { opacity: 0.58; }
    .pi-enh-module-feature { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding: 7px 0; border-bottom: 1px solid color-mix(in srgb, var(--border) 48%, transparent); }
    .pi-enh-module-feature-copy { display: grid; gap: 2px; min-width: 0; }
    .pi-enh-module-feature-name { color: var(--text); font-size: 12px; font-weight: 600; line-height: 1.35; }
    .pi-enh-module-feature-desc { color: var(--text-muted); font-size: 11px; line-height: 1.42; }
    .pi-enh-module-feature .config-switch:disabled,
    .pi-enh-module-parameters [disabled],
    .pi-enh-module-settings-body [disabled] { cursor: not-allowed; opacity: 0.5; }

    /* 跨端同步与版本安全卡片 */
    .pi-enh-sync-card {
      margin: 12px 20px 0;
      padding: 12px 14px;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: color-mix(in srgb, var(--bg-selected) 36%, transparent);
      display: flex;
      flex-direction: column;
      gap: 10px;
      transition: all 0.15s ease;
    }
    .pi-enh-sync-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 8px;
    }
    .pi-enh-sync-title-wrap {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 8px;
    }
    .pi-enh-sync-title {
      font-size: 13px;
      font-weight: 600;
      color: var(--text);
      display: inline-flex;
      align-items: center;
    }
    .pi-enh-inline-icon {
      display: inline-flex;
      align-items: center;
      vertical-align: -2px;
      margin-right: 5px;
      flex-shrink: 0;
    }
    .pi-enh-sync-status-badge {
      font-size: 11px;
      padding: 2px 7px;
      border-radius: 999px;
      font-weight: 600;
      line-height: 1.2;
    }
    .pi-enh-sync-status-badge[data-state="SYNCED"] {
      background: rgba(34, 197, 94, 0.15);
      color: #22c55e;
      border: 1px solid rgba(34, 197, 94, 0.3);
    }
    .pi-enh-sync-status-badge[data-state="LOCAL_NEWER"],
    .pi-enh-sync-status-badge[data-state="REMOTE_NEWER"] {
      background: rgba(59, 130, 246, 0.15);
      color: #60a5fa;
      border: 1px solid rgba(59, 130, 246, 0.3);
    }
    .pi-enh-sync-status-badge[data-state="CONFLICT"] {
      background: rgba(239, 68, 68, 0.15);
      color: #ef4444;
      border: 1px solid rgba(239, 68, 68, 0.3);
    }
    .pi-enh-sync-status-badge[data-state="DISCONNECTED"] {
      background: rgba(148, 163, 184, 0.15);
      color: #94a3b8;
      border: 1px solid rgba(148, 163, 184, 0.3);
    }
    .pi-enh-sync-actions {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .pi-enh-sync-body {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 8px 12px;
      border-radius: 6px;
      background: var(--bg-hover, rgba(255, 255, 255, 0.04));
      font-size: 11.5px;
      color: var(--text-muted);
    }
    .pi-enh-sync-node {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
    }
    .pi-enh-sync-target-check-wrap {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      cursor: pointer;
      user-select: none;
      min-width: 0;
      white-space: nowrap;
    }
    .pi-enh-sync-checkbox {
      appearance: auto;
      cursor: pointer;
      width: 13px;
      height: 13px;
      margin: 0;
      flex-shrink: 0;
      accent-color: var(--accent, #3b82f6);
    }
    .pi-enh-sync-checkbox:disabled {
      cursor: wait;
      opacity: 0.6;
    }
    .pi-enh-sync-targets-col {
      display: flex;
      flex-direction: column;
      gap: 6px;
      min-width: 0;
      flex: 1;
    }
    .pi-enh-sync-node-name {
      font-weight: 600;
      color: var(--text);
      display: inline-flex;
      align-items: center;
      gap: 5px;
      white-space: nowrap;
    }
    .pi-enh-sync-arrow {
      font-size: 14px;
      font-weight: 700;
      color: var(--accent);
      flex-shrink: 0;
    }
    @media (max-width: 760px) {
      .pi-enh-sync-card {
        margin: 10px 12px 0;
        padding: 10px;
      }
      .pi-enh-sync-actions {
        width: 100%;
        overflow-x: auto;
      }
      .pi-enh-sync-body {
        flex-direction: column;
        align-items: flex-start;
        gap: 8px;
      }
      .pi-enh-sync-targets-col {
        width: 100%;
      }
      .pi-enh-sync-arrow {
        display: none;
      }
    }
    .pi-enh-plugin-copy {
      flex: 1;
      min-width: 0;
    }
    .pi-enh-plugin-name-row {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 7px;
    }
    .pi-enh-plugin-name {
      color: var(--text);
      font-size: 13px;
      font-weight: 620;
      line-height: 1.35;
    }
    .pi-enh-plugin-category {
      padding: 1px 6px;
      border-radius: 4px;
      background: var(--bg-hover, rgba(255,255,255,0.06));
      color: var(--accent);
      font-size: 10.5px;
      font-weight: 550;
      line-height: 1.45;
    }
    .pi-enh-plugin-desc {
      margin-top: 3px;
      color: var(--text-muted);
      font-size: 11.75px;
      line-height: 1.42;
    }
    .pi-enh-plugin-number-settings {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 8px 14px;
      margin-top: 8px;
      color: var(--text-muted);
      font-size: 11.75px;
    }
    .pi-enh-plugin-number-setting {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      white-space: nowrap;
    }
    .pi-enh-plugin-number-setting input,
    .pi-enh-plugin-number-setting select {
      box-sizing: border-box;
      width: 58px;
      height: 26px;
      padding: 2px 5px;
      border: 1px solid var(--border);
      border-radius: 5px;
      outline: none;
      background: var(--bg-hover, rgba(255,255,255,0.08));
      color: var(--text);
      font: inherit;
      text-align: center;
    }
    .pi-enh-plugin-number-setting select { width: auto; min-width: 108px; max-width: 100%; }
    .pi-enh-plugin-number-setting input:focus,
    .pi-enh-plugin-number-setting select:focus {
      border-color: color-mix(in srgb, var(--accent) 70%, var(--border));
      box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 15%, transparent);
    }
    .pi-enh-plugin-item .config-switch {
      flex: 0 0 auto;
    }
    .pi-enh-plugin-empty {
      margin: 22px 20px 4px;
      padding: 24px 16px;
      border: 1px dashed var(--border);
      border-radius: 8px;
      color: var(--text-muted);
      font-size: 12.5px;
      text-align: center;
    }
    .pi-enh-plugins-panel [hidden] {
      display: none !important;
    }
    @media (max-width: 760px) {
      .pi-enh-plugins-toolbar {
        padding: 12px;
      }
      .pi-enh-plugins-heading-row {
        align-items: flex-start;
        flex-direction: column;
      }
      .pi-enh-plugins-actions {
        width: 100%;
        padding-bottom: 2px;
        overflow-x: auto;
      }
      .pi-enh-plugins-filter-row {
        align-items: stretch;
        flex-wrap: wrap;
        margin-top: 10px;
      }
      .pi-enh-plugin-search-wrap,
      .pi-enh-category-filters {
        flex-basis: 100%;
        width: 100%;
      }
      .pi-enh-plugin-result-count {
        margin-left: auto;
      }
      .pi-enh-plugins-list {
        padding: 10px 12px 0;
      }
      .pi-enh-plugin-item {
        padding: 10px 11px;
      }
    }
    @media (max-width: 520px) {
      .pi-enh-plugins-title {
        font-size: 16px;
      }
      .pi-enh-plugins-description {
        display: none;
      }
      .pi-enh-plugin-item {
        align-items: flex-start;
      }
      .pi-enh-plugin-item .config-switch {
        margin-top: 1px;
      }
      .pi-enh-module-master { flex-direction: column-reverse; align-items: flex-end; gap: 2px; }
      .pi-enh-module-status { font-size: 10px; }
      .pi-enh-module-feature {
        gap: 8px;
      }
      .pi-enh-module-parameters {
        align-items: flex-start;
        flex-direction: column;
      }
    }

    /* 对话区域原生滚动条恢复与美化 */
    html.pi-enh-scrollbar-active .chat-content .overflow-y-auto,
    html.pi-enh-scrollbar-active [class*="[scrollbar-width:none]"],
    html.pi-enh-scrollbar-active .chat-content div[style*="visibility"] {
      scrollbar-width: thin !important;
      scrollbar-color: color-mix(in srgb, var(--border, #3f3f46) 90%, transparent) transparent !important;
    }
    html.pi-enh-scrollbar-active .chat-content .overflow-y-auto::-webkit-scrollbar,
    html.pi-enh-scrollbar-active [class*="[scrollbar-width:none]"]::-webkit-scrollbar {
      width: 6px !important;
      height: 6px !important;
      display: block !important;
    }
    html.pi-enh-scrollbar-active .chat-content .overflow-y-auto::-webkit-scrollbar-track,
    html.pi-enh-scrollbar-active [class*="[scrollbar-width:none]"]::-webkit-scrollbar-track {
      background: transparent !important;
    }
    html.pi-enh-scrollbar-active .chat-content .overflow-y-auto::-webkit-scrollbar-thumb,
    html.pi-enh-scrollbar-active [class*="[scrollbar-width:none]"]::-webkit-scrollbar-thumb {
      background: color-mix(in srgb, var(--border, #3f3f46) 75%, transparent) !important;
      border-radius: 3px !important;
    }
    html.pi-enh-scrollbar-active .chat-content .overflow-y-auto::-webkit-scrollbar-thumb:hover,
    html.pi-enh-scrollbar-active [class*="[scrollbar-width:none]"]::-webkit-scrollbar-thumb:hover {
      background: var(--text-muted, #71717a) !important;
    }

    /* 长会话视口虚拟化渲染：跳过视口外历史消息的排版与绘制，首次挂载性能提升90%+ */
    html.pi-enh-virtual-scroll-active .chat-content [data-entry-id]:not(:last-child),
    html.pi-enh-virtual-scroll-active .chat-content div[class*="group\/message"]:not(:last-child),
    html.pi-enh-virtual-scroll-active .chat-content [data-message-id]:not(:last-child) {
      content-visibility: auto;
      contain-intrinsic-size: auto 130px;
    }

    /* Minimap 预览面板：全量统计 + 按需加载历史 */
    .pi-enh-minimap-toolbar {
      box-sizing: border-box;
      display: none;
      position: absolute;
      top: 0;
      right: 100%;
      z-index: 101;
      width: 320px;
      background: color-mix(in srgb, var(--bg) 90%, var(--bg-panel, #27272a));
      border-left: 1px solid color-mix(in srgb, var(--border) 82%, transparent);
      border-bottom: 1px solid color-mix(in srgb, var(--border) 60%, transparent);
      backdrop-filter: blur(8px);
      cursor: default;
    }
    [data-minimap-preview-box] ~ .pi-enh-minimap-toolbar {
      display: block;
    }
    [data-minimap-preview-box].pi-enh-minimap-closed,
    [data-minimap-preview-box].pi-enh-minimap-closed ~ .pi-enh-minimap-toolbar,
    .pi-enh-minimap-toolbar.pi-enh-minimap-closed {
      display: none !important;
      opacity: 0 !important;
      pointer-events: none !important;
    }
    .pi-enh-minimap-header {
      box-sizing: border-box;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      min-height: 32px;
      padding: 6px 12px;
      color: var(--text-muted, #a1a1aa);
      font-size: 11px;
      font-weight: 600;
    }
    .pi-enh-minimap-header-badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 1px 6px;
      border-radius: 4px;
      background: color-mix(in srgb, var(--accent, #38bdf8) 14%, transparent);
      color: var(--accent, #38bdf8);
      font-size: 11px;
      font-weight: 600;
      white-space: nowrap;
    }
    .pi-enh-minimap-load-earlier {
      box-sizing: border-box;
      width: 100%;
      min-height: 36px;
      padding: 7px 12px;
      border: 0;
      border-top: 1px solid color-mix(in srgb, var(--border) 45%, transparent);
      background: color-mix(in srgb, var(--accent, #38bdf8) 7%, transparent);
      color: var(--accent, #38bdf8);
      cursor: pointer;
      font: inherit;
      font-size: 11px;
      font-weight: 600;
      line-height: 1.35;
      text-align: center;
      transition: background 0.12s ease, color 0.12s ease;
      touch-action: manipulation;
    }
    .pi-enh-minimap-load-earlier:hover,
    .pi-enh-minimap-load-earlier:focus-visible {
      background: color-mix(in srgb, var(--accent, #38bdf8) 14%, transparent);
      outline: none;
    }
    .pi-enh-minimap-load-earlier:disabled {
      color: var(--text-dim, #71717a);
      cursor: default;
      opacity: 0.82;
    }
    .pi-enh-minimap-load-earlier.is-loading {
      color: var(--text-muted, #a1a1aa);
    }

    /* Web-native ask_user controls (Codex 单列紧凑列表) */
    /* 精确针对已识别为 ask_user 的原生 host 与 panel 进行视觉隔离，严禁全局 :has(pre) 误伤其他 dialog */
    .pi-enh-ask-native-host {
      position: absolute !important;
      inset: 0 !important;
      width: 0 !important;
      height: 0 !important;
      min-height: 0 !important;
      padding: 0 !important;
      margin: 0 !important;
      border: 0 !important;
      overflow: hidden !important;
      pointer-events: none !important;
      opacity: 0 !important;
      z-index: -1 !important;
    }
    .pi-enh-ask-native-panel {
      position: absolute !important;
      width: 0 !important;
      height: 0 !important;
      min-height: 0 !important;
      padding: 0 !important;
      margin: 0 !important;
      border: 0 !important;
      overflow: hidden !important;
      pointer-events: none !important;
      opacity: 0 !important;
      background: transparent !important;
      box-shadow: none !important;
    }

    /* 新会话尚无消息滚动区时，仍占据普通布局空间而不是覆盖输入区。 */
    .pi-enh-ask-fallback-host {
      position: relative !important;
      inset: auto !important;
      flex: 0 0 auto;
      width: 100%;
      min-height: 0;
      padding: 0 16px !important;
      box-sizing: border-box;
    }
    .pi-enh-ask-dock-layout { flex-direction: column !important; overflow-y: auto !important; }
    .pi-enh-ask-fallback-panel {
      width: 100% !important;
      max-height: none !important;
      background: transparent !important;
      border: 0 !important;
      box-shadow: none !important;
      overflow: visible !important;
    }
    .pi-enh-ask-fallback-panel > pre,
    .pi-enh-ask-fallback-panel > div { display: none !important; }

    /* 真实对话滚动容器普通文档流中的 Codex 风格单列紧凑卡片 */
    .pi-enh-ask-native {
      position: relative;
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      width: 100%;
      max-width: var(--chat-content-max-width, 820px);
      margin: 12px auto 20px;
      padding: 0;
      border: 1px solid color-mix(in srgb, var(--border, #3f3f46) 75%, transparent);
      border-radius: 8px;
      background: color-mix(in srgb, var(--bg-panel, #20242b) 92%, var(--bg, #18181b));
      box-shadow: 0 4px 14px rgba(0, 0, 0, 0.12), inset 0 1px rgba(255, 255, 255, 0.05);
      color: var(--text, #f4f4f5);
      font-family: var(--font-sans, system-ui, sans-serif);
      font-size: 13px;
      line-height: 1.45;
      overflow: visible;
    }

    .pi-enh-ask-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex: 0 0 auto;
      gap: 8px;
      padding: 7px 12px;
      border-bottom: 1px solid color-mix(in srgb, var(--border, #3f3f46) 55%, transparent);
      background: color-mix(in srgb, var(--bg-panel, #20242b) 70%, transparent);
      border-top-left-radius: 8px;
      border-top-right-radius: 8px;
    }

    .pi-enh-ask-header-left {
      display: flex;
      align-items: center;
      gap: 7px;
      min-width: 0;
    }

    .pi-enh-ask-header-badge {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--accent, #38bdf8);
      flex: 0 0 auto;
    }

    .pi-enh-ask-native-title {
      margin: 0;
      color: var(--text, #f4f4f5);
      font-size: 12.5px;
      font-weight: 600;
      letter-spacing: 0.01em;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .pi-enh-ask-collapse-btn {
      padding: 2px 7px;
      border: 1px solid transparent;
      border-radius: 4px;
      background: transparent;
      color: var(--text-muted, #a1a1aa);
      font-size: 11.5px;
      cursor: pointer;
      transition: color 0.12s ease, background 0.12s ease;
    }
    .pi-enh-ask-collapse-btn:hover {
      color: var(--text, #f4f4f5);
      background: color-mix(in srgb, var(--text, #f4f4f5) 8%, transparent);
    }

    .pi-enh-ask-body {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 10px 12px;
      overflow: visible;
    }

    .pi-enh-ask-footer {
      flex: 0 0 auto;
      padding: 8px 12px 10px;
      border-top: 1px solid color-mix(in srgb, var(--border, #3f3f46) 50%, transparent);
      background: color-mix(in srgb, var(--bg-panel, #20242b) 50%, transparent);
      border-bottom-left-radius: 8px;
      border-bottom-right-radius: 8px;
    }

    .pi-enh-ask-native.is-collapsed .pi-enh-ask-body,
    .pi-enh-ask-native.is-collapsed .pi-enh-ask-footer {
      display: none;
    }
    .pi-enh-ask-native.is-collapsed .pi-enh-ask-header {
      border-bottom: 0;
      border-radius: 8px;
    }

    .pi-enh-ask-native-question {
      margin: 0;
      color: var(--text, #f4f4f5);
      font-weight: 600;
      font-size: 13px;
      line-height: 1.45;
      white-space: pre-wrap;
      word-break: break-word;
    }

    /* 可折叠上下文与风险摘要 */
    .pi-enh-ask-context {
      margin: 0;
      border: 1px solid color-mix(in srgb, var(--border, #3f3f46) 50%, transparent);
      border-left: 3px solid #f59e0b;
      border-radius: 6px;
      background: color-mix(in srgb, var(--bg, #18181b) 50%, transparent);
      padding: 6px 9px;
    }
    .pi-enh-ask-context summary {
      cursor: pointer;
      font-size: 12px;
      font-weight: 600;
      color: var(--text-muted, #d1d5db);
      user-select: none;
      display: flex;
      align-items: center;
      gap: 6px;
      outline: none;
    }
    .pi-enh-ask-context summary:hover {
      color: var(--text, #f4f4f5);
    }
    .pi-enh-ask-context-summary-tag {
      font-size: 10.5px;
      padding: 1px 5px;
      border-radius: 3px;
      background: rgba(245, 158, 11, 0.15);
      color: #fbbf24;
      font-weight: 600;
      white-space: nowrap;
    }
    .pi-enh-ask-context-summary-text {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      flex: 1;
      min-width: 0;
    }
    .pi-enh-ask-context-text {
      margin-top: 6px;
      padding-top: 6px;
      border-top: 1px solid color-mix(in srgb, var(--border, #3f3f46) 30%, transparent);
      overflow: visible;
      white-space: pre-wrap;
      word-break: break-word;
      color: var(--text-muted, #cbd5e1);
      font-size: 12px;
      line-height: 1.5;
    }
    .pi-enh-ask-context-status {
      font-size: 11.5px;
      color: var(--text-muted, #94a3b8);
      line-height: 1.4;
      padding: 4px 0;
    }

    /* 骨架屏 */
    .pi-enh-ask-context-skeleton {
      border: 1px solid color-mix(in srgb, var(--border, #3f3f46) 40%, transparent);
      border-left: 3px solid color-mix(in srgb, var(--accent, #38bdf8) 60%, transparent);
      border-radius: 6px;
      padding: 6px 9px;
      display: flex;
      flex-direction: column;
      gap: 5px;
    }
    .pi-enh-ask-skeleton-summary {
      font-size: 11.5px;
      font-weight: 600;
      color: var(--text-muted, #94a3b8);
    }
    .pi-enh-ask-skeleton-body {
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding: 2px 0;
    }
    .pi-enh-ask-skeleton-line {
      height: 10px;
      border-radius: 3px;
      background: color-mix(in srgb, var(--border, #52525b) 40%, transparent);
      animation: piEnhSkeletonPulse 1.2s ease-in-out infinite;
    }
    .pi-enh-ask-skeleton-line.is-short { width: 55%; }
    @keyframes piEnhSkeletonPulse {
      0%, 100% { opacity: 0.35; }
      50% { opacity: 0.75; }
    }

    /* 单列紧凑选项列表 */
    .pi-enh-ask-options {
      display: flex;
      flex-direction: column;
      gap: 5px;
      width: 100%;
    }

    .pi-enh-ask-option-row {
      position: relative;
      display: flex;
      align-items: stretch;
      gap: 4px;
      width: 100%;
    }

    .pi-enh-ask-option {
      flex: 1;
      min-width: 0;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 10px;
      min-height: 34px;
      border: 1px solid color-mix(in srgb, var(--border, #3f3f46) 70%, transparent);
      border-radius: 6px;
      background: color-mix(in srgb, var(--bg-panel, #27272a) 60%, transparent);
      color: var(--text, #f4f4f5);
      text-align: left;
      cursor: pointer;
      font: inherit;
      font-size: 12.5px;
      line-height: 1.35;
      transition: border-color 0.12s ease, background 0.12s ease;
      user-select: none;
    }
    .pi-enh-ask-option:hover,
    .pi-enh-ask-option:focus-visible {
      border-color: var(--accent, #38bdf8);
      background: color-mix(in srgb, var(--accent, #38bdf8) 10%, var(--bg-panel, #27272a));
      outline: none;
    }
    .pi-enh-ask-option.is-selected {
      border-color: var(--accent, #38bdf8);
      background: color-mix(in srgb, var(--accent, #38bdf8) 14%, var(--bg-panel, #27272a));
    }

    .pi-enh-ask-option-index {
      flex: 0 0 auto;
      display: grid;
      place-items: center;
      width: 18px;
      height: 18px;
      border: 1px solid color-mix(in srgb, var(--text, #f4f4f5) 25%, var(--border, #3f3f46));
      border-radius: 4px;
      color: var(--text-muted, #94a3b8);
      font-size: 11px;
      font-weight: 600;
      line-height: 1;
    }
    .pi-enh-ask-option.is-selected .pi-enh-ask-option-index {
      border-color: var(--accent, #38bdf8);
      color: var(--accent, #38bdf8);
      background: color-mix(in srgb, var(--accent, #38bdf8) 15%, transparent);
    }

    .pi-enh-ask-option-label {
      flex: 1;
      min-width: 0;
      font-size: 12.5px;
      font-weight: 500;
      white-space: pre-wrap;
      word-break: break-word;
    }

    /* 独立说明按钮（移动端/桌面触控或点击专用，绝不误提交） */
    .pi-enh-ask-option-info-btn {
      flex: 0 0 auto;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 30px;
      min-height: 34px;
      border: 1px solid color-mix(in srgb, var(--border, #3f3f46) 50%, transparent);
      border-radius: 6px;
      background: color-mix(in srgb, var(--bg-panel, #27272a) 40%, transparent);
      color: var(--text-muted, #94a3b8);
      cursor: pointer;
      font: inherit;
      padding: 0;
      transition: color 0.12s ease, border-color 0.12s ease, background 0.12s ease;
    }
    .pi-enh-ask-option-info-btn:hover,
    .pi-enh-ask-option-info-btn:focus-visible,
    .pi-enh-ask-option-info-btn.is-active {
      color: var(--accent, #38bdf8);
      border-color: var(--accent, #38bdf8);
      background: color-mix(in srgb, var(--accent, #38bdf8) 12%, transparent);
      outline: none;
    }

    /* 选项说明 Tooltip 浮层（桌面端悬停/聚焦或点击独立说明按钮弹出） */
    :root[data-theme="light"] .pi-enh-ask-context-summary-tag { color: #92400e; }

    .pi-enh-ask-tooltip {
      position: fixed;
      z-index: 1000;
      box-sizing: border-box;
      max-width: min(440px, calc(100vw - 32px));
      max-height: min(240px, 40vh);
      overflow-y: auto;
      padding: 8px 11px;
      border: 1px solid color-mix(in srgb, var(--accent, #38bdf8) 45%, var(--border, #3f3f46));
      border-radius: 6px;
      background: color-mix(in srgb, var(--bg-panel, #181b21) 96%, #000);
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
      color: var(--text, #f4f4f5);
      font-size: 11.5px;
      line-height: 1.45;
      white-space: pre-wrap;
      word-break: break-word;
      pointer-events: auto;
      animation: piEnhTooltipFade 0.12s ease-out;
    }
    @keyframes piEnhTooltipFade {
      from { opacity: 0; transform: translateY(-2px); }
      to { opacity: 1; transform: translateY(0); }
    }

    /* 移动端/触控展开的内联说明抽屉（备选，确保无误触与高可读） */
    .pi-enh-ask-inline-desc {
      padding: 6px 9px;
      border: 1px dashed color-mix(in srgb, var(--accent, #38bdf8) 40%, transparent);
      border-radius: 5px;
      background: color-mix(in srgb, var(--accent, #38bdf8) 6%, transparent);
      color: var(--text-muted, #cbd5e1);
      font-size: 11.5px;
      line-height: 1.45;
      white-space: pre-wrap;
      word-break: break-word;
      margin-top: -2px;
      margin-bottom: 2px;
    }

    /* 紧凑自由输入与操作栏 */
    .pi-enh-ask-freeform {
      display: flex;
      flex-direction: column;
      gap: 6px;
      width: 100%;
    }
    .pi-enh-ask-freeform-row {
      display: flex;
      align-items: stretch;
      gap: 6px;
      width: 100%;
    }
    .pi-enh-ask-freeform textarea {
      flex: 1;
      min-width: 0;
      box-sizing: border-box;
      min-height: 34px;
      max-height: 72px;
      resize: vertical;
      padding: 6px 9px;
      border: 1px solid color-mix(in srgb, var(--border, #3f3f46) 75%, transparent);
      border-radius: 6px;
      background: color-mix(in srgb, var(--bg, #18181b) 75%, transparent);
      color: var(--text, #f4f4f5);
      font: inherit;
      font-size: 12.5px;
      line-height: 1.4;
      outline: none;
    }
    .pi-enh-ask-freeform textarea:focus {
      border-color: var(--accent, #38bdf8);
    }

    .pi-enh-ask-actions {
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 6px;
      margin-top: 6px;
    }
    .pi-enh-ask-action {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 4px 9px;
      min-height: 28px;
      border: 1px solid color-mix(in srgb, var(--border, #3f3f46) 70%, transparent);
      border-radius: 5px;
      background: color-mix(in srgb, var(--bg-panel, #27272a) 70%, transparent);
      color: var(--text-muted, #d1d5db);
      font-size: 11.5px;
      font-weight: 500;
      cursor: pointer;
      transition: border-color 0.12s ease, color 0.12s ease;
    }
    .pi-enh-ask-action:hover {
      border-color: var(--text-muted, #e4e4e7);
      color: var(--text, #f8fafc);
    }
    .pi-enh-ask-action-primary {
      border-color: var(--accent, #38bdf8);
      background: var(--accent, #38bdf8);
      color: var(--bg, #07131a);
      font-weight: 600;
    }
    .pi-enh-ask-action-primary:hover {
      filter: brightness(1.08);
      color: var(--bg, #07131a);
    }

    .pi-enh-ask-hint {
      color: var(--text-muted, #71717a);
      font-size: 11px;
    }

    .pi-enh-ask-progress {
      margin-top: 6px;
      color: var(--accent, #7dd3fc);
      font-size: 11.5px;
      font-weight: 600;
    }
    .pi-enh-ask-progress:empty { display: none; }

    .pi-enh-ask-raw { margin-top: 8px; }
    .pi-enh-ask-raw summary { cursor: pointer; font-size: 11.5px; font-weight: 600; }
    .pi-enh-ask-raw pre { max-height: 140px; white-space: pre-wrap; overflow-wrap: anywhere; overflow: auto; font-size: 11.5px; }

    .pi-enh-ask-native button:disabled { cursor: wait; opacity: .6; }

    @media (max-width: 768px) {
      .pi-enh-ask-native {
        margin: 8px auto 14px;
        font-size: 13.5px;
      }
      .pi-enh-ask-option {
        min-height: 44px;
        padding: 8px 12px;
        font-size: 13px;
      }
      .pi-enh-ask-option-info-btn {
        width: 44px;
        min-width: 44px;
        min-height: 44px;
      }
      .pi-enh-ask-freeform textarea {
        min-height: 44px;
        font-size: 13px;
      }
      .pi-enh-ask-action {
        min-height: 44px;
        padding: 6px 12px;
        font-size: 12px;
      }
    }

    /* 跨项目会话状态提示：橙色仅用于需要用户确认的会话 */
    .pi-enh-session-needs-attention,
    .pi-enh-session-row-host.pi-enh-session-needs-attention,
    [data-pi-enh-project-status="attention"] {
      background: rgba(245, 158, 11, 0.16) !important;
      border-left: 3px solid #f59e0b !important;
      box-shadow: inset 0 0 0 1px rgba(245, 158, 11, 0.25) !important;
      animation: piEnhAttentionPulse 2.4s infinite ease-in-out;
    }
    @keyframes piEnhAttentionPulse {
      0%, 100% {
        box-shadow: inset 0 0 0 1px rgba(245, 158, 11, 0.25);
        border-left-color: #f59e0b;
      }
      50% {
        box-shadow: inset 0 0 0 1px rgba(245, 158, 11, 0.5), 0 0 12px rgba(245, 158, 11, 0.2);
        border-left-color: #fbbf24;
      }
    }
    .pi-enh-project-status-dot {
      width: 8px;
      height: 8px;
      flex: 0 0 auto;
      border-radius: 50%;
      margin-left: 6px;
      box-shadow: 0 0 0 2px color-mix(in srgb, currentColor 10%, transparent);
    }

    /* Keep status in normal flex flow, before the final overflow action. */
    .pi-enh-session-status-label { position: static; order: 2147483646; flex: 0 0 auto; align-self: center; max-width: 72px; font-size: 11px; line-height: 20px; padding: 0 5px; border-radius: 4px; color: var(--status-color); background: color-mix(in srgb, var(--status-color) 10%, transparent); white-space: nowrap; pointer-events: auto; }
    .pi-enh-attention-notice { position: fixed; z-index: 1200; width: min(370px, calc(100vw - 24px)); box-sizing: border-box; border: 1px solid var(--border, #52525b); border-radius: 10px; padding: 12px; color: var(--text, #eee); background: var(--bg-panel, #27272a); box-shadow: 0 8px 24px #0005; font: 13px/1.5 system-ui; right: 12px; bottom: 20px; border-left: 3px solid #f59e0b; max-height: min(360px, 45dvh); overflow-y: auto; }
    .pi-enh-attention-notice button { cursor: pointer; border: 1px solid var(--border, #52525b); border-radius: 5px; padding: 3px 7px; background: var(--bg-panel, #27272a); color: var(--text, #eee); font: inherit; margin: 8px 6px 0 0; }
    .pi-enh-attention-notice-item { display: flex; align-items: flex-start; gap: 4px; }
    .pi-enh-attention-notice-item [data-attention-notice-session] { flex: 1; min-width: 0; text-align: left; overflow-wrap: anywhere; }
    .pi-enh-attention-notice-item > button:last-child { flex: 0 0 auto; }
    .pi-enh-attention-notice-title { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; overflow-wrap: anywhere; }
    .pi-enh-attention-notice-title { font-weight: 650; }
    .pi-enh-attention-notice-kind { display: block; margin-top: 4px; font-size: 12px; color: #fbbf24; }

    /* ask_user 四题批量原型（仅演示，不连接 Agent） */
    .pi-enh-ask-batch-prototype {
      position: fixed;
      z-index: 96;
      left: 50%;
      bottom: 106px;
      transform: translateX(-50%);
      box-sizing: border-box;
      width: min(920px, calc(100vw - 32px));
      max-height: min(560px, calc(100vh - 156px));
      overflow: auto;
      padding: 16px;
      border: 1px solid color-mix(in srgb, var(--text, #f4f4f5) 30%, var(--border, #3f3f46));
      border-radius: 12px;
      background: #20252f;
      background: color-mix(in srgb, var(--bg, #18181b) 84%, #52637d);
      color: var(--text, #f8fafc);
      box-shadow: 0 16px 36px rgba(0, 0, 0, 0.42), inset 0 1px rgba(255, 255, 255, 0.1);
      font-family: var(--font-sans, system-ui, sans-serif);
      animation: piEnhFadeIn 0.16s ease-out;
    }
    .pi-enh-ask-batch-header,
    .pi-enh-ask-batch-actions {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .pi-enh-ask-batch-header { justify-content: space-between; margin-bottom: 14px; }
    .pi-enh-ask-batch-kicker { color: var(--accent, #7dd3fc); font-size: 12px; font-weight: 750; }
    .pi-enh-ask-batch-title { margin: 2px 0 0; font-size: 16px; letter-spacing: 0.01em; }
    .pi-enh-ask-batch-dismiss,
    .pi-enh-ask-batch-button {
      padding: 8px 12px;
      border: 1px solid color-mix(in srgb, var(--text, #f4f4f5) 24%, var(--border, #3f3f46));
      border-radius: 7px;
      background: color-mix(in srgb, var(--bg-panel, #27272a) 82%, #334155);
      color: var(--text, #f8fafc);
      font-size: 12px;
      font-weight: 650;
      cursor: pointer;
    }
    .pi-enh-ask-batch-dismiss:hover,
    .pi-enh-ask-batch-button:hover:not(:disabled) { border-color: var(--accent, #38bdf8); color: var(--accent, #7dd3fc); }
    .pi-enh-ask-batch-button:disabled { opacity: 0.45; cursor: default; }
    .pi-enh-ask-batch-button-primary { margin-left: auto; border-color: var(--accent, #38bdf8); background: var(--accent, #38bdf8); color: #07131a; }
    .pi-enh-ask-batch-button-primary:hover:not(:disabled) { color: #07131a; filter: brightness(1.08); }
    .pi-enh-ask-batch-progress { display: grid; grid-template-columns: repeat(4, 1fr); gap: 5px; margin-bottom: 16px; }
    .pi-enh-ask-batch-progress-step { height: 4px; border-radius: 999px; background: color-mix(in srgb, var(--border, #3f3f46) 80%, transparent); }
    .pi-enh-ask-batch-progress-step.is-complete { background: color-mix(in srgb, var(--accent, #38bdf8) 66%, #22c55e); }
    .pi-enh-ask-batch-progress-step.is-current { background: var(--accent, #38bdf8); box-shadow: 0 0 8px color-mix(in srgb, var(--accent, #38bdf8) 55%, transparent); }
    .pi-enh-ask-batch-question { margin: 0 0 12px; color: color-mix(in srgb, var(--text, #f4f4f5) 82%, white); font-size: 14px; line-height: 1.55; }
    .pi-enh-ask-batch-context { margin: -5px 0 14px; color: color-mix(in srgb, var(--text, #f4f4f5) 64%, #94a3b8); font-size: 12px; line-height: 1.5; }
    .pi-enh-ask-batch-layout { display: grid; grid-template-columns: minmax(0, 1.08fr) minmax(220px, 0.92fr); gap: 12px; }
    .pi-enh-ask-batch-options { display: grid; gap: 8px; }
    .pi-enh-ask-batch-option {
      width: 100%; display: flex; align-items: flex-start; gap: 10px; padding: 11px 12px;
      border: 1px solid color-mix(in srgb, var(--text, #f4f4f5) 23%, var(--border, #3f3f46)); border-radius: 9px;
      background: color-mix(in srgb, var(--bg-panel, #27272a) 82%, #334155); color: var(--text, #f8fafc); text-align: left; cursor: pointer;
    }
    .pi-enh-ask-batch-option:hover, .pi-enh-ask-batch-option:focus-visible, .pi-enh-ask-batch-option.is-selected { border-color: var(--accent, #38bdf8); outline: none; }
    .pi-enh-ask-batch-option-index { display: grid; flex: 0 0 auto; place-items: center; width: 20px; height: 20px; border: 1px solid #64748b; border-radius: 50%; color: #cbd5e1; font-size: 11px; }
    .pi-enh-ask-batch-option.is-selected .pi-enh-ask-batch-option-index { border-color: var(--accent, #38bdf8); color: var(--accent, #7dd3fc); }
    .pi-enh-ask-batch-option-label { font-size: 13px; font-weight: 700; line-height: 1.45; }
    .pi-enh-ask-batch-detail { min-height: 154px; padding: 13px; border: 1px solid color-mix(in srgb, var(--text, #f4f4f5) 20%, var(--border, #3f3f46)); border-radius: 9px; background: color-mix(in srgb, var(--bg-panel, #27272a) 70%, #475569); }
    .pi-enh-ask-batch-detail-label { margin-bottom: 8px; color: var(--accent, #7dd3fc); font-size: 11px; font-weight: 750; letter-spacing: 0.05em; }
    .pi-enh-ask-batch-detail-title { margin-bottom: 8px; color: var(--text, #f8fafc); font-size: 13px; font-weight: 750; }
    .pi-enh-ask-batch-detail-copy { color: color-mix(in srgb, var(--text, #f4f4f5) 72%, #94a3b8); font-size: 12px; line-height: 1.6; white-space: pre-wrap; }
    .pi-enh-ask-batch-actions { margin-top: 14px; }
    .pi-enh-ask-batch-summary { display: grid; gap: 8px; }
    .pi-enh-ask-batch-summary-row { display: flex; align-items: center; gap: 10px; padding: 10px 11px; border: 1px solid color-mix(in srgb, var(--text, #f4f4f5) 19%, var(--border, #3f3f46)); border-radius: 8px; background: color-mix(in srgb, var(--bg-panel, #27272a) 80%, #334155); }
    .pi-enh-ask-batch-summary-text { flex: 1; min-width: 0; font-size: 12px; line-height: 1.45; }
    .pi-enh-ask-batch-summary-question { color: var(--text, #f8fafc); font-weight: 700; }
    .pi-enh-ask-batch-summary-answer { color: #cbd5e1; }
    @media (max-width: 680px) {
      .pi-enh-ask-batch-prototype { bottom: 94px; width: calc(100vw - 20px); padding: 13px; }
      .pi-enh-ask-batch-layout { grid-template-columns: 1fr; }
      .pi-enh-ask-batch-detail { min-height: auto; }
    }

    /* 快捷操作动作栏与双重保险 (Quick Actions & Fallback Trigger) */
    button[data-pi-enh-quick-reply],
    .pi-enh-cursor-composer button.pi-enh-cursor-send[data-pi-enh-quick-reply] {
      background: var(--accent, #a5c4f2) !important;
      color: var(--bg, #18181b) !important;
      cursor: pointer !important;
      white-space: nowrap !important;
      max-width: min(260px, 55vw) !important;
      width: auto !important;
      min-width: unset !important;
      height: 28px !important;
      padding: 0 10px !important;
      border-radius: 8px !important;
      font-size: 12px !important;
      line-height: 28px !important;
      font-weight: 500 !important;
      overflow: hidden !important;
      text-overflow: ellipsis !important;
      display: inline-flex !important;
      align-items: center !important;
      justify-content: center !important;
      opacity: 1 !important;
    }
    button[data-pi-enh-quick-reply]::before,
    .pi-enh-cursor-composer button.pi-enh-cursor-send[data-pi-enh-quick-reply]::before {
      display: none !important;
      content: none !important;
    }
    .pi-enh-quick-start-button {
      flex: 0 0 auto;
      align-self: center;
      margin-left: 4px;
      padding: 5px 9px;
      border: 1px solid var(--border, #52525b);
      border-radius: 6px;
      background: transparent;
      color: var(--text-muted, #a1a1aa);
      font-size: 12px;
      font-weight: 600;
      line-height: 1.35;
      white-space: nowrap;
      cursor: pointer;
      transition: border-color 0.12s ease, color 0.12s ease, background 0.12s ease, opacity 0.12s ease;
    }
    .pi-enh-quick-start-button:hover,
    .pi-enh-quick-start-button:focus-visible {
      border-color: var(--accent, #38bdf8);
      background: color-mix(in srgb, var(--accent, #38bdf8) 8%, transparent);
      color: var(--accent, #38bdf8);
      outline: none;
    }
    .pi-enh-quick-start-button:active { background: color-mix(in srgb, var(--accent, #38bdf8) 14%, transparent); }
    .pi-enh-quick-start-button:disabled { cursor: default; opacity: 0.55; }

    .pi-enh-quick-fallback-trigger,
    .pi-enh-cursor-composer .pi-enh-quick-fallback-trigger {
      display: none !important;
      width: 0 !important;
      height: 0 !important;
      padding: 0 !important;
      margin: 0 !important;
      overflow: hidden !important;
      pointer-events: none !important;
      visibility: hidden !important;
      opacity: 0 !important;
    }
    .pi-enh-quick-fallback-trigger:hover,
    .pi-enh-quick-fallback-trigger:focus-visible {
      border-color: var(--accent, #38bdf8);
      background: color-mix(in srgb, var(--accent, #38bdf8) 10%, transparent);
      color: var(--accent, #38bdf8);
      outline: none;
    }
    .pi-enh-quick-fallback-trigger:active { transform: scale(0.95); }

    /* 快捷动作暗色气泡菜单 */
    .pi-enh-quick-menu {
      position: absolute;
      right: 0;
      bottom: calc(100% + 6px);
      z-index: 1000;
      display: flex;
      flex-direction: column;
      gap: 3px;
      min-width: 146px;
      padding: 5px;
      border: 1px solid color-mix(in srgb, var(--border, #3f3f46) 80%, rgba(255,255,255,0.15));
      border-radius: 9px;
      background: color-mix(in srgb, var(--bg, #18181b) 88%, #27272a);
      backdrop-filter: blur(14px);
      -webkit-backdrop-filter: blur(14px);
      box-shadow: 0 10px 28px rgba(0,0,0,0.5), 0 2px 8px rgba(0,0,0,0.3);
      animation: piEnhFadeIn 0.12s cubic-bezier(0.16, 1, 0.3, 1);
    }
    .pi-enh-quick-menu-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 7px 11px;
      border: 0;
      border-radius: 6px;
      background: transparent;
      color: var(--text, #f4f4f5);
      font-size: 12px;
      font-weight: 550;
      text-align: left;
      cursor: pointer;
      white-space: nowrap;
      transition: background 0.1s ease, color 0.1s ease;
    }
    .pi-enh-quick-menu-item:hover {
      background: color-mix(in srgb, var(--accent, #38bdf8) 15%, transparent);
      color: var(--accent, #38bdf8);
    }

    .pi-enh-quick-config-editor {
      margin-top: 10px;
      border: 1px solid var(--border, #3f3f46);
      border-radius: 9px;
      background: color-mix(in srgb, var(--bg-panel, #27272a) 84%, transparent);
      overflow: hidden;
    }
    .pi-enh-quick-config-editor > summary {
      padding: 10px 12px;
      cursor: pointer;
      color: var(--text, #f4f4f5);
      font-size: 12px;
      font-weight: 650;
    }
    .pi-enh-quick-config-body { display: grid; gap: 9px; padding: 0 10px 10px; }
    .pi-enh-quick-config-toolbar,
    .pi-enh-quick-config-row-head,
    .pi-enh-quick-config-actions { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; }
    .pi-enh-quick-config-toolbar { justify-content: space-between; color: var(--text-muted, #a1a1aa); font-size: 11px; }
    .pi-enh-quick-config-toolbar > div { display: flex; gap: 6px; flex-wrap: wrap; }
    .pi-enh-quick-config-row { padding: 10px; border: 1px solid color-mix(in srgb, var(--border, #3f3f46) 78%, transparent); border-radius: 8px; background: color-mix(in srgb, var(--bg, #18181b) 75%, transparent); }
    .pi-enh-quick-config-row-head { margin-bottom: 8px; }
    .pi-enh-quick-config-row-head strong { flex: 1; min-width: 100px; color: var(--text, #f4f4f5); font-size: 12px; }
    .pi-enh-quick-config-priority { color: var(--text-dim, #71717a); font-size: 10.5px; }
    .pi-enh-quick-config-enabled { display: inline-flex; align-items: center; gap: 4px; color: var(--text-muted, #a1a1aa); font-size: 11px; }
    .pi-enh-quick-config-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
    .pi-enh-quick-config-grid label { display: grid; gap: 4px; min-width: 0; color: var(--text-muted, #a1a1aa); font-size: 10.5px; }
    .pi-enh-quick-config-grid .pi-enh-quick-config-condition { grid-column: 1 / -1; }
    .pi-enh-quick-config-grid input,
    .pi-enh-quick-config-grid select,
    .pi-enh-quick-config-grid textarea { width: 100%; box-sizing: border-box; padding: 6px 7px; border: 1px solid var(--border, #3f3f46); border-radius: 6px; background: var(--bg, #18181b); color: var(--text, #f4f4f5); font: inherit; resize: vertical; }
    .pi-enh-quick-config-actions { margin-top: 8px; justify-content: flex-end; }
    .pi-enh-quick-config-empty { padding: 12px; color: var(--text-muted, #a1a1aa); font-size: 11.5px; text-align: center; }
    @media (max-width: 680px) {
      .pi-enh-quick-config-grid { grid-template-columns: 1fr; }
      .pi-enh-quick-config-grid .pi-enh-quick-config-condition { grid-column: auto; }
      .pi-enh-quick-config-toolbar { align-items: flex-start; flex-direction: column; }
    }

    /* 回到底部悬浮快捷按钮 (Scroll-to-Bottom Button - Codex 风格) */
    /* Enhancement owns this action only while its control exists; off/dispose restores native CSS. */
    .chat-content:has(> .pi-enh-scroll-bottom-btn) .chat-scroll-to-bottom { display: none; }
    .pi-enh-scroll-bottom-btn {
      position: absolute;
      left: 50%;
      bottom: 96px;
      transform: translateX(-50%) translateY(8px);
      z-index: 35;
      width: 36px;
      height: 36px;
      border-radius: 50%;
      background: color-mix(in srgb, var(--bg, #18181b) 84%, #27272a);
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
      border: 1px solid color-mix(in srgb, var(--border, #3f3f46) 75%, rgba(255, 255, 255, 0.16));
      color: var(--text, #f4f4f5);
      box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35), 0 1px 3px rgba(0, 0, 0, 0.2);
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.2s cubic-bezier(0.16, 1, 0.3, 1), transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), background 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease;
      user-select: none;
      -webkit-user-select: none;
      padding: 0;
      outline: none;
    }
    .pi-enh-scroll-bottom-btn.visible {
      opacity: 1;
      pointer-events: auto;
      transform: translateX(-50%) translateY(0);
    }
    .pi-enh-scroll-bottom-btn:hover {
      background: color-mix(in srgb, var(--bg, #27272a) 60%, var(--accent, #38bdf8));
      border-color: color-mix(in srgb, var(--accent, #38bdf8) 60%, var(--border, #52525b));
      color: #ffffff;
      box-shadow: 0 6px 20px rgba(0, 0, 0, 0.45);
      transform: translateX(-50%) translateY(-2px);
    }
    .pi-enh-scroll-bottom-btn:active {
      transform: translateX(-50%) translateY(1px) scale(0.95);
    }
    .pi-enh-scroll-bottom-btn svg {
      width: 18px;
      height: 18px;
      display: block;
      pointer-events: none;
      transition: transform 0.15s ease;
    }

    /* 当模型选择器或任何下拉列表打开时，回到底部按钮绝不得挡在菜单前面 */
    body:has(div[role="listbox"]) .pi-enh-scroll-bottom-btn,
    body:has([data-pi-thinking-control] div[style*="position"]) .pi-enh-scroll-bottom-btn,
    .chat-content:has(div[role="listbox"]) .pi-enh-scroll-bottom-btn,
    .chat-content:has([data-pi-thinking-control] div[style*="position"]) .pi-enh-scroll-bottom-btn,
    body:has(div[role="listbox"]) .chat-scroll-to-bottom,
    body:has([data-pi-thinking-control] div[style*="position"]) .chat-scroll-to-bottom,
    .chat-content:has(div[role="listbox"]) .chat-scroll-to-bottom,
    .chat-content:has([data-pi-thinking-control] div[style*="position"]) .chat-scroll-to-bottom {
      opacity: 0 !important;
      pointer-events: none !important;
      z-index: 1 !important;
    }
    .pi-enh-scroll-bottom-btn:hover svg {
      transform: translateY(1px);
    }

    /* Local Path Launcher */
    .pi-enh-path-actions {
      display: inline-flex;
      align-items: center;
      gap: 2px;
      margin-left: 5px;
      margin-right: 2px;
      vertical-align: middle;
      user-select: none;
      white-space: nowrap;
    }
    .pi-enh-path-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 20px;
      height: 20px;
      border-radius: 4px;
      border: 1px solid var(--border, #3f3f46);
      background: var(--bg-card, rgba(39, 39, 42, 0.7));
      color: var(--text, #e4e4e7);
      cursor: pointer;
      font-size: 11px;
      line-height: 1;
      padding: 0;
      transition: all 0.15s ease;
      box-shadow: 0 1px 2px rgba(0,0,0,0.15);
    }
    .pi-enh-path-btn:hover {
      background: var(--bg-hover, #52525b);
      border-color: #a1a1aa;
      transform: translateY(-1px);
    }
    .pi-enh-path-btn:active {
      transform: translateY(0);
    }
    .pi-enh-path-btn.flashed {
      background: #16a34a !important;
      border-color: #22c55e !important;
      color: #ffffff !important;
    }

    /* Composer Draft Cache */
    .pi-enh-draft-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      border-radius: 6px;
      font-size: 12px;
      color: var(--accent, #38bdf8);
      background: color-mix(in srgb, var(--accent, #38bdf8) 12%, transparent);
      border: 1px solid color-mix(in srgb, var(--accent, #38bdf8) 30%, transparent);
      margin-bottom: 8px;
      animation: piEnhFadeIn 0.2s ease-out;
      width: fit-content;
      user-select: none;
    }
    .pi-enh-draft-badge button {
      background: none;
      border: none;
      color: var(--text-muted, #94a3b8);
      cursor: pointer;
      font-size: 11px;
      text-decoration: underline;
      padding: 0 4px;
      margin-left: 4px;
    }
    .pi-enh-draft-badge button:hover {
      color: var(--danger, #ef4444);
    }

    /* Composer File Paste & Drop */
    .pi-enh-composer-drop-active {
      outline: 2px dashed var(--accent, #3b82f6) !important;
      outline-offset: -2px !important;
      background: color-mix(in srgb, var(--accent, #3b82f6) 12%, transparent) !important;
      transition: outline 0.15s ease, background 0.15s ease !important;
    }
    .pi-enh-attachments-bar {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-bottom: 8px;
      z-index: 10;
      width: 100%;
    }
    .pi-enh-attachment-card {
      position: relative;
      display: inline-flex;
      align-items: center;
      gap: 10px;
      padding: 7px 12px 7px 10px;
      background: color-mix(in srgb, var(--bg-panel, #27272a) 85%, var(--bg, #18181b));
      border: 1px solid var(--border, rgba(255, 255, 255, 0.12));
      border-radius: 12px;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.18);
      user-select: none;
      max-width: 320px;
      transition: transform 0.15s ease, border-color 0.15s ease;
      animation: piEnhFadeIn 0.2s cubic-bezier(0.16, 1, 0.3, 1);
    }
    .pi-enh-attachment-card:hover {
      border-color: color-mix(in srgb, var(--accent, #3b82f6) 40%, var(--border));
    }
    .pi-enh-attachment-card-video {
      cursor: pointer;
    }
    .pi-enh-attachment-card-video:hover {
      border-color: color-mix(in srgb, #8b5cf6 55%, var(--border));
      transform: translateY(-1px);
    }
    .pi-enh-attachment-icon-wrap {
      position: relative;
      width: 32px;
      height: 32px;
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      overflow: hidden;
    }
    .pi-enh-attachment-icon-video {
      width: 36px;
      height: 36px;
      background: #09090b;
      border: 1px solid rgba(139, 92, 246, 0.38);
    }
    .pi-enh-attachment-video-thumb {
      width: 100%;
      height: 100%;
      object-fit: cover;
      border-radius: 7px;
      display: block;
      background: #09090b;
      pointer-events: none;
    }
    .pi-enh-attachment-video-play-badge {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(9, 9, 11, 0.38);
      color: #ffffff;
      border-radius: 7px;
      pointer-events: none;
    }
    .pi-enh-attachment-meta {
      display: flex;
      flex-direction: column;
      min-width: 0;
      overflow: hidden;
    }
    .pi-enh-attachment-name {
      font-size: 13px;
      font-weight: 500;
      color: var(--text, #f4f4f5);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      line-height: 1.35;
      max-width: 220px;
    }
    .pi-enh-attachment-desc {
      font-size: 11px;
      color: var(--text-dim, #a1a1aa);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      line-height: 1.3;
    }
    .pi-enh-attachment-remove {
      position: absolute;
      top: -5px;
      right: -5px;
      width: 17px;
      height: 17px;
      border-radius: 50%;
      background: var(--bg-panel, #27272a);
      border: 1px solid var(--border, rgba(255, 255, 255, 0.25));
      color: var(--text-muted, #94a3b8);
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      padding: 0;
      font-size: 12px;
      line-height: 1;
      transition: background 0.15s ease, color 0.15s ease, transform 0.15s ease;
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
    }
    .pi-enh-attachment-remove:hover {
      background: #ef4444;
      border-color: #ef4444;
      color: #ffffff;
      transform: scale(1.1);
    }

    /* 用户消息气泡内全生命周期附件卡片 */
    .pi-enh-message-attachments {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-bottom: 8px;
      width: 100%;
    }
    .pi-enh-msg-attachment-pill {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      padding: 7px 12px 7px 10px;
      background: color-mix(in srgb, var(--bg-panel, #27272a) 90%, transparent);
      border: 1px solid var(--border, rgba(255, 255, 255, 0.15));
      border-radius: 12px;
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.16);
      max-width: 100%;
      cursor: pointer;
      user-select: none;
      transition: all 0.15s ease;
      text-decoration: none;
      box-sizing: border-box;
    }
    .pi-enh-msg-attachment-pill:hover {
      background: color-mix(in srgb, var(--bg-panel, #27272a) 95%, var(--accent, #3b82f6) 10%);
      border-color: color-mix(in srgb, var(--accent, #3b82f6) 50%, var(--border, rgba(255, 255, 255, 0.2)));
      transform: translateY(-1px);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.22);
    }
    .pi-enh-msg-attachment-icon {
      position: relative;
      width: 32px;
      height: 32px;
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      overflow: hidden;
    }
    .pi-enh-msg-attachment-meta {
      display: flex;
      flex-direction: column;
      min-width: 0;
      flex: 1;
    }
    .pi-enh-msg-attachment-name {
      font-size: 13px;
      font-weight: 500;
      color: var(--text, #f4f4f5);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 240px;
      line-height: 1.3;
    }
    .pi-enh-msg-attachment-desc {
      font-size: 11px;
      color: var(--text-dim, #a1a1aa);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      line-height: 1.25;
    }
    .pi-enh-msg-attachment-actions {
      display: flex;
      align-items: center;
      gap: 4px;
      margin-left: 4px;
      flex-shrink: 0;
    }
    .pi-enh-msg-attachment-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 24px;
      height: 24px;
      border-radius: 5px;
      background: transparent;
      border: none;
      color: var(--text-dim, #a1a1aa);
      cursor: pointer;
      transition: all 0.12s ease;
      padding: 0;
    }
    .pi-enh-msg-attachment-btn:hover {
      background: color-mix(in srgb, var(--text, #fff) 10%, transparent);
      color: var(--accent, #3b82f6);
    }
    .pi-enh-msg-attachment-hidden-mark {
      display: none !important;
    }

    /* 内嵌高清视频播放器模态预览弹窗 */
    .pi-enh-video-preview-backdrop {
      position: fixed;
      inset: 0;
      z-index: 2147483645;
      background: rgba(9, 9, 11, 0.82);
      backdrop-filter: blur(8px);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
      box-sizing: border-box;
      animation: piEnhFadeIn 0.16s ease;
    }
    .pi-enh-video-preview-backdrop[style*="display: none"],
    .pi-enh-video-preview-backdrop[hidden] {
      display: none !important;
    }
    .pi-enh-video-preview-modal {
      width: min(960px, 94vw);
      max-height: 90vh;
      background: var(--bg-panel, #18181b);
      border: 1px solid var(--border, rgba(255, 255, 255, 0.16));
      border-radius: 14px;
      box-shadow: 0 24px 64px rgba(0, 0, 0, 0.65);
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .pi-enh-video-preview-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 12px 16px;
      border-bottom: 1px solid var(--border, rgba(255, 255, 255, 0.1));
      background: color-mix(in srgb, var(--bg-panel, #18181b) 92%, #000000);
    }
    .pi-enh-video-preview-title-wrap {
      display: flex;
      flex-direction: column;
      min-width: 0;
      flex: 1;
    }
    .pi-enh-video-preview-title {
      font-size: 14px;
      font-weight: 600;
      color: var(--text, #f4f4f5);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      line-height: 1.35;
    }
    .pi-enh-video-preview-subtitle {
      font-size: 11.5px;
      color: var(--text-dim, #a1a1aa);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      line-height: 1.25;
    }
    .pi-enh-video-preview-actions {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-shrink: 0;
    }
    .pi-enh-video-preview-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      height: 30px;
      padding: 0 12px;
      border-radius: 8px;
      border: 1px solid var(--border, rgba(255, 255, 255, 0.16));
      background: color-mix(in srgb, var(--bg-panel, #27272a) 80%, transparent);
      color: var(--text, #f4f4f5);
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.14s ease;
    }
    .pi-enh-video-preview-btn:hover {
      background: color-mix(in srgb, var(--accent, #8b5cf6) 22%, var(--bg-panel, #27272a));
      border-color: color-mix(in srgb, var(--accent, #8b5cf6) 55%, var(--border));
      color: #ffffff;
    }
    .pi-enh-video-preview-close {
      width: 30px;
      padding: 0;
      font-size: 18px;
      line-height: 1;
    }
    .pi-enh-video-preview-close:hover {
      background: #ef4444;
      border-color: #ef4444;
      color: #ffffff;
    }
    .pi-enh-video-preview-body {
      position: relative;
      background: #000000;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 260px;
      max-height: calc(90vh - 60px);
      overflow: hidden;
    }
    .pi-enh-video-preview-player {
      width: 100%;
      max-height: calc(90vh - 60px);
      outline: none;
      display: block;
      background: #000000;
    }

    /* 底栏“压缩上下文”按钮显隐控制（默认隐藏，可在增强插件中开启） */
    html.pi-enh-hide-composer-compact [data-pi-enh-composer-compact="true"],
    html.pi-enh-hide-composer-compact [data-pi-enh-composer-compact-wrap="true"],
    html.pi-enh-hide-composer-compact fieldset button[title*="压缩上下文"],
    html.pi-enh-hide-composer-compact fieldset button[aria-label*="压缩上下文"],
    html.pi-enh-hide-composer-compact fieldset button[title*="Compact context" i],
    html.pi-enh-hide-composer-compact fieldset button[aria-label*="Compact context" i],
    html.pi-enh-hide-composer-compact fieldset button:has(svg polyline[points*="4 14 10 14"]),
    html.pi-enh-hide-composer-compact fieldset div:has(> button[title*="压缩上下文"]),
    html.pi-enh-hide-composer-compact fieldset div:has(> button[aria-label*="压缩上下文"]),
    html.pi-enh-hide-composer-compact fieldset div:has(> button[title*="Compact context" i]),
    html.pi-enh-hide-composer-compact fieldset div:has(> button[aria-label*="Compact context" i]) {
      display: none !important;
    }

    /* 底栏“工具预设 (default)”按钮显隐控制（默认隐藏，可在增强插件中开启） */
    html.pi-enh-hide-composer-tool-preset [data-pi-enh-composer-tool-preset="true"],
    html.pi-enh-hide-composer-tool-preset [data-pi-enh-composer-tool-preset-wrap="true"],
    html.pi-enh-hide-composer-tool-preset fieldset button[title*="工具预设"],
    html.pi-enh-hide-composer-tool-preset fieldset button[aria-label*="工具预设"],
    html.pi-enh-hide-composer-tool-preset fieldset button[title*="tool preset" i],
    html.pi-enh-hide-composer-tool-preset fieldset button[aria-label*="tool preset" i],
    html.pi-enh-hide-composer-tool-preset fieldset button:has(svg path[d*="M14.7 6.3"]),
    html.pi-enh-hide-composer-tool-preset fieldset div:has(> button[title*="工具预设"]),
    html.pi-enh-hide-composer-tool-preset fieldset div:has(> button[aria-label*="工具预设"]),
    html.pi-enh-hide-composer-tool-preset fieldset div:has(> button[title*="tool preset" i]),
    html.pi-enh-hide-composer-tool-preset fieldset div:has(> button[aria-label*="tool preset" i]) {
      display: none !important;
    }

    /* Composer Image Zoom & Pan */
    .pi-enh-composer-zoomable-img {
      cursor: zoom-in !important;
      transition: transform 0.15s ease, box-shadow 0.15s ease !important;
    }
    .pi-enh-composer-zoomable-img:hover {
      transform: scale(1.04);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.35) !important;
    }
    .pi-enh-dblclick-zoomable {
      cursor: zoom-in;
    }
    #file-panel img.pi-enh-dblclick-zoomable,
    .right-panel-container img.pi-enh-dblclick-zoomable {
      cursor: zoom-in !important;
      transition: opacity 0.15s ease, filter 0.15s ease;
    }
    #file-panel img.pi-enh-dblclick-zoomable:hover,
    .right-panel-container img.pi-enh-dblclick-zoomable:hover {
      filter: brightness(1.06);
    }
    dialog.pi-enh-image-zoom-dialog {
      z-index: 999999 !important;
      user-select: none;
    }
    .image-preview-image.pi-enh-zoomable {
      transition: transform 0.08s ease-out;
      user-select: none;
      -webkit-user-drag: none;
      cursor: grab;
      max-width: 90vw !important;
      max-height: 85vh !important;
    }
    .image-preview-image.pi-enh-zoomable.is-dragging {
      cursor: grabbing !important;
      transition: none !important;
    }
    .pi-enh-zoom-toolbar {
      position: absolute;
      bottom: max(20px, env(safe-area-inset-bottom));
      left: 50%;
      transform: translateX(-50%);
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 5px 12px;
      background: var(--bg-panel, #27272a);
      border: 1px solid var(--border, rgba(255, 255, 255, 0.15));
      border-radius: 9999px;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
      z-index: 10;
      font-size: 12px;
      font-family: var(--font-mono, monospace);
      color: var(--text, #f4f4f5);
      backdrop-filter: blur(8px);
      white-space: nowrap;
      max-width: calc(100vw - 24px);
    }
    .pi-enh-zoom-btn {
      background: none;
      border: none;
      color: var(--text-muted, #a1a1aa);
      cursor: pointer;
      padding: 3px 8px;
      border-radius: 6px;
      font-size: 13px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      transition: all 0.15s ease;
      white-space: nowrap;
      flex-shrink: 0;
      min-width: max-content;
    }
    .pi-enh-zoom-btn:hover {
      background: var(--bg-hover, rgba(255, 255, 255, 0.1));
      color: var(--text, #ffffff);
    }
    .pi-enh-zoom-indicator {
      min-width: 44px;
      text-align: center;
      font-size: 11px;
      color: var(--text-dim, #71717a);
      user-select: none;
      cursor: pointer;
      white-space: nowrap;
      flex-shrink: 0;
    }
    .pi-enh-zoom-indicator:hover {
      color: var(--accent, #3b82f6);
    }

    /* Composer Gallery Navigation */
    .pi-enh-gallery-counter {
      position: absolute;
      top: max(16px, env(safe-area-inset-top));
      left: 50%;
      transform: translateX(-50%);
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 5px 14px;
      background: rgba(18, 18, 22, 0.9) !important;
      border: 1px solid rgba(255, 255, 255, 0.3) !important;
      border-radius: 9999px;
      color: #ffffff !important;
      font-size: 13px;
      font-weight: 600;
      letter-spacing: 0.02em;
      backdrop-filter: blur(12px);
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.55);
      z-index: 25;
      user-select: none;
      pointer-events: none;
      white-space: nowrap;
      transition: opacity 0.15s ease;
    }
    .pi-enh-gallery-nav-btn {
      position: absolute;
      top: 50%;
      transform: translateY(-50%);
      width: 44px;
      height: 44px;
      border-radius: 50%;
      background: rgba(18, 18, 22, 0.85) !important;
      border: 1px solid rgba(255, 255, 255, 0.25) !important;
      color: #ffffff !important;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      z-index: 25;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.55);
      backdrop-filter: blur(10px);
      transition: background 0.15s ease, opacity 0.15s ease, transform 0.15s ease, border-color 0.15s ease;
      user-select: none;
      touch-action: manipulation;
    }
    .pi-enh-gallery-nav-btn:hover:not(:disabled) {
      background: rgba(39, 39, 42, 0.98) !important;
      border-color: var(--accent, #3b82f6) !important;
      transform: translateY(-50%) scale(1.08);
      color: #ffffff !important;
    }
    .pi-enh-gallery-nav-btn:active:not(:disabled) {
      transform: translateY(-50%) scale(0.95);
    }
    .pi-enh-gallery-nav-btn:disabled {
      opacity: 0.22;
      cursor: not-allowed;
      pointer-events: none;
    }
    .pi-enh-gallery-nav-btn.is-prev {
      left: max(16px, env(safe-area-inset-left));
    }
    .pi-enh-gallery-nav-btn.is-next {
      right: max(16px, env(safe-area-inset-right));
    }
    dialog.pi-enh-image-zoom-dialog.is-editing .pi-enh-gallery-counter,
    dialog.pi-enh-image-zoom-dialog.is-editing .pi-enh-gallery-nav-btn {
      z-index: 35;
    }
    @media (max-width: 600px) {
      .pi-enh-gallery-counter {
        top: max(12px, env(safe-area-inset-top));
        font-size: 12px;
        padding: 4px 10px;
      }
      .pi-enh-gallery-nav-btn {
        width: 38px;
        height: 38px;
      }
      .pi-enh-gallery-nav-btn.is-prev {
        left: max(8px, env(safe-area-inset-left));
      }
      .pi-enh-gallery-nav-btn.is-next {
        right: max(8px, env(safe-area-inset-right));
      }
    }
    dialog.pi-enh-image-zoom-dialog.is-editing {
      position: fixed;
      overflow: hidden;
      padding: 0 !important;
    }
    dialog.pi-enh-image-zoom-dialog.is-editing .image-preview-close {
      z-index: 40;
    }
    .pi-enh-image-editor {
      position: absolute;
      inset: 0;
      z-index: 30;
      display: grid;
      grid-template-rows: minmax(0, 1fr) auto;
      min-width: 0;
      min-height: 0;
      background: rgba(9, 9, 11, 0.96);
      color: var(--text, #f4f4f5);
      touch-action: none;
    }
    .pi-enh-image-editor-stage {
      position: relative;
      min-width: 0;
      min-height: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
      padding: max(48px, env(safe-area-inset-top)) 12px 10px;
      touch-action: none;
    }
    .pi-enh-annotation-canvas {
      display: block;
      width: auto;
      height: auto;
      max-width: 100%;
      max-height: 100%;
      border-radius: 6px;
      background: #ffffff;
      box-shadow: 0 8px 28px rgba(0, 0, 0, 0.48);
      cursor: crosshair;
      touch-action: none;
      user-select: none;
      -webkit-user-select: none;
    }
    .pi-enh-image-editor-controls {
      display: grid;
      gap: 7px;
      padding: 8px 10px max(8px, env(safe-area-inset-bottom));
      border-top: 1px solid var(--border, rgba(255, 255, 255, 0.16));
      background: color-mix(in srgb, var(--bg-panel, #27272a) 94%, transparent);
      backdrop-filter: blur(12px);
    }
    .pi-enh-image-editor-tools,
    .pi-enh-image-editor-actions {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      min-width: 0;
    }
    .pi-enh-image-editor-tools {
      overflow-x: auto;
      overscroll-behavior-x: contain;
      scrollbar-width: none;
    }
    .pi-enh-image-editor-tools::-webkit-scrollbar { display: none; }
    .pi-enh-image-editor-btn,
    .pi-enh-image-editor-width,
    .pi-enh-image-editor-color {
      min-height: 38px;
      border: 1px solid var(--border, rgba(255, 255, 255, 0.18));
      border-radius: 8px;
      background: var(--bg-panel, #27272a);
      color: var(--text, #f4f4f5);
      cursor: pointer;
      font: 600 12px/1 system-ui, sans-serif;
      white-space: nowrap;
      touch-action: manipulation;
    }
    .pi-enh-image-editor-btn { padding: 0 11px; }
    .pi-enh-image-editor-btn.is-active,
    .pi-enh-image-editor-width.is-active {
      border-color: var(--accent, #3b82f6);
      color: var(--accent, #60a5fa);
      background: color-mix(in srgb, var(--accent, #3b82f6) 14%, var(--bg-panel, #27272a));
    }
    .pi-enh-image-editor-btn.is-primary {
      border-color: var(--accent, #3b82f6);
      background: var(--accent, #2563eb);
      color: #ffffff;
    }
    .pi-enh-image-editor-btn.is-crop-confirm {
      border-color: #10b981 !important;
      background: #059669 !important;
      color: #ffffff !important;
      font-weight: 700 !important;
    }
    .pi-enh-image-editor-btn:disabled,
    .pi-enh-image-editor-width:disabled { opacity: 0.42; cursor: default; }
    .pi-enh-image-editor-color {
      flex: 0 0 32px;
      width: 32px;
      min-height: 32px;
      padding: 0;
      border-radius: 50%;
      box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.28);
    }
    .pi-enh-image-editor-color.is-active {
      outline: 2px solid var(--accent, #60a5fa);
      outline-offset: 2px;
    }
    .pi-enh-image-editor-width {
      min-width: 34px;
      min-height: 34px;
      padding: 0 7px;
    }
    .pi-enh-image-editor-status {
      min-height: 16px;
      color: var(--text-dim, #a1a1aa);
      font-size: 11px;
      line-height: 16px;
      text-align: center;
    }
    /* 顶部悬浮控制堆叠容器 (HUD Container) - 物理级彻底避免重叠冲突 */
    .pi-enh-image-editor-top-hud {
      position: absolute;
      top: max(10px, env(safe-area-inset-top));
      left: 50%;
      transform: translateX(-50%);
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
      z-index: 50;
      max-width: calc(100vw - 20px);
      width: max-content;
      pointer-events: none;
      box-sizing: border-box;
      user-select: none;
      -webkit-user-select: none;
    }

    /* 粗细指示器 HUD (浮动药丸) - 自然排在指引卡片下方，绝不遮挡文字 */
    .pi-enh-image-thickness-hud {
      position: relative;
      top: auto;
      left: auto;
      transform: translateY(-4px);
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 5px 13px;
      border-radius: 999px;
      background: rgba(18, 18, 22, 0.94);
      border: 1px solid rgba(255, 255, 255, 0.22);
      box-shadow: 0 6px 20px rgba(0, 0, 0, 0.6);
      color: #f4f4f5;
      font: 600 12.5px system-ui, -apple-system, sans-serif;
      pointer-events: none;
      opacity: 0;
      visibility: hidden;
      transition: opacity 0.16s ease, transform 0.16s ease, visibility 0.16s;
      user-select: none;
      -webkit-user-select: none;
      flex-shrink: 0;
    }
    .pi-enh-image-thickness-hud.is-visible {
      opacity: 1;
      visibility: visible;
      transform: translateY(0);
    }
    .pi-enh-hud-dot {
      display: inline-block;
      border-radius: 50%;
      background: #ef4444;
      box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.4);
      flex-shrink: 0;
      transition: width 0.08s ease, height 0.08s ease;
    }
    /* 顶部快捷功能指引提示卡片 */
    .pi-enh-image-editor-tips {
      position: relative;
      top: auto;
      left: auto;
      transform: none;
      display: inline-flex;
      align-items: center;
      gap: 10px;
      padding: 6px 14px 6px 14px;
      border-radius: 999px;
      background: rgba(20, 20, 24, 0.94);
      border: 1px solid rgba(255, 255, 255, 0.18);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      box-shadow: 0 8px 26px rgba(0, 0, 0, 0.55);
      color: #e4e4e7;
      font: 500 12px/1.4 system-ui, -apple-system, sans-serif;
      max-width: calc(100vw - 24px);
      box-sizing: border-box;
      transition: opacity 0.22s ease, transform 0.22s ease, visibility 0.22s;
      pointer-events: auto;
      user-select: none;
      -webkit-user-select: none;
      flex-shrink: 0;
    }
    .pi-enh-image-editor-tips.is-hidden {
      display: none !important;
    }
    .pi-enh-tips-body {
      display: flex;
      align-items: center;
      gap: 6px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .pi-enh-tips-icon {
      font-size: 14px;
      flex-shrink: 0;
      line-height: 1;
    }
    .pi-enh-tips-content {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 3px;
      line-height: 1.25;
      text-align: center;
    }
    .pi-enh-tips-content.is-desktop {
      flex-direction: row;
      gap: 6px;
    }
    .pi-enh-tips-row {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      white-space: nowrap;
    }
    .pi-enh-tips-row-actions {
      font-size: 11.5px;
      font-weight: 550;
      color: #f4f4f5;
    }
    .pi-enh-tips-action-item {
      display: inline-flex;
      align-items: center;
      gap: 2px;
    }
    .pi-enh-tips-badge {
      display: inline-flex;
      align-items: center;
      padding: 1px 5px;
      border-radius: 4px;
      background: rgba(56, 189, 248, 0.16);
      border: 1px solid rgba(56, 189, 248, 0.35);
      color: #38bdf8;
      font-size: 10px;
      font-weight: 600;
      letter-spacing: -0.01em;
    }
    .pi-enh-tips-divider {
      color: rgba(255, 255, 255, 0.35);
      font-weight: 400;
      font-size: 10px;
    }
    .pi-enh-tips-row-meta {
      font-size: 10.5px;
      color: #a1a1aa;
      font-weight: 450;
    }
    .pi-enh-tips-meta-label {
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }
    .pi-enh-tips-highlight {
      color: #38bdf8;
      font-weight: 600;
    }
    .pi-enh-tips-close {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 20px;
      height: 20px;
      padding: 0;
      border: none;
      border-radius: 50%;
      background: rgba(255, 255, 255, 0.12);
      color: #a1a1aa;
      font-size: 11px;
      font-weight: 700;
      cursor: pointer;
      flex-shrink: 0;
      transition: background 0.12s, color 0.12s, transform 0.12s;
      line-height: 1;
    }
    .pi-enh-tips-close:hover {
      background: rgba(255, 255, 255, 0.26);
      color: #ffffff;
      transform: scale(1.08);
    }
    .pi-enh-tips-close:active {
      transform: scale(0.92);
    }
    @media (max-width: 600px) {
      .pi-enh-image-editor-tips {
        border-radius: 12px;
        padding: 6px 10px 6px 12px;
        gap: 8px;
        font-size: 11px;
        max-width: calc(100vw - 16px);
      }
      .pi-enh-tips-body {
        font-size: 11px;
        white-space: normal;
        overflow: visible;
      }
      .pi-enh-tips-close {
        width: 20px;
        height: 20px;
        font-size: 10px;
      }
    }
    @media (max-width: 600px) {
      .pi-enh-image-editor-stage { padding-inline: 6px; }
      .pi-enh-image-editor-controls { gap: 6px; padding-inline: 7px; }
      .pi-enh-image-editor-tools,
      .pi-enh-image-editor-actions { justify-content: flex-start; }
      .pi-enh-image-editor-actions .is-primary { margin-left: auto; }
      .pi-enh-image-editor-btn { min-height: 42px; padding-inline: 10px; }
      .pi-enh-image-editor-color { flex-basis: 34px; width: 34px; min-height: 34px; }
    }

    /* 图片编辑退出保存确认浮层 */
    .pi-enh-image-confirm-overlay {
      position: absolute;
      inset: 0;
      z-index: 60;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(0, 0, 0, 0.72);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      padding: 16px;
      animation: pi-enh-fade-in 0.15s ease-out;
    }
    .pi-enh-image-confirm-card {
      background: rgba(24, 24, 27, 0.96) !important;
      border: 1px solid rgba(255, 255, 255, 0.16) !important;
      border-radius: 12px;
      box-shadow: 0 20px 48px rgba(0, 0, 0, 0.75);
      padding: 22px 24px 20px;
      width: 100%;
      max-width: 360px;
      display: flex;
      flex-direction: column;
      gap: 12px;
      color: #f4f4f5 !important;
      text-align: center;
      box-sizing: border-box;
    }
    .pi-enh-image-confirm-title {
      font-size: 15px;
      font-weight: 600;
      line-height: 1.4;
      color: #f4f4f5 !important;
    }
    .pi-enh-image-confirm-hint {
      font-size: 12px;
      color: #a1a1aa !important;
      line-height: 1.5;
    }
    .pi-enh-image-confirm-hint kbd {
      display: inline-block;
      padding: 1px 6px;
      font-size: 11px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-weight: 600;
      border-radius: 4px;
      background: rgba(255, 255, 255, 0.12);
      border: 1px solid rgba(255, 255, 255, 0.22);
      color: #ffffff !important;
      margin: 0 2px;
    }
    .pi-enh-image-confirm-actions {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin-top: 4px;
    }
    .pi-enh-image-confirm-btn {
      min-height: 38px;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 0 16px;
      transition: background 0.15s ease, opacity 0.15s ease, border-color 0.15s ease;
      touch-action: manipulation;
    }
    .pi-enh-image-confirm-btn.is-save {
      background: var(--accent, #2563eb) !important;
      color: #ffffff !important;
      border: 1px solid var(--accent, #3b82f6) !important;
    }
    .pi-enh-image-confirm-btn.is-save:hover {
      background: #1d4ed8 !important;
    }
    .pi-enh-image-confirm-btn.is-discard {
      background: rgba(239, 68, 68, 0.16) !important;
      color: #f87171 !important;
      border: 1px solid rgba(239, 68, 68, 0.35) !important;
    }
    .pi-enh-image-confirm-btn.is-discard:hover {
      background: rgba(239, 68, 68, 0.26) !important;
    }
    .pi-enh-image-confirm-btn.is-cancel {
      background: transparent !important;
      color: #71717a !important;
      border: 1px solid transparent !important;
      font-size: 12px;
      font-weight: 500;
      min-height: 32px;
    }
    .pi-enh-image-confirm-btn.is-cancel:hover {
      color: #a1a1aa !important;
      background: rgba(255, 255, 255, 0.06) !important;
    }
    @media (max-width: 600px) {
      .pi-enh-image-confirm-card {
        padding: 20px 18px 18px;
        border-radius: 14px;
      }
      .pi-enh-image-confirm-btn {
        min-height: 44px;
        font-size: 14px;
      }
      .image-preview-close {
        top: max(12px, env(safe-area-inset-top)) !important;
        right: max(12px, env(safe-area-inset-right)) !important;
        width: 38px !important;
        height: 38px !important;
        display: inline-flex !important;
        align-items: center !important;
        justify-content: center !important;
      }
    }

    /* Markdown 笔记预览模式增强开关 */
    .pi-enh-md-mode-switch {
      display: inline-flex;
      align-items: center;
      background: var(--bg-panel, #27272a);
      border: 1px solid var(--border, rgba(255, 255, 255, 0.1));
      border-radius: 6px;
      padding: 2px;
      gap: 2px;
      margin-right: 6px;
      font-size: 11px;
    }
    .pi-enh-md-btn {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 8px;
      border: none;
      border-radius: 4px;
      background: transparent;
      color: var(--text-muted, #a1a1aa);
      font-size: 11px;
      font-weight: 500;
      cursor: pointer;
      transition: background 0.15s ease, color 0.15s ease;
      line-height: 18px;
    }
    .pi-enh-md-btn:hover {
      background: var(--bg-hover, rgba(255, 255, 255, 0.08));
      color: var(--text, #f4f4f5);
    }
    .pi-enh-md-btn.is-active {
      background: var(--bg-selected, rgba(96, 165, 250, 0.18));
      color: var(--accent, #60a5fa);
      font-weight: 600;
    }
    .pi-enh-md-btn.pi-enh-md-copy:hover {
      background: var(--bg-hover, rgba(255, 255, 255, 0.08));
      color: var(--accent, #60a5fa);
    }
    .pi-enh-md-btn.pi-enh-md-copy.is-copied {
      background: rgba(34, 197, 94, 0.18) !important;
      color: #22c55e !important;
      font-weight: 600;
    }
    .pi-enh-md-btn.pi-enh-md-copy {
      padding: 2px 7px;
      justify-content: center;
    }
    .pi-enh-md-btn.pi-enh-md-copy svg {
      pointer-events: none;
    }
    .file-viewer-shell:has(.pi-enh-md-mode-switch) .file-viewer-mode-switch {
      display: none !important;
    }

    /* ==========================================================================
       Excel Sheet Interactive Preview (Excel 在线交互表格预览)
       ========================================================================== */
    .pi-enh-excel-container {
      display: flex;
      flex-direction: column;
      width: 100%;
      height: 100%;
      background: var(--bg-panel, #18181b);
      color: var(--text, #f4f4f5);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      overflow: hidden;
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      z-index: 10;
    }
    .pi-enh-excel-toolbar {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 6px 14px;
      background: var(--bg, #09090b);
      border-bottom: 1px solid var(--border, #27272a);
      font-size: 12px;
      flex-shrink: 0;
      user-select: none;
    }
    .pi-enh-excel-badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 7px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.02em;
      background: rgba(16, 185, 129, 0.15);
      color: #34d399;
      border: 1px solid rgba(16, 185, 129, 0.3);
      flex-shrink: 0;
    }
    .pi-enh-excel-meta {
      color: var(--text-dim, #71717a);
      font-size: 11px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      margin-right: auto;
    }
    .pi-enh-excel-search {
      display: flex;
      align-items: center;
      gap: 6px;
      background: var(--bg-panel, #18181b);
      border: 1px solid var(--border, #27272a);
      border-radius: 6px;
      padding: 2px 8px;
      color: var(--text, #f4f4f5);
      font-size: 12px;
      width: 160px;
      transition: border-color 0.15s, width 0.15s;
    }
    .pi-enh-excel-search:focus-within {
      border-color: #10b981;
      width: 200px;
    }
    .pi-enh-excel-search input {
      background: transparent;
      border: none;
      outline: none;
      color: inherit;
      font-size: 11px;
      width: 100%;
    }
    .pi-enh-excel-btn {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 3px 8px;
      border-radius: 5px;
      border: 1px solid var(--border, #27272a);
      background: var(--bg-panel, #18181b);
      color: var(--text, #f4f4f5);
      font-size: 11px;
      cursor: pointer;
      transition: background 0.15s, border-color 0.15s, color 0.15s;
      flex-shrink: 0;
    }
    .pi-enh-excel-btn:hover {
      background: var(--border, #27272a);
      color: #fff;
    }
    .pi-enh-excel-btn.is-active {
      background: rgba(16, 185, 129, 0.2);
      border-color: #10b981;
      color: #34d399;
    }
    .pi-enh-excel-grid-wrap {
      flex: 1;
      min-height: 0;
      overflow: auto;
      position: relative;
      background: var(--bg-panel, #18181b);
      scrollbar-gutter: stable;
    }
    .pi-enh-excel-table {
      border-collapse: separate;
      border-spacing: 0;
      min-width: 100%;
      table-layout: auto;
      font-size: 12px;
      color: var(--text, #f4f4f5);
    }
    .pi-enh-excel-th {
      position: sticky;
      top: 0;
      background: var(--bg, #121214) !important;
      color: var(--text-dim, #a1a1aa);
      font-family: var(--font-mono, monospace);
      font-weight: 600;
      font-size: 11px;
      padding: 5px 10px;
      border-right: 1px solid var(--border, #27272a);
      border-bottom: 1px solid var(--border, #27272a);
      text-align: center;
      user-select: none;
      z-index: 5;
      white-space: nowrap;
    }
    .pi-enh-excel-row-num {
      position: sticky;
      left: 0;
      background: var(--bg, #121214) !important;
      color: var(--text-dim, #71717a);
      font-family: var(--font-mono, monospace);
      font-size: 11px;
      padding: 5px 8px;
      border-right: 1px solid var(--border, #27272a);
      border-bottom: 1px solid var(--border, #27272a);
      text-align: center;
      user-select: none;
      z-index: 6;
      width: 44px;
      min-width: 44px;
      box-sizing: border-box;
    }
    .pi-enh-excel-corner {
      position: sticky;
      top: 0;
      left: 0;
      z-index: 7 !important;
      background: var(--bg, #09090b) !important;
    }
    .pi-enh-excel-td {
      padding: 4px 10px;
      border-right: 1px solid var(--border, #27272a);
      border-bottom: 1px solid var(--border, #27272a);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 420px;
      line-height: 1.5;
      box-sizing: border-box;
      user-select: text;
    }
    .pi-enh-excel-td.num {
      text-align: right;
      font-family: var(--font-mono, monospace);
      color: #1d4ed8;
    }
    .pi-enh-excel-td.date {
      text-align: center;
      color: #be185d;
    }
    html.dark .pi-enh-excel-td.num { color: #93c5fd; }
    html.dark .pi-enh-excel-td.date { color: #fbcfe8; }
    .pi-enh-excel-tr:hover .pi-enh-excel-td {
      background: rgba(255, 255, 255, 0.035);
    }
    .pi-enh-excel-tr:hover .pi-enh-excel-row-num {
      color: #34d399;
      background: var(--bg-hover, #18181b) !important;
    }
    .pi-enh-excel-td.is-match {
      background: rgba(234, 179, 8, 0.28) !important;
      color: #fef08a !important;
      font-weight: 600;
      outline: 1px solid #eab308;
    }
    .pi-enh-excel-td.is-selected {
      outline: 2px solid #10b981 !important;
      outline-offset: -2px;
      background: rgba(16, 185, 129, 0.12) !important;
    }
    .pi-enh-excel-bottom-bar {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 4px 10px;
      background: var(--bg, #09090b);
      border-top: 1px solid var(--border, #27272a);
      flex-shrink: 0;
      overflow-x: auto;
      scrollbar-width: thin;
      user-select: none;
    }
    .pi-enh-excel-tab {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 12px;
      font-size: 11px;
      font-weight: 500;
      color: var(--text-dim, #a1a1aa);
      border-radius: 4px;
      cursor: pointer;
      transition: all 0.15s;
      white-space: nowrap;
      border: 1px solid transparent;
    }
    .pi-enh-excel-tab:hover {
      background: var(--bg-panel, #18181b);
      color: var(--text, #f4f4f5);
    }
    .pi-enh-excel-tab.is-active {
      color: #34d399;
      font-weight: 600;
      background: var(--bg-panel, #18181b);
      border-color: rgba(16, 185, 129, 0.4);
      border-bottom: 2px solid #10b981;
    }
    .pi-enh-excel-status-spinner {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 12px;
      height: 100%;
      color: var(--text-dim, #a1a1aa);
      font-size: 13px;
    }

    /* ==========================================================================
       General Settings Dashboard Layout & Modern Dual-Column Containers
       (常规设置现代化自平衡双列卡片架构 - 杜绝网格行高对齐断层与留白空洞)
       ========================================================================== */
    .settings-general.pi-enh-general-dashboard {
      width: 100% !important;
      max-width: 100% !important;
      padding: 24px clamp(20px, 3.5vw, 36px) 36px !important;
      box-sizing: border-box !important;
      overflow-y: auto !important;
      scrollbar-gutter: stable !important;
      display: block !important;
    }
    .settings-general.pi-enh-general-dashboard .settings-general-title {
      margin: 0 0 18px 0 !important;
      font-size: 18px !important;
      font-weight: 700 !important;
      color: var(--text, #f4f4f5) !important;
      display: flex !important;
      align-items: center !important;
      gap: 8px !important;
      letter-spacing: -0.01em !important;
    }
    .pi-enh-dashboard-shell {
      display: flex !important;
      flex-direction: column !important;
      width: 100% !important;
      box-sizing: border-box !important;
    }
    .pi-enh-dashboard-grid {
      display: grid !important;
      grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
      gap: 20px 24px !important;
      align-items: start !important;
      width: 100% !important;
      box-sizing: border-box !important;
    }
    .pi-enh-dashboard-col {
      display: flex !important;
      flex-direction: column !important;
      gap: 16px !important;
      min-width: 0 !important;
      width: 100% !important;
      box-sizing: border-box !important;
    }
    .pi-enh-dashboard-col .settings-general-section {
      margin: 0 !important;
      padding: 18px 20px !important;
      background: color-mix(in srgb, var(--bg-panel, #27272a) 65%, transparent) !important;
      border: 1px solid var(--border, rgba(255, 255, 255, 0.08)) !important;
      border-radius: 12px !important;
      box-shadow: 0 2px 10px rgba(0, 0, 0, 0.12) !important;
      box-sizing: border-box !important;
      transition: border-color 0.15s ease, background 0.15s ease !important;
      width: 100% !important;
    }
    .pi-enh-dashboard-col .settings-general-section:hover {
      border-color: color-mix(in srgb, var(--border, #3f3f46) 75%, var(--accent, #38bdf8)) !important;
    }
    .pi-enh-dashboard-col .settings-general-heading {
      margin: 0 0 10px 0 !important;
      font-size: 13.5px !important;
      font-weight: 650 !important;
      color: var(--text, #f4f4f5) !important;
      display: flex !important;
      align-items: center !important;
      gap: 6px !important;
    }
    .pi-enh-dashboard-col .settings-general-description {
      margin: 0 0 14px 0 !important;
      color: var(--text-dim, #a1a1aa) !important;
      font-size: 12.5px !important;
      line-height: 1.55 !important;
    }
    .pi-enh-dashboard-col .settings-theme-options,
    .pi-enh-dashboard-col .settings-chat-options,
    .pi-enh-dashboard-col .settings-language-options,
    .pi-enh-dashboard-col .settings-shell-option {
      max-width: 100% !important;
      width: 100% !important;
    }
    .pi-enh-dashboard-col .settings-theme-options {
      grid-template-columns: repeat(3, minmax(0, 1fr)) !important;
      gap: 8px !important;
      padding: 0 !important;
    }
    .pi-enh-dashboard-col .settings-theme-option {
      min-height: 42px !important;
      border: 1px solid var(--border, rgba(255, 255, 255, 0.06)) !important;
      border-radius: 8px !important;
      transition: all 0.15s ease !important;
    }
    .pi-enh-dashboard-col .settings-chat-options {
      gap: 14px !important;
    }
    .pi-enh-dashboard-col .settings-language-options {
      gap: 6px !important;
    }
    .pi-enh-dashboard-col .settings-language-option {
      border: 1px solid var(--border, rgba(255, 255, 255, 0.05)) !important;
      border-radius: 8px !important;
      padding: 0 12px !important;
      transition: all 0.15s ease !important;
    }
    .pi-enh-dashboard-col .settings-shell-option {
      border-radius: 8px !important;
      padding: 4px 12px !important;
      border: 1px solid var(--border, rgba(255, 255, 255, 0.06)) !important;
    }

    /* 底部操作底栏 */
    .pi-enh-dashboard-footer {
      display: flex !important;
      justify-content: flex-end !important;
      align-items: center !important;
      width: 100% !important;
      padding-top: 18px !important;
      margin-top: 14px !important;
      border-top: 1px solid var(--border, rgba(255, 255, 255, 0.08)) !important;
      box-sizing: border-box !important;
    }
    .pi-enh-dashboard-footer .settings-general-section {
      margin: 0 !important;
      padding: 0 !important;
      background: transparent !important;
      border: none !important;
      box-shadow: none !important;
      width: auto !important;
      display: inline-flex !important;
      justify-content: flex-end !important;
    }

    /* 运维按钮操作组 */
    .pi-enh-service-actions-row {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
      margin-top: 12px;
    }
    .pi-enh-force-reload-btn {
      flex: 1 1 auto;
      min-width: 170px;
      padding: 8px 16px;
      font-size: 13px;
      background: color-mix(in srgb, #ef4444 12%, transparent) !important;
      color: #dc2626 !important;
      border: 1px solid color-mix(in srgb, #ef4444 36%, transparent) !important;
      border-radius: 8px !important;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      font-weight: 600;
      transition: all 0.15s ease;
    }
    :root:is([data-theme="dark"], .dark, [class*="dark"]) .pi-enh-force-reload-btn,
    @media (prefers-color-scheme: dark) {
      .pi-enh-force-reload-btn {
        color: #f87171 !important;
        background: rgba(239, 68, 68, 0.14) !important;
        border-color: rgba(239, 68, 68, 0.4) !important;
      }
    }
    .pi-enh-force-reload-btn:hover {
      background: color-mix(in srgb, #ef4444 22%, transparent) !important;
      border-color: color-mix(in srgb, #ef4444 55%, transparent) !important;
      transform: translateY(-1px);
    }
    .pi-enh-restart-service-btn {
      flex: 1 1 auto;
      min-width: 170px;
      padding: 8px 16px;
      font-size: 13px;
      background: color-mix(in srgb, #d97706 12%, transparent) !important;
      color: #b45309 !important;
      border: 1px solid color-mix(in srgb, #d97706 36%, transparent) !important;
      border-radius: 8px !important;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      font-weight: 600;
      transition: all 0.15s ease;
    }
    :root:is([data-theme="dark"], .dark, [class*="dark"]) .pi-enh-restart-service-btn,
    @media (prefers-color-scheme: dark) {
      .pi-enh-restart-service-btn {
        color: #fbbf24 !important;
        background: rgba(245, 158, 11, 0.14) !important;
        border-color: rgba(245, 158, 11, 0.4) !important;
      }
    }
    .pi-enh-restart-service-btn:hover {
      background: color-mix(in srgb, #d97706 22%, transparent) !important;
      border-color: color-mix(in srgb, #d97706 55%, transparent) !important;
      transform: translateY(-1px);
    }

    /* 移动端与窄屏响应式 */
    @media (max-width: 860px) {
      .pi-enh-dashboard-grid {
        grid-template-columns: 1fr !important;
        gap: 16px !important;
      }
      .pi-enh-dashboard-col .settings-theme-options {
        grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
      }
    }
    @media (max-width: 640px) {
      .settings-general.pi-enh-general-dashboard .settings-general-title,
      .settings-general .settings-general-title {
        display: none !important;
      }
      .settings-general.pi-enh-general-dashboard {
        padding: 14px 14px 28px !important;
      }
      .pi-enh-service-actions-row {
        flex-direction: column;
        align-items: stretch;
      }
      .pi-enh-force-reload-btn,
      .pi-enh-restart-service-btn {
        width: 100%;
      }
    }

    /* 重启二次确认模态窗与探活蒙层 */
    .pi-enh-restart-backdrop {
      position: fixed;
      inset: 0;
      z-index: 99999;
      background: rgba(0, 0, 0, 0.65);
      backdrop-filter: blur(6px);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 16px;
      animation: piEnhFadeIn 0.18s ease-out;
    }
    .pi-enh-restart-modal {
      width: 100%;
      max-width: 480px;
      background: var(--bg-panel, #20242d);
      border: 1px solid var(--border, rgba(255, 255, 255, 0.12));
      border-radius: 14px;
      box-shadow: 0 20px 50px rgba(0, 0, 0, 0.45);
      padding: 24px;
      box-sizing: border-box;
      color: var(--text, #f4f4f5);
      font-family: inherit;
    }
    .pi-enh-restart-modal-header {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 14px;
    }
    .pi-enh-restart-modal-icon {
      width: 34px;
      height: 34px;
      border-radius: 8px;
      background: rgba(245, 158, 11, 0.15);
      color: #fbbf24;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }
    .pi-enh-restart-modal-title {
      font-size: 16px;
      font-weight: 700;
      margin: 0;
    }
    .pi-enh-restart-modal-body {
      font-size: 13px;
      line-height: 1.6;
      color: var(--text-dim, #d4d4d8);
      margin-bottom: 20px;
    }
    .pi-enh-restart-modal-tips {
      margin: 10px 0 0 0;
      padding: 10px 14px;
      border-radius: 8px;
      background: rgba(255, 255, 255, 0.035);
      border: 1px solid rgba(255, 255, 255, 0.06);
      font-size: 12px;
      line-height: 1.6;
      color: #cbd5e1;
    }
    .pi-enh-restart-modal-actions {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 10px;
    }
    .pi-enh-restart-btn-cancel {
      padding: 8px 16px;
      border-radius: 7px;
      border: 1px solid var(--border, rgba(255, 255, 255, 0.12));
      background: transparent;
      color: var(--text-muted, #a1a1aa);
      cursor: pointer;
      font-size: 13px;
      font-weight: 500;
    }
    .pi-enh-restart-btn-cancel:hover {
      background: rgba(255, 255, 255, 0.06);
      color: var(--text, #f4f4f5);
    }
    .pi-enh-restart-btn-confirm {
      padding: 8px 18px;
      border-radius: 7px;
      border: 1px solid rgba(245, 158, 11, 0.45);
      background: #f59e0b;
      color: #18181b;
      cursor: pointer;
      font-size: 13px;
      font-weight: 650;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      transition: all 0.15s ease;
    }
    .pi-enh-restart-btn-confirm:hover {
      background: #fbbf24;
      box-shadow: 0 0 14px rgba(245, 158, 11, 0.35);
    }

    /* 探活进度蒙层 */
    .pi-enh-probe-card {
      text-align: center;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 14px;
      padding: 32px 28px;
      max-width: 440px;
    }
    .pi-enh-probe-spinner {
      width: 42px;
      height: 42px;
      border: 3px solid rgba(245, 158, 11, 0.18);
      border-top-color: #f59e0b;
      border-radius: 50%;
      animation: pi-enh-history-spin 0.8s linear infinite;
    }
    .pi-enh-probe-title {
      font-size: 17px;
      font-weight: 700;
      margin: 0;
      color: #18181b;
    }
    .pi-enh-probe-desc {
      font-size: 13px;
      color: #52525b;
      line-height: 1.5;
      margin: 0;
    }
    .pi-enh-probe-status {
      --pi-enh-probe-status-color: #92400e;
      --pi-enh-probe-success-color: #15803d;
      --pi-enh-probe-error-color: #b91c1c;
      font-size: 12px;
      color: var(--pi-enh-probe-status-color);
      font-family: var(--font-mono, monospace);
      background: rgba(245, 158, 11, 0.1);
      padding: 4px 10px;
      border-radius: 6px;
      border: 1px solid rgba(245, 158, 11, 0.2);
    }
    .pi-enh-probe-fallback {
      margin-top: 10px;
      width: 100%;
      text-align: left;
      font-size: 12px;
      color: #3f3f46;
      background: rgba(0, 0, 0, 0.04);
      padding: 12px;
      border-radius: 8px;
      border: 1px solid rgba(0, 0, 0, 0.1);
    }
    .pi-enh-probe-fallback-title { font-weight: 600; color: #92400e; margin-bottom: 4px; }
    .pi-enh-probe-copy-btn {
      font-size: 11px;
      padding: 4px 10px;
      background: rgba(0, 0, 0, 0.04);
      border: 1px solid rgba(0, 0, 0, 0.16);
      border-radius: 4px;
      color: #18181b;
      cursor: pointer;
    }
    :root:is([data-theme="dark"], .dark, [class*="dark"]) .pi-enh-probe-title { color: #f4f4f5; }
    :root:is([data-theme="dark"], .dark, [class*="dark"]) .pi-enh-probe-desc { color: #a1a1aa; }
    :root:is([data-theme="dark"], .dark, [class*="dark"]) .pi-enh-probe-status {
      --pi-enh-probe-status-color: #fbbf24;
      --pi-enh-probe-success-color: #4ade80;
      --pi-enh-probe-error-color: #f87171;
    }
    :root:is([data-theme="dark"], .dark, [class*="dark"]) .pi-enh-probe-fallback {
      color: #cbd5e1;
      background: rgba(0, 0, 0, 0.25);
      border-color: rgba(255, 255, 255, 0.08);
    }
    :root:is([data-theme="dark"], .dark, [class*="dark"]) .pi-enh-probe-fallback-title { color: #fbbf24; }
    :root:is([data-theme="dark"], .dark, [class*="dark"]) .pi-enh-probe-copy-btn {
      background: rgba(255, 255, 255, 0.08);
      border-color: rgba(255, 255, 255, 0.15);
      color: #f4f4f5;
    }

    @keyframes piEnhFadeIn {
      from { opacity: 0; transform: scale(0.96); }
      to { opacity: 1; transform: scale(1); }
    }

    /* 会话导航指示器当前阅读位置高亮优化 (ChatMinimap Active Node Indicator) */
    [data-minimap-node-active] > div {
      background: var(--accent, #a4c2f4) !important;
      border-color: var(--accent, #a4c2f4) !important;
      box-shadow: 0 0 0 2px var(--bg-panel), 0 0 8px color-mix(in srgb, var(--accent, #a4c2f4) 55%, transparent) !important;
    }

    /* 移动端与嵌套滚动触控链优化 (Nested Scroll Chaining & Mobile Bubble View) */
    @media (max-width: 768px) {
      div[style*="maxHeight: 300"],
      div[style*="max-height: 300px"],
      div[style*="var(--user-bg)"],
      div[style*="var(--bg-user)"] {
        max-height: min(75vh, 600px) !important;
      }
    }
    div[style*="var(--user-bg)"],
    div[style*="var(--bg-user)"],
    .chat-content [class*="overflow-y-auto"],
    .chat-content pre {
      overscroll-behavior-y: auto !important;
      -webkit-overflow-scrolling: touch !important;
    }
  `;
  document.head.appendChild(styleEl);

  // --- Notification Preferences & History (通知偏好与历史) ---
  const NOTIFICATION_SETTINGS_STORAGE_KEY = "pi-enh-notification-settings-v1";
  const NOTIFICATION_HISTORY_STORAGE_KEY = "pi-enh-notification-history-v1";
  const NOTIFICATION_HISTORY_LIMIT = 100;
  const NOTIFICATION_CHANNELS = [
    { id: "session-title", name: "会话标题自动提炼", desc: "会话标题被 AI 自动提炼并修改时提示。", group: "日常提示", defaultEnabled: false },
    { id: "mcp", name: "MCP 工具与连接提示", desc: "MCP 工具注册、重新加载、连接失败或配置错误提示。", group: "日常提示", defaultEnabled: false },
    { id: "native-info", name: "普通信息提示", desc: "其他 info 级别的 Agent 扩展通知。", group: "日常提示", defaultEnabled: false },
    { id: "native-success", name: "成功提示", desc: "操作成功或服务完成时的 success 通知。", group: "日常提示", defaultEnabled: true },
    { id: "native-warning", name: "警告提示", desc: "warning 级别的服务或配置告警。", group: "异常与安全", defaultEnabled: true },
    { id: "native-error", name: "错误提示", desc: "error 级别的故障提示，建议保持开启。", group: "异常与安全", defaultEnabled: true },
    { id: "security-guard", name: "安全拦截与防护", desc: "WSL、NAS、Pi Web 重启及超时看门狗等高危操作拦截提示。", group: "异常与安全", defaultEnabled: true },
    { id: "enhancement-toast", name: "网页增强操作提示", desc: "复制、归档、缓存、插件切换等网页操作的轻量提示。", group: "网页提醒", defaultEnabled: true },
    { id: "attention-sound", name: "审批提示音", desc: "后台任务等待人工处理时播放提示音。", group: "后台任务", defaultEnabled: true },
    { id: "attention-desktop", name: "桌面待处理通知", desc: "后台任务需要处理时发送浏览器/系统桌面通知。", group: "后台任务", defaultEnabled: false },
  ];
  let notificationSettings = null;

  function getNotificationDefaults() {
    return Object.fromEntries(NOTIFICATION_CHANNELS.map((item) => [item.id, item.defaultEnabled]));
  }

  function readNotificationSettings() {
    if (notificationSettings) return notificationSettings;
    const defaults = getNotificationDefaults();
    try {
      const raw = localStorage.getItem(NOTIFICATION_SETTINGS_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      if (parsed && typeof parsed === "object" && parsed.schemaVersion === 1 && parsed.channels) {
        for (const item of NOTIFICATION_CHANNELS) {
          if (typeof parsed.channels[item.id] === "boolean") defaults[item.id] = parsed.channels[item.id];
        }
      }
    } catch (e) {}
    notificationSettings = defaults;
    try {
      localStorage.setItem(NOTIFICATION_SETTINGS_STORAGE_KEY, JSON.stringify({ schemaVersion: 1, channels: notificationSettings }));
    } catch (e) {}
    return notificationSettings;
  }

  function writeNotificationSettings() {
    try {
      localStorage.setItem(NOTIFICATION_SETTINGS_STORAGE_KEY, JSON.stringify({ schemaVersion: 1, channels: readNotificationSettings() }));
    } catch (e) {}
  }

  function getNotificationChannel(id) {
    return NOTIFICATION_CHANNELS.find((item) => item.id === id) || null;
  }

  function isNotificationEnabled(id) {
    const channel = getNotificationChannel(id);
    if (!channel) return true;
    return readNotificationSettings()[id] !== false;
  }

  function getNotificationTypeLabel(type) {
    return ({ info: "信息", success: "成功", warning: "警告", error: "错误" })[type] || "提示";
  }

  function classifyNotification(message, type = "info", channel = "native") {
    const text = String(message || "");
    if (channel === "toast") return "enhancement-toast";
    if (channel === "attention-sound") return "attention-sound";
    if (channel === "attention-desktop") return "attention-desktop";
    if (/会话标题(?:已自动提炼|自动提炼)/i.test(text)) return "session-title";
    if (/\bMCP\b|Registered\s+\d+\s+tool|MCP tools|工具.*(?:注册|重新加载)|(?:注册|重新加载).*工具/i.test(text)) return "mcp";
    if (/已(?:物理)?拦截|WSL|NAS|Pi Web.*(?:杀死|重启|高危)|看门狗|超时兜底/i.test(text)) return "security-guard";
    if (type === "error") return "native-error";
    if (type === "warning") return "native-warning";
    if (type === "success") return "native-success";
    return "native-info";
  }

  function readNotificationHistory() {
    try {
      const parsed = JSON.parse(localStorage.getItem(NOTIFICATION_HISTORY_STORAGE_KEY) || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) { return []; }
  }

  function writeNotificationHistory(history) {
    try { localStorage.setItem(NOTIFICATION_HISTORY_STORAGE_KEY, JSON.stringify(history.slice(0, NOTIFICATION_HISTORY_LIMIT))); } catch (e) {}
  }

  function recordNotificationEvent(message, type = "info", channel = "native", settingId = null) {
    const resolvedId = settingId || classifyNotification(message, type, channel);
    const enabled = isNotificationEnabled(resolvedId);
    const history = readNotificationHistory();
    history.unshift({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: Date.now(),
      message: String(message || "").slice(0, 2000),
      type: String(type || "info"),
      channel: String(channel || "native"),
      settingId: resolvedId,
      suppressed: !enabled,
    });
    writeNotificationHistory(history);
    return enabled;
  }

  function isNotificationCenterEnabled() {
    try { return typeof isPluginEnabled !== "function" || isPluginEnabled("notification-center"); } catch (e) { return true; }
  }

  function getNativeNoticeType(node) {
    const bullet = node?.querySelector?.(":scope > span");
    const background = `${bullet?.style?.background || ""} ${bullet?.style?.backgroundColor || ""}`.toLowerCase();
    if (background.includes("#ef4444") || background.includes("239, 68, 68")) return "error";
    if (background.includes("#d97706") || background.includes("217, 119, 6")) return "warning";
    if (background.includes("#10b981") || background.includes("16, 185, 129")) return "success";
    return "info";
  }

  function processNativeNotice(node) {
    if (!node?.matches?.(".notice-shelf-item") || node.dataset.piEnhNotificationProcessed === "true") return;
    if (!isNotificationCenterEnabled()) {
      if (node.hasAttribute("data-pi-enh-notification-suppressed")) {
        node.removeAttribute("data-pi-enh-notification-suppressed");
      }
      return;
    }
    const message = (node.textContent || "").trim();
    if (!message) return;
    const type = getNativeNoticeType(node);
    const settingId = classifyNotification(message, type, "native");
    node.dataset.piEnhNotificationProcessed = "true";
    node.dataset.piEnhNotificationSetting = settingId;
    recordNotificationEvent(message, type, "native", settingId);
    const shouldSuppress = !isNotificationEnabled(settingId);
    if (shouldSuppress) {
      if (node.getAttribute("data-pi-enh-notification-suppressed") !== "true") {
        node.setAttribute("data-pi-enh-notification-suppressed", "true");
      }
    } else {
      if (node.hasAttribute("data-pi-enh-notification-suppressed")) {
        node.removeAttribute("data-pi-enh-notification-suppressed");
      }
    }
  }

  function applyNotificationVisibility() {
    const centerEnabled = isNotificationCenterEnabled();
    for (const node of document.querySelectorAll(".notice-shelf-item")) {
      const settingId = node.dataset.piEnhNotificationSetting || classifyNotification(node.textContent || "", getNativeNoticeType(node), "native");
      node.dataset.piEnhNotificationSetting = settingId;
      const shouldSuppress = centerEnabled && !isNotificationEnabled(settingId);
      if (shouldSuppress) {
        if (node.getAttribute("data-pi-enh-notification-suppressed") !== "true") {
          node.setAttribute("data-pi-enh-notification-suppressed", "true");
        }
      } else {
        if (node.hasAttribute("data-pi-enh-notification-suppressed")) {
          node.removeAttribute("data-pi-enh-notification-suppressed");
        }
      }
    }
    if (!isNotificationEnabled("enhancement-toast")) dismissToast?.(true);
    if (typeof renderAttentionNotices === "function") renderAttentionNotices();
    if (typeof syncApprovalSound === "function") syncApprovalSound();
    if (typeof syncDesktopAttention === "function") syncDesktopAttention();
  }

  function setNotificationEnabled(id, enabled) {
    if (!getNotificationChannel(id)) return;
    readNotificationSettings()[id] = Boolean(enabled);
    writeNotificationSettings();
    applyNotificationVisibility();
  }

  function clearNotificationHistory() {
    writeNotificationHistory([]);
  }

  function scanNativeNotices(root) {
    if (root?.matches?.(".notice-shelf-item")) processNativeNotice(root);
    root?.querySelectorAll?.(".notice-shelf-item").forEach(processNativeNotice);
  }

  function initNotificationCapture() {
    // Native notice nodes are scanned by the existing body/settings observer below;
    // avoid adding another MutationObserver to the hot-reload lifecycle.
    scanNativeNotices(document);
  }

  window.__PI_ENH_NOTIFICATION_SETTINGS__ = {
    channels: NOTIFICATION_CHANNELS,
    get: () => ({ ...readNotificationSettings() }),
    set: (id, enabled) => setNotificationEnabled(id, enabled),
    history: () => readNotificationHistory(),
    clearHistory: clearNotificationHistory,
    classify: classifyNotification,
  };

  // --- Toast Helper ---
  let toastEl = null;
  let toastTimer = null;
  let toastRemoveTimer = null;

  function dismissToast(immediate = false) {
    if (toastTimer) {
      clearManagedTimeout(toastTimer);
      toastTimer = null;
    }
    if (toastRemoveTimer) {
      clearTimeout(toastRemoveTimer);
      toastRemoveTimer = null;
    }
    if (!toastEl) return;
    const el = toastEl;
    toastEl = null;
    el.classList.remove("show");
    if (immediate) {
      try { el.remove(); } catch (e) {}
    } else {
      toastRemoveTimer = setTimeout(() => {
        try { el.remove(); } catch (e) {}
      }, 220);
    }
  }

  function showToast(message, iconSvg, durationMs) {
    const settingId = arguments.length > 3 && arguments[3] ? arguments[3] : "enhancement-toast";
    if (!recordNotificationEvent(message, "info", "toast", settingId)) return;
    // 1. 清理可能遗留的历史孤儿 toast 节点
    for (const orphan of document.querySelectorAll(".pi-enh-toast")) {
      try { orphan.remove(); } catch (e) {}
    }
    if (toastTimer) {
      clearManagedTimeout(toastTimer);
      toastTimer = null;
    }
    if (toastRemoveTimer) {
      clearTimeout(toastRemoveTimer);
      toastRemoveTimer = null;
    }

    // 2. 创建全新的 toast 节点，并附带关键内联样式兜底防掉落
    toastEl = document.createElement("div");
    toastEl.className = "pi-enh-toast";
    toastEl.setAttribute("role", "status");
    toastEl.setAttribute("aria-live", "polite");
    // 防御性内联定位：即使外部样式表被清理或延迟，也绝不掉入文档常规流（左下角）
    toastEl.style.position = "fixed";
    toastEl.style.top = "16px";
    toastEl.style.left = "50%";
    toastEl.style.zIndex = "100000";

    const msgStr = String(message || "");
    const isErrorMsg = /失败|错误|异常|超时|无法|拒绝|拦截|未通过/.test(msgStr);
    const isLoadingMsg = !isErrorMsg && !/完成|成功|已/.test(msgStr) && /正在|下载|更新中|加载中|刷新中|连接中|同步中/.test(msgStr);
    const defaultCheck = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
    const errorIcon = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`;
    const loadingIcon = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"><animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.9s" repeatCount="indefinite"/></path></svg>`;
    const resolvedIcon = iconSvg || (isErrorMsg ? errorIcon : (isLoadingMsg ? loadingIcon : defaultCheck));
    if (isErrorMsg) toastEl.setAttribute("data-toast-level", "error");
    else if (isLoadingMsg) toastEl.setAttribute("data-toast-level", "loading");
    toastEl.innerHTML = `${resolvedIcon}<span data-pi-enh-toast-text>${message}</span><button type="button" class="pi-enh-toast-dismiss" data-pi-enh-toast-dismiss aria-label="关闭提示" title="关闭">×</button>`;
    toastEl.querySelector("[data-pi-enh-toast-dismiss]")?.addEventListener("click", () => dismissToast(false));
    document.body.appendChild(toastEl);

    // 强制触发 reflow 保证动画平滑
    void toastEl.offsetWidth;
    toastEl.classList.add("show");

    const defaultDuration = isErrorMsg ? 4200 : (isLoadingMsg ? 15000 : 2400);
    const duration = Number.isFinite(durationMs) ? Math.max(0, durationMs) : defaultDuration;
    toastTimer = addManagedTimeout(() => dismissToast(false), duration);
  }

  const QUEUE_WARN_ICON = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>`;

  function showQueueSecurityWarningToast(message = "队列未改动：安全接口待维护安装，暂不能编辑、删除或提升") {
    const previousToast = toastEl;
    showToast(message, QUEUE_WARN_ICON, 3200);
    if (toastEl && toastEl !== previousToast) {
      // Keep this longer warning readable on phones without changing other toasts.
      toastEl.style.width = "max-content";
      toastEl.style.maxWidth = "calc(100vw - 32px)";
      toastEl.style.boxSizing = "border-box";
      const icon = toastEl.querySelector("svg");
      if (icon) icon.style.flexShrink = "0";
    }
  }

  // A hot-reload starts from the previous script instance. Carry its notice
  // across the script handoff so the freshly loaded helper renders it with
  // the current dismissible toast markup.
  const pendingToast = window.__PI_ENH_PENDING_TOAST__;
  if (pendingToast && pendingToast.message) {
    delete window.__PI_ENH_PENDING_TOAST__;
    showToast(pendingToast.message, pendingToast.iconSvg, pendingToast.durationMs, pendingToast.settingId);
  }

  initNotificationCapture();

  // --- Clipboard Helper ---
  async function copyText(text, successMsg) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      showToast(successMsg);
    } catch (e) {
      showToast("复制失败: " + e.message);
    }
  }

