/* Renderer owned exclusively by the existing usage-dashboard enhancement plugin. */
(function (root) {
  "use strict";
  function getCore() {
    return (typeof root !== "undefined" && root.PiUsageLedger) ||
           (typeof window !== "undefined" && window.PiUsageLedger) ||
           (typeof globalThis !== "undefined" && globalThis.PiUsageLedger) ||
           null;
  }
  const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const tokens = n => n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
  const cost = s => s.costNano > 0
    ? `$${(s.costNano / 1e9).toFixed(3)}${s.unpricedTokens ? " + 未定价" : ""}`
    : (s.unpricedTokens ? "未定价" : "$0.000");

  const roleNames = { main: "主会话直接用量", subagent: "子代理独立用量", system: "工具 / 压缩摘要用量" };
  const STORAGE_KEY = "pi-enh-usage-filters";
  const CACHE_KEY = "pi-enh-usage-ledger-cache";
  const VALID_TIME_RANGES = new Set(["today", "yesterday", "24h", "7d", "30d", "all", "custom"]);
  const VALID_ROLES = new Set(["all", "main", "subagent", "system"]);

  function readSavedFilters() {
    try {
      const storage = typeof localStorage !== "undefined" ? localStorage : (root && root.localStorage);
      const raw = storage ? storage.getItem(STORAGE_KEY) : null;
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return typeof parsed === "object" && parsed !== null ? parsed : {};
    } catch {
      return {};
    }
  }

  function persistFilters(next) {
    try {
      const storage = typeof localStorage !== "undefined" ? localStorage : (root && root.localStorage);
      if (storage) {
        storage.setItem(STORAGE_KEY, JSON.stringify(next));
      }
    } catch {}
  }

  const initial = readSavedFilters();
  let timeRange = VALID_TIME_RANGES.has(initial.timeRange) ? initial.timeRange : "all";
  let role = VALID_ROLES.has(initial.role) ? initial.role : "all";
  let model = typeof initial.model === "string" ? initial.model : "all";
  let startDate = typeof initial.startDate === "string" ? initial.startDate : "";
  let endDate = typeof initial.endDate === "string" ? initial.endDate : "";

  function updateFilters(next = {}) {
    if (VALID_TIME_RANGES.has(next.timeRange)) timeRange = next.timeRange;
    if (VALID_ROLES.has(next.role)) role = next.role;
    if (typeof next.model === "string") model = next.model;
    if (typeof next.startDate === "string") startDate = next.startDate;
    if (typeof next.endDate === "string") endDate = next.endDate;
    persistFilters({ timeRange, role, model, startDate, endDate });
  }

  function resetFilters() {
    timeRange = "all";
    role = "all";
    model = "all";
    startDate = "";
    endDate = "";
    persistFilters({ timeRange: "all", role: "all", model: "all", startDate: "", endDate: "" });
  }

  function formatBeijingDateTime(ts) {
    if (typeof ts !== "number" || !Number.isFinite(ts)) return "";
    const d = new Date(ts + 8 * 3600000);
    const pad = n => String(n).padStart(2, "0");
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  }

  function read() {
    let ledger = root.__PI_ENH_USAGE_LEDGER__;
    if (!ledger || typeof ledger !== "object" || ledger.version !== 2) {
      // SWR 秒开增强：尝试从客户端持久缓存（sessionStorage/localStorage）即时恢复上一次已核验快照
      try {
        const storage = typeof sessionStorage !== "undefined" ? sessionStorage : (typeof localStorage !== "undefined" ? localStorage : null);
        const cached = storage ? storage.getItem(CACHE_KEY) : null;
        if (cached) {
          const parsed = JSON.parse(cached);
          if (parsed && typeof parsed === "object" && parsed.version === 2 && Array.isArray(parsed.buckets)) {
            root.__PI_ENH_USAGE_LEDGER__ = parsed;
            ledger = parsed;
          }
        }
      } catch (_) {}
    }
    if (!ledger || typeof ledger !== "object" || ledger.version !== 2) return null;
    const core = getCore();
    if (core && typeof core.validate === "function") {
      try {
        core.validate(ledger);
      } catch (valErr) {
        if (valErr && typeof valErr.message === "string" && (valErr.message.includes("Snapshot mismatch: costNano") || valErr.message.includes("Snapshot mismatch: unpricedTokens"))) {
          console.warn("[pi-usage-panel] 捕获快照派生价格差异，已自动按当前费率基准聚合展示:", valErr.message);
          try {
            if (typeof core.aggregate === "function") {
              const a = core.aggregate(ledger);
              if (ledger.totals) {
                ledger.totals.costNano = a.costNano;
                ledger.totals.unpricedTokens = a.unpricedTokens;
              }
            }
          } catch (_) {}
        } else {
          throw valErr;
        }
      }
    }
    return ledger;
  }

  function extractJsonObjectFromSource(source, startIndex) {
    const jsonStart = source.indexOf("{", startIndex);
    if (jsonStart < 0) throw new Error("无法定位账本快照起始位置");
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let i = jsonStart; i < source.length; i++) {
      const ch = source[i];
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === "\\") {
        escape = true;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
        continue;
      }
      if (!inString) {
        if (ch === "{") depth++;
        else if (ch === "}") {
          depth--;
          if (depth === 0) {
            return source.slice(jsonStart, i + 1);
          }
        }
      }
    }
    throw new Error("无法定位完整闭合的账本快照 JSON 对象");
  }

  const DEFAULT_RETRY_DELAYS = [3000, 8000];
  const DEFAULT_POST_TIMEOUT_MS = 40000;
  function getPostTimeoutMs() {
    if (typeof root !== "undefined" && typeof root.__PI_USAGE_POST_TIMEOUT_MS__ === "number" && root.__PI_USAGE_POST_TIMEOUT_MS__ > 0) {
      return root.__PI_USAGE_POST_TIMEOUT_MS__;
    }
    return DEFAULT_POST_TIMEOUT_MS;
  }

  let activeRetryContext = null;
  let activeAbortController = null;
  let activeRequestId = 0;
  let activeRequestIsManual = false;
  let activeManualPromise = null;
  let lastAutoRefreshCheckTime = 0;
  let activeRescanPromise = null;
  let inflightFetchPromise = null;

  function cancelActiveRetry(reason = "刷新操作已取消") {
    activeRequestId++;
    activeRequestIsManual = false;
    activeManualPromise = null;
    if (activeAbortController) {
      activeAbortController.abort();
      activeAbortController = null;
    }
    if (activeRetryContext) {
      activeRetryContext.cancelled = true;
      if (activeRetryContext.timer) {
        clearTimeout(activeRetryContext.timer);
        activeRetryContext.timer = null;
      }
      if (typeof activeRetryContext.rejectWait === "function") {
        activeRetryContext.rejectWait(new Error(reason));
        activeRetryContext.rejectWait = null;
      }
      activeRetryContext = null;
    }
  }

  async function fetchSnapshotOnce(signal, shouldAccept) {
    if (!signal && inflightFetchPromise) {
      return inflightFetchPromise;
    }

    const execute = async () => {
      let fresh = null;
      let lastErr = null;

      try {
        const jsonRes = await fetch(`/pi-usage-ledger.json?usageSnapshot=${Date.now()}`, { cache: "no-store", signal });
        if (jsonRes && jsonRes.ok) {
          const jsonText = (await jsonRes.text()).trimStart();
          if (signal && signal.aborted) {
            throw new Error("刷新操作已取消");
          }
          if (jsonText.startsWith("{")) {
            const parsed = JSON.parse(jsonText);
            if (parsed && typeof parsed === "object" && parsed.version === 2 && Array.isArray(parsed.buckets)) {
              fresh = parsed;
            }
          } else if (jsonText.includes("window.__PI_ENH_USAGE_LEDGER__ = ")) {
            const marker = "window.__PI_ENH_USAGE_LEDGER__ = ";
            const start = jsonText.indexOf(marker);
            const jsonStr = extractJsonObjectFromSource(jsonText, start + marker.length);
            const parsed = JSON.parse(jsonStr);
            if (parsed && typeof parsed === "object" && parsed.version === 2 && Array.isArray(parsed.buckets)) {
              fresh = parsed;
            }
          }
        } else if (jsonRes && !jsonRes.ok && jsonRes.status !== 404) {
          lastErr = new Error(`HTTP ${jsonRes.status}`);
        }
      } catch (jsonErr) {
        if (signal?.aborted || jsonErr?.name === "AbortError" || jsonErr?.message === "刷新操作已取消") {
          throw new Error("刷新操作已取消");
        }
        // 网络层或连接异常直接抛给外层重试退避，避免在同一次 attempt 内发起并发重复请求
        throw jsonErr;
      }

      if (!fresh) {
        try {
          const response = await fetch(`/pi-web-enhancements.js?usageSnapshot=${Date.now()}`, { cache: "no-store", signal });
          if (response && response.ok) {
            const source = await response.text();
            if (signal && signal.aborted) throw new Error("刷新操作已取消");
            const trimmed = source.trimStart();
            if (trimmed.startsWith("{")) {
              fresh = JSON.parse(trimmed);
            } else {
              const marker = "window.__PI_ENH_USAGE_LEDGER__ = ";
              const start = source.indexOf(marker);
              if (start >= 0) {
                try {
                  const jsonStr = extractJsonObjectFromSource(source, start + marker.length);
                  fresh = JSON.parse(jsonStr);
                } catch (_) {}
              }
            }
          }
        } catch (fetchErr) {
          if (signal?.aborted || fetchErr?.name === "AbortError") throw new Error("刷新操作已取消");
        }
      }

      if (!fresh) {
        throw (lastErr || new Error("未能获取到有效的账本快照数据"));
      }

      if (typeof fresh !== "object" || fresh.version !== 2) throw new Error("账本快照版本不匹配");
      const core = getCore();
      if (core && typeof core.validate === "function") {
        try {
          core.validate(fresh);
        } catch (valErr) {
          if (valErr && typeof valErr.message === "string" && (valErr.message.includes("Snapshot mismatch: costNano") || valErr.message.includes("Snapshot mismatch: unpricedTokens"))) {
            console.warn("[pi-usage-panel] 远程快照派生价格差异，已自动按当前费率基准聚合展示:", valErr.message);
            try {
              if (typeof core.aggregate === "function") {
                const a = core.aggregate(fresh);
                if (fresh.totals) {
                  fresh.totals.costNano = a.costNano;
                  fresh.totals.unpricedTokens = a.unpricedTokens;
                }
              }
            } catch (_) {}
          } else {
            throw valErr;
          }
        }
      }
      if (signal && signal.aborted) {
        throw new Error("刷新操作已取消");
      }
      if (typeof shouldAccept === "function" && !shouldAccept(fresh)) {
        return fresh;
      }
      const old = root.__PI_ENH_USAGE_LEDGER__;
      if (!old || old.version !== 2 || !old.generatedAt || !fresh.generatedAt || fresh.generatedAt >= old.generatedAt) {
        root.__PI_ENH_USAGE_LEDGER__ = fresh;
        // A successful load also satisfies the panel auto-refresh window.
        lastAutoRefreshCheckTime = Date.now();
        try {
          const storage = typeof sessionStorage !== "undefined" ? sessionStorage : (typeof localStorage !== "undefined" ? localStorage : null);
          if (storage) {
            storage.setItem(CACHE_KEY, JSON.stringify(fresh));
          }
        } catch (_) {}
      }
      return root.__PI_ENH_USAGE_LEDGER__;
    };

    if (!signal) {
      inflightFetchPromise = execute().finally(() => {
        inflightFetchPromise = null;
      });
      return inflightFetchPromise;
    }
    return execute();
  }

  async function refresh(options = {}) {
    const isAuto = Boolean(options.auto || options.isAutoRefresh);
    if (isAuto && activeRetryContext && activeRequestIsManual) {
      if (activeManualPromise) return activeManualPromise;
      return root.__PI_ENH_USAGE_LEDGER__ || null;
    }

    const retryDelays = Array.isArray(options.retryDelays) ? options.retryDelays : DEFAULT_RETRY_DELAYS;
    const onProgress = typeof options.onProgress === "function" ? options.onProgress : null;
    const isCancelled = typeof options.isCancelled === "function" ? options.isCancelled : () => false;

    cancelActiveRetry(isAuto ? "自动刷新被新的刷新取代" : "刷新操作已取消");
    const abortCtrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    activeAbortController = abortCtrl;
    const ctx = { cancelled: false, timer: null };
    activeRetryContext = ctx;
    activeRequestIsManual = !isAuto;

    const reqId = activeRequestId;
    let attempt = 0;
    const maxAttempts = 1 + retryDelays.length;

    const shouldAccept = () => {
      if (reqId !== activeRequestId) return false;
      if (ctx.cancelled) return false;
      if (isCancelled()) return false;
      if (abortCtrl && abortCtrl.signal.aborted) return false;
      return true;
    };

    const run = async () => {
      while (attempt < maxAttempts) {
        if (!shouldAccept()) {
          throw new Error("刷新操作已取消");
        }
        try {
          const result = await fetchSnapshotOnce(abortCtrl ? abortCtrl.signal : undefined, shouldAccept);
          if (!shouldAccept()) {
            throw new Error("刷新操作已取消");
          }
          if (ctx === activeRetryContext) {
            activeRetryContext = null;
            activeRequestIsManual = false;
            activeManualPromise = null;
          }
          if (activeAbortController === abortCtrl) activeAbortController = null;
          return result;
        } catch (err) {
          attempt++;
          if (attempt >= maxAttempts || !shouldAccept()) {
            if (ctx === activeRetryContext) {
              activeRetryContext = null;
              activeRequestIsManual = false;
              activeManualPromise = null;
            }
            if (activeAbortController === abortCtrl) activeAbortController = null;
            throw err;
          }

          const delay = retryDelays[attempt - 1];
          const nextAttempt = attempt;
          const totalRetries = retryDelays.length;
          if (onProgress) {
            try {
              onProgress({ attempt: nextAttempt, totalRetries, delayMs: delay, error: err });
            } catch {}
          }

          await new Promise((resolve, reject) => {
            ctx.rejectWait = reject;
            ctx.timer = setTimeout(() => {
              ctx.timer = null;
              ctx.rejectWait = null;
              if (!shouldAccept()) {
                reject(new Error("刷新操作已取消"));
              } else {
                resolve();
              }
            }, delay);
          });
        }
      }
    };

    const promise = run();
    if (!isAuto) {
      activeManualPromise = promise;
    }
    return promise;
  }

  function formatTimeRangeLabel(key, now) {
    const core = getCore();
    if (!core || typeof core.day !== "function") {
      const fallback = { today: "今天", yesterday: "昨天", "24h": "最近24小时", "7d": "近7天", "30d": "近30天", all: "全部历史", custom: "自定义" };
      return fallback[key] || key;
    }
    const todayStr = core.day(now);
    const yesterdayStr = core.day(now - 86400000);
    const mToday = todayStr.slice(5).replace(/^0/, "").replace(/-0?/, "/");
    const mYesterday = yesterdayStr.slice(5).replace(/^0/, "").replace(/-0?/, "/");

    if (key === "today") return `今天 (${mToday})`;
    if (key === "yesterday") return `昨天 (${mYesterday})`;
    if (key === "24h") return "最近24小时";
    if (key === "7d") return "近7天";
    if (key === "30d") return "近30天";
    if (key === "all") return "全部历史";
    if (key === "custom") return "自定义";
    return key;
  }

  function getTimeRangeDescription(range, now, startDate, endDate) {
    const core = getCore();
    if (!core || typeof core.day !== "function") return "";
    const todayStr = core.day(now);
    const yesterdayStr = core.day(now - 86400000);
    if (range === "today") return `${todayStr}（今天 · 北京时间）`;
    if (range === "yesterday") return `${yesterdayStr}（昨天 · 北京时间）`;
    if (range === "24h") return `${formatBeijingDateTime(now - 86400000)} ~ ${formatBeijingDateTime(now)}（最近24小时 · 北京时间）`;
    if (range === "7d") return `${core.day(now - 6 * 86400000)} ~ ${todayStr}（近7天）`;
    if (range === "30d") return `${core.day(now - 29 * 86400000)} ~ ${todayStr}（近30天）`;
    if (range === "custom") return `${startDate || "起"} ~ ${endDate || "止"}（自定义区间）`;
    return "全部历史记录";
  }

  function card(label, value, hint) {
    return `<div class="pi-enh-kpi-pro-card"><div class="kpi-pro-label">${label}</div><div class="kpi-pro-value highlight-cyan">${value}</div><div class="kpi-pro-hint">${hint}</div></div>`;
  }

  function _renderLoading(panel) {
    panel.innerHTML = `<div class="pi-enh-usage-panel-content" style="padding:40px 0;max-width:900px;margin:0 auto;text-align:center;">
      <section class="pi-enh-usage-header-pro" style="text-align:left;">
        <div class="pi-enh-usage-title-row">
          <h2 style="margin:0;font-size:20px;font-weight:700;color:var(--text, #f4f4f5);">Usage</h2>
        </div>
      </section>
      <div style="padding:60px 0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;">
        <div class="pi-enh-history-spinner" style="width:32px;height:32px;border:3px solid rgba(56,189,248,0.2);border-top-color:#38bdf8;border-radius:50%;animation:pi-spin 0.8s linear infinite;margin:0 auto;"></div>
        <div style="font-size:14px;color:var(--text, #f4f4f5);font-weight:600;">正在同步服务端用量快照数据...</div>
        <div style="font-size:12px;color:var(--text-muted, #71717a);">首次加载可能需要 1~2 秒，请稍候</div>
      </div>
      <style>
        @keyframes pi-spin { to { transform: rotate(360deg); } }
        .pi-enh-history-spinner { box-sizing: border-box; }
      </style>
    </div>`;
  }

  function _renderErrorFallback(panel, nav, hooks, error) {
    panel.innerHTML = `<div class="pi-enh-usage-panel-content" style="padding:24px 0;max-width:900px;margin:0 auto;color:#f4f4f5;">
      <section class="pi-enh-usage-header-pro">
        <div class="pi-enh-usage-title-row">
          <h2 style="margin:0;font-size:20px;font-weight:700;color:#f4f4f5;">Usage 用量统计</h2>
        </div>
      </section>
      <div style="background:#27272a;border:1px solid rgba(239,68,68,0.4);border-radius:8px;padding:22px;margin-top:16px;box-shadow:0 8px 24px rgba(0,0,0,0.35);">
        <div style="display:flex;align-items:center;gap:8px;color:#f87171;font-weight:600;font-size:15px;">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
          用量统计面板渲染遇到异常
        </div>
        <p style="color:#e4e4e7;font-size:13px;margin:14px 0;line-height:1.6;font-family:monospace;background:rgba(0,0,0,0.3);padding:10px 12px;border-radius:6px;word-break:break-all;">
          ${esc(error?.message || String(error || "未知异常"))}
        </p>
        <div style="display:flex;gap:10px;margin-top:16px;">
          <button type="button" data-pi-usage-retry-btn style="padding:8px 16px;border-radius:6px;cursor:pointer;background:#38bdf8;color:#09090b;font-weight:600;border:none;font-size:13px;">
            重试加载
          </button>
          <button type="button" data-pi-usage-reset-filters-btn style="padding:8px 16px;border-radius:6px;cursor:pointer;background:#3f3f46;color:#f4f4f5;border:1px solid rgba(255,255,255,0.15);font-size:13px;">
            重置筛选条件
          </button>
        </div>
      </div>
    </div>`;

    const retryBtn = panel.querySelector("[data-pi-usage-retry-btn]");
    if (retryBtn) {
      retryBtn.addEventListener("click", async () => {
        if (!panel.isConnected || (hooks && hooks.enabled && !hooks.enabled())) return;
        retryBtn.disabled = true;
        retryBtn.textContent = "正在拉取最新快照...";
        try {
          await refresh({
            isCancelled: () => !panel.isConnected || (hooks && hooks.enabled && !hooks.enabled()),
          });
          if (panel.isConnected && (!hooks || !hooks.enabled || hooks.enabled())) {
            render(panel, nav, hooks);
          }
        } catch (retryErr) {
          if (panel.isConnected && (!hooks || !hooks.enabled || hooks.enabled())) {
            const currentCore = getCore();
            if (root.__PI_ENH_USAGE_LEDGER__ && currentCore && typeof currentCore.aggregate === "function") {
              render(panel, nav, hooks);
              return;
            }
            _renderErrorFallback(panel, nav, hooks, retryErr);
          }
        }
      });
    }

    panel.querySelector("[data-pi-usage-reset-filters-btn]")?.addEventListener("click", () => {
      resetFilters();
      render(panel, nav, hooks);
    });
  }

  const outsideClickDisposers = new WeakMap();
  function dispose(panel) {
    outsideClickDisposers.get(panel)?.();
    outsideClickDisposers.delete(panel);
  }

  function render(panel, nav, hooks) {
    if (!panel) return;
    dispose(panel);
    try {
      _renderInternal(panel, nav, hooks);
    } catch (err) {
      console.error("[UsagePanel] 渲染遭遇未捕获异常:", err);
      _renderErrorFallback(panel, nav, hooks, err);
    }
  }

  function _renderInternal(panel, nav, hooks) {
    let ledger = read();
    if (!ledger) {
      _renderLoading(panel);
      refresh({
        isCancelled: () => !panel.isConnected || (hooks && hooks.enabled && !hooks.enabled()),
      })
        .then(() => {
          if (panel.isConnected && (!hooks || !hooks.enabled || hooks.enabled())) {
            render(panel, nav, hooks);
          }
        })
        .catch(err => {
          if (panel.isConnected && (!hooks || !hooks.enabled || hooks.enabled())) {
            if (err?.message === "刷新操作已取消" && activeRetryContext) {
              return;
            }
            _renderErrorFallback(panel, nav, hooks, err);
          }
        });
      return;
    }

    const core = getCore();
    if (!core || typeof core.aggregate !== "function") {
      throw new Error("核心用量依赖未加载 (PiUsageLedger 缺失或未就绪)");
    }

    const saved = readSavedFilters();
    if (VALID_TIME_RANGES.has(saved.timeRange)) timeRange = saved.timeRange;
    if (VALID_ROLES.has(saved.role)) role = saved.role;
    if (typeof saved.model === "string") model = saved.model;
    if (typeof saved.startDate === "string") startDate = saved.startDate;
    if (typeof saved.endDate === "string") endDate = saved.endDate;

    if (!startDate && typeof core.day === "function") {
      startDate = core.day(Date.now() - 6 * 86400000);
    }
    if (!endDate && typeof core.day === "function") {
      endDate = core.day(Date.now());
    }

    const now = Date.now();

    // 每次打开面板时，若距离上次检查超过 15 秒，在后台静默获取最新服务端快照对齐
    const AUTO_REFRESH_INTERVAL_MS = 15000;
    if (now - lastAutoRefreshCheckTime > AUTO_REFRESH_INTERVAL_MS) {
      lastAutoRefreshCheckTime = now;
      refresh({
        auto: true,
        retryDelays: [3000],
        isCancelled: () => !panel.isConnected || (hooks && hooks.enabled && !hooks.enabled()),
      })
        .then(fresh => {
          if (panel.isConnected && (!hooks || !hooks.enabled || hooks.enabled())) {
            if (fresh && ledger && fresh.snapshotId !== ledger.snapshotId) {
              render(panel, nav, hooks);
              const statusEl = panel.querySelector("[data-usage-refresh-status]");
              if (statusEl) {
                const pad = n => String(n).padStart(2, "0");
                const d = new Date();
                statusEl.textContent = `已自动同步最新数据 (${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())})`;
              }
            }
          }
        })
        .catch(err => {
          if (panel.isConnected && (!hooks || !hooks.enabled || hooks.enabled())) {
            if (err?.message === "刷新操作已取消") return;
            const statusEl = panel.querySelector("[data-usage-refresh-status]");
            if (statusEl) {
              statusEl.textContent = `自动同步失败，保留已有快照：${err?.message || err}`;
            }
          }
        });
    }

    const todayStr = typeof core.day === "function" ? core.day(now) : "";
    const yesterdayStr = typeof core.day === "function" ? core.day(now - 86400000) : "";
    const mYesterday = yesterdayStr ? yesterdayStr.slice(5).replace(/^0/, "").replace(/-0?/, "/") : "昨天";
    const beijingHours = (new Date(now + 8 * 3600000)).getUTCHours();
    const isEarlyMorning = beijingHours >= 0 && beijingHours < 6;

    let stats = core.aggregate(ledger, { timeRange, model, role, startDate, endDate });
    if (!stats) stats = { totalTokens: 0, costNano: 0, messageCount: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, sessionCount: 0, calls: 0, roles: {}, modelBreakdowns: [], allModels: [], topSessions: [] };
    if (!stats.roles) stats.roles = {};
    if (!Array.isArray(stats.modelBreakdowns)) stats.modelBreakdowns = [];
    if (!Array.isArray(stats.allModels)) stats.allModels = [];
    if (!Array.isArray(stats.topSessions)) stats.topSessions = [];

    if (model !== "all" && !stats.allModels.some(([key]) => key === model)) {
      model = "all";
      persistFilters({ timeRange, model, role, startDate, endDate });
      const dynamicCore = getCore();
      stats = (dynamicCore && typeof dynamicCore.aggregate === "function")
        ? dynamicCore.aggregate(ledger, { timeRange, model, role, startDate, endDate }) || stats
        : stats;
    }
    const unknown = Array.isArray(ledger.unverifiedLegacy) ? ledger.unverifiedLegacy : [];

    panel.dataset.usageSnapshot = ledger.snapshotId || "local";
    panel.dataset.totalTokens = stats.totalTokens || 0;
    panel.dataset.costNano = stats.costNano || 0;
    panel.dataset.messageCount = stats.messageCount || 0;
    panel.dataset.usageTimeRange = timeRange;
    panel.dataset.usageRole = role;
    panel.dataset.usageModel = model;

    const sourcesEntries = Object.entries(ledger.sources || {});
    let hasUnaccountedOrPending = false;
    let unaccountedDetails = [];

    const sourcesDesc = sourcesEntries.length > 0
      ? sourcesEntries.map(([key, val]) => {
          let badges = [];
          if (val?.frozen) badges.push("历史冻结，不再实时同步");
          const audit = val?.audit;
          const unacc = audit?.unaccountedNestedUsage;
          if (unacc && (unacc.count > 0 || unacc.tokens > 0)) {
            hasUnaccountedOrPending = true;
            badges.push(`存在未计入嵌套用量(${unacc.count ?? 0}处 · ${tokens(unacc.tokens ?? 0)} Token)`);
            unaccountedDetails.push(`${key}: 未计入嵌套用量 ${unacc.count} 处 (${tokens(unacc.tokens)} Token)`);
          }
          if (audit?.pendingSubagentCalls) {
            hasUnaccountedOrPending = true;
            badges.push(`待回传子任务 ${audit.pendingSubagentCalls} 个`);
            unaccountedDetails.push(`${key}: 待回传子任务 ${audit.pendingSubagentCalls} 个`);
          }
          const badgeStr = badges.length > 0 ? ` [${badges.join(" · ")}]` : "";
          return `${esc(key)}${esc(badgeStr)} ${val?.fileCount ?? 0} 个文件（${esc(val?.scannedAt ?? "近期")}）`;
        }).join("；")
      : "本地持久账本";

    const rangeDesc = getTimeRangeDescription(timeRange, now, startDate, endDate);
    const globalDenom = (stats.inputTokens || 0) + (stats.cacheReadTokens || 0);
    const globalHitRate = globalDenom > 0 ? `${(((stats.cacheReadTokens || 0) / globalDenom) * 100).toFixed(1)}%` : "0.0%";
    const globalWriteHint = (stats.cacheWriteTokens || 0) > 0 ? ` · 写 ${tokens(stats.cacheWriteTokens)}` : "";

    const mainRangeKeys = [
      ["today", formatTimeRangeLabel("today", now)],
      ["yesterday", formatTimeRangeLabel("yesterday", now)],
      ["all", "全部历史"],
    ];
    const dropdownRangeKeys = [
      ["24h", "最近24小时"],
      ["7d", "近7天"],
      ["30d", "近30天"],
      ["custom", "自定义"],
    ];
    const isDropdownActive = dropdownRangeKeys.some(([k]) => k === timeRange);
    const activeDropdownItem = dropdownRangeKeys.find(([k]) => k === timeRange);
    const dropdownLabel = isDropdownActive ? activeDropdownItem[1] : "更多";

    panel.innerHTML = `<div class="pi-enh-usage-panel-content">
      <section class="pi-enh-usage-header-pro">
        <div class="pi-enh-usage-controls-grid">
          <!-- 行 1 左：标题与范围 -->
          <div class="pi-enh-usage-title-row pi-enh-usage-grid-col-left" style="margin-bottom:0;">
            <div>
              <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
                <h2 style="margin:0;font-size:20px;font-weight:700;color:#f4f4f5;line-height:1.4;">Usage</h2>
                <button type="button" data-pi-usage-sync-btn data-pi-usage-top-sync-btn title="立即触发全量扫描并刷新最新统计" style="display:inline-flex;align-items:center;gap:5px;padding:3px 10px;background:rgba(59,130,246,0.15);color:#93c5fd;border:1px solid rgba(59,130,246,0.35);border-radius:14px;font-size:11.5px;font-weight:600;cursor:pointer;transition:all 0.15s;white-space:nowrap;flex-shrink:0;">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>
                  <span style="white-space:nowrap;">刷新</span>
                </button>
                <span data-usage-refresh-status role="status" style="font-size:12px;color:#38bdf8;font-weight:500;min-width:0;word-break:break-word;"></span>
              </div>
              <div style="font-size:12px;color:#38bdf8;font-weight:500;margin-top:4px;">当前范围：${esc(rangeDesc)}</div>
            </div>
          </div>

          <!-- 行 1 右：时间分段控制与更多下拉菜单 -->
          <div class="pi-enh-usage-header-time-col pi-enh-usage-grid-col-right" style="justify-self:start;display:flex;align-items:center;flex-wrap:wrap;gap:8px;max-width:100%;">
            <div class="pi-enh-segmented-control" role="tablist" style="position:relative;">
              ${mainRangeKeys.map(([key, label]) => `<button class="pi-enh-segment-btn ${timeRange === key ? "active" : ""}" data-usage-time="${key}">${label}</button>`).join("")}
              <div class="pi-enh-time-dropdown-wrap" style="position:relative;display:inline-flex;">
                <button type="button" class="pi-enh-segment-btn pi-enh-time-dropdown-btn ${isDropdownActive ? "active" : ""}" data-pi-usage-dropdown-toggle style="display:inline-flex;align-items:center;gap:4px;" title="选择更多时间范围">
                  <span>${esc(dropdownLabel)}</span>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="pi-enh-dropdown-triangle"><polyline points="6 9 12 15 18 9"></polyline></svg>
                </button>
                <div class="pi-enh-time-dropdown-menu" style="display:none;position:absolute;top:calc(100% + 4px);right:0;z-index:90;min-width:130px;background:#27272a;border:1px solid rgba(255,255,255,0.14);border-radius:8px;padding:4px;box-shadow:0 8px 24px rgba(0,0,0,0.5);flex-direction:column;gap:2px;box-sizing:border-box;">
                  ${dropdownRangeKeys.map(([key, label], idx) => `
                    ${idx === dropdownRangeKeys.length - 1 ? '<div class="pi-enh-dropdown-divider" style="height:1px;background:rgba(255,255,255,0.08);margin:3px 0;"></div>' : ''}
                    <button type="button" class="pi-enh-dropdown-item ${timeRange === key ? "active" : ""}" data-usage-time="${key}" style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 10px;font-size:12px;background:${timeRange === key ? 'rgba(56,189,248,0.15)' : 'transparent'};color:${timeRange === key ? '#38bdf8' : '#e4e4e7'};border:none;border-radius:6px;cursor:pointer;text-align:left;white-space:nowrap;transition:all 0.12s ease;width:100%;box-sizing:border-box;">
                      <span>${label}</span>
                      ${timeRange === key ? '<span style="font-size:11px;font-weight:700;">✓</span>' : ''}
                    </button>
                  `).join("")}
                </div>
              </div>
            </div>
            <div class="pi-enh-usage-custom-dates" style="display:${timeRange === "custom" ? "inline-flex" : "none"};align-items:center;gap:6px;">
              <input type="date" class="pi-enh-pro-date-input" data-usage-start-date value="${esc(startDate)}" style="background:#18181b;color:#f4f4f5;border:1px solid rgba(255,255,255,0.18);border-radius:6px;padding:3px 8px;font-size:12px;color-scheme:dark;outline:none;">
              <span style="color:#71717a;font-size:12px;">至</span>
              <input type="date" class="pi-enh-pro-date-input" data-usage-end-date value="${esc(endDate)}" style="background:#18181b;color:#f4f4f5;border:1px solid rgba(255,255,255,0.18);border-radius:6px;padding:3px 8px;font-size:12px;color-scheme:dark;outline:none;">
            </div>
          </div>

          <!-- 提示条（跨两列） -->
          ${(timeRange === "today" && isEarlyMorning) ? `
          <div class="pi-enh-usage-grid-full" style="grid-column: 1 / -1; margin:6px 0 2px;padding:8px 12px;background:rgba(56,189,248,0.08);border:1px solid rgba(56,189,248,0.22);border-radius:6px;font-size:12px;color:#7dd3fc;line-height:1.5;">
            💡 提示：当前已进入北京时间 <strong>${esc(todayStr)}</strong>。若需查看 <strong>${esc(yesterdayStr)}</strong> 白天及夜晚的累计消耗，请切换至【<strong>昨天 (${esc(mYesterday)})</strong>】或【<strong>最近24小时</strong>】。
          </div>` : ""}
          ${(timeRange === "24h" && stats.timeCoverage && (stats.timeCoverage.excludedTokens > 0 || stats.timeCoverage.excludedRecords > 0)) ? `
          <div class="pi-enh-usage-grid-full pi-enh-time-coverage-warning" style="grid-column: 1 / -1; margin:6px 0 2px;padding:8px 12px;background:rgba(251,191,36,0.08);border:1px solid rgba(251,191,36,0.25);border-radius:6px;font-size:12px;color:#fbbf24;line-height:1.5;">
            ⚠️ 24小时统计提示：有 ${tokens(stats.timeCoverage.excludedTokens)} Token（${stats.timeCoverage.excludedRecords} 条记录）因历史按天聚合缺少精确时间戳而被排除在最近24小时精确窗口外。
          </div>` : ""}

          <!-- 行 2 左：执行角色 -->
          <div class="pi-enh-usage-grid-col-left" style="justify-self:start;max-width:100%;">
            <label style="display:inline-flex;align-items:center;gap:6px;font-size:12px;color:#a1a1aa;white-space:nowrap;min-width:0;max-width:100%;">
              <span style="white-space:nowrap;flex-shrink:0;">执行角色</span>
              <select class="pi-enh-pro-select" data-usage-role-select style="color-scheme:dark;background:#18181b;color:#f4f4f5;min-width:0;"><option value="all" style="background:#18181b;color:#f4f4f5;">全部角色</option>${Object.entries(roleNames).map(([key, label]) => `<option value="${key}" ${role === key ? "selected" : ""} style="background:#18181b;color:#f4f4f5;">${label}</option>`).join("")}</select>
            </label>
          </div>

          <!-- 行 2 右：筛选模型（严格对齐右上时间控制器列边界！） -->
          <div class="pi-enh-usage-sub-row pi-enh-usage-grid-col-right" style="justify-self:start;max-width:100%;">
            <label style="display:inline-flex;align-items:center;gap:6px;font-size:12px;color:#a1a1aa;white-space:nowrap;min-width:0;max-width:100%;">
              <span style="white-space:nowrap;flex-shrink:0;">筛选模型</span>
              <select class="pi-enh-pro-select" data-usage-model-select style="max-width:320px;min-width:0;color-scheme:dark;background:#18181b;color:#f4f4f5;"><option value="all" style="background:#18181b;color:#f4f4f5;">全部合并模型 (${stats.allModels.length})</option>${stats.allModels.map(([key, label]) => `<option value="${esc(key)}" ${model === key ? "selected" : ""} style="background:#18181b;color:#f4f4f5;">${esc(label)}</option>`).join("")}</select>
            </label>
          </div>
        </div>
        <p style="font-size:12px;color:#a1a1aa;line-height:1.7;" data-usage-provenance>
          服务端快照 ${esc(ledger.snapshotId || "local")} · 生成于 ${esc(ledger.generatedAt || "未知时间")}<br>
          来源：${sourcesDesc}<br>
          按调用发生日期（北京时间）统计。运行中子任务完成回传才入账。
        </p>
        ${hasUnaccountedOrPending ? `
        <div class="pi-enh-incomplete-audit-notice" style="margin:10px 0 8px;padding:10px 14px;background:rgba(234,179,8,0.12);border:1px solid rgba(234,179,8,0.35);border-radius:8px;font-size:12px;color:#fef08a;box-sizing:border-box;">
          <div class="pi-enh-incomplete-audit-notice-body" style="display:flex;align-items:flex-start;gap:8px;">
            <span style="font-size:16px;line-height:1.4;flex-shrink:0;">⚠️</span>
            <span style="line-height:1.5;">当前账本中存在未计完的嵌套用量或待回传子任务（${esc(unaccountedDetails.join("；"))}），当前数据非全部完成状态，不可视为全部成功闭环。</span>
          </div>
          <button type="button" data-pi-usage-audit-sync-btn style="display:inline-flex;align-items:center;gap:5px;padding:5px 12px;background:#eab308;color:#000;font-weight:700;border:none;border-radius:6px;cursor:pointer;font-size:12px;white-space:nowrap;flex-shrink:0;box-shadow:0 1px 4px rgba(0,0,0,0.25);transition:opacity 0.15s;">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>
            <span>立刻完成新统计</span>
          </button>
        </div>` : ""}
      </section>

      <div class="pi-enh-kpi-pro-grid">
        ${card("涉及会话", stats.sessionCount || 0, `${stats.messageCount || 0} 条模型回复 · ${stats.calls || 0} 个子任务`)}
        ${card("非缓存输入 Token", tokens(stats.inputTokens || 0), `输出 ${tokens(stats.outputTokens || 0)}`)}
        ${card("总 Token（含缓存）", tokens(stats.totalTokens || 0), `缓存读 ${tokens(stats.cacheReadTokens || 0)} · 命中率 ${globalHitRate}${globalWriteHint}`)}
        ${card("预估费用 (Cost)", cost(stats), stats.unpricedTokens ? `未定价用量 ${tokens(stats.unpricedTokens)}` : "按 Pi SDK 模型目录参考价与原生记录核算，非账单")}
      </div>

      <p style="font-size:12px;color:#a1a1aa;line-height:1.7;">
        💡 费用核算说明：优先采用原生记录的 SDK 上报费用（如 OpenAI 旗舰模型）；对代理网关未上报价格的模型，按 Pi SDK 模型目录参考单价（如 Gemini Flash: 输入$0.10/M、输出$0.40/M、缓存$0.025/M）基准测算，非账单承诺。下方角色与模型卡片均严格对应同一筛选范围。
      </p>

      <div class="pi-enh-model-cards-grid pi-enh-role-cards-grid" data-usage-roles>
        ${Object.entries(roleNames).map(([key, label]) => {
          const r = stats.roles[key] || { totalTokens: 0, costNano: 0, messageCount: 0, calls: 0, records: 0 };
          return `<div class="pi-enh-model-card pi-enh-role-card" data-usage-role="${key}" data-tokens="${r.totalTokens || 0}" data-cost-nano="${r.costNano || 0}" data-messages="${r.messageCount || 0}">
            <div class="pi-enh-model-card-title">${label}</div>
            <div class="role-token-value" style="font-size:22px;margin:10px 0 6px;font-weight:700;">${tokens(r.totalTokens || 0)} Token</div>
            <div class="role-cost-value" style="font-size:14px;font-weight:600;color:#7dd3fc;">${cost(r)}</div>
            <p class="role-meta-text" style="font-size:11.5px;color:#a1a1aa;margin-top:6px;line-height:1.45;">${r.messageCount || 0} 条模型回复 · ${r.calls || 0} 个子任务 · ${r.records || 0} 条用量记录</p>
          </div>`;
        }).join("")}
      </div>

      <h3 style="font-size:14px;margin-top:28px;">分模型消耗明细 (Per-Model Breakdown)</h3>
      <p style="font-size:12px;color:#a1a1aa;line-height:1.6;margin:8px 0 22px;">
        💡 <strong>统计口径说明</strong>：各模型“总计消耗” = 主会话直接 + 执行 Sub agent + 系统工具/摘要。调度 Sub agent 消耗计入实际被调用的执行模型自身卡片，两者非可相加。
      </p>

      <div class="pi-enh-model-cards-grid" data-usage-models>
        ${stats.modelBreakdowns.map(m => {
          const mRoles = m.roles || { main: {}, subagent: {}, system: {} };
          const mainTokens = mRoles.main?.totalTokens || 0;
          const workerTokens = m.workerSubagents?.tokens || mRoles.subagent?.totalTokens || 0;
          const workerCalls = m.workerSubagents?.calls || 0;
          const workerMessages = m.workerSubagents?.messages || mRoles.subagent?.messageCount || 0;
          const dispatchedTokens = m.dispatchedSubagents?.tokens || 0;
          const dispatchedCalls = m.dispatchedSubagents?.calls || 0;
          const systemTokens = mRoles.system?.totalTokens || 0;

          // 比例条仅基于该模型自身的物理总消耗（主会话 vs 执行 Sub agent vs 系统工具）
          const base = m.totalTokens || 1;
          const mainRatio = Math.round((mainTokens / base) * 100);
          const workerRatio = Math.round((workerTokens / base) * 100);
          const systemRatio = Math.max(0, 100 - mainRatio - workerRatio);

          const savingsHtml = (m.dispatchedSubagents && m.dispatchedSubagents.savedCost > 0) ? (() => {
            const d = m.dispatchedSubagents;
            const mainCost = (mRoles.main?.costNano || 0) / 1e9;
            return `
          <div class="pi-enh-subagent-savings-panel">
            <div class="pi-enh-savings-header">
              <span class="pi-enh-savings-title">委派 Sub agent 降本分析</span>
              <span class="pi-enh-savings-badge">节省 $${d.savedCost.toFixed(3)} (筛选期整体少花 ${d.overallSavedRatio}%)</span>
            </div>
            <div class="pi-enh-savings-breakdown">
              <span>主模型直接 M: $${mainCost.toFixed(4)}</span>
              <span class="pi-enh-savings-sep">·</span>
              <span>子 Agent 实际 S: $${(d.actualCost || 0).toFixed(4)}</span>
              <span class="pi-enh-savings-sep">·</span>
              <span>假设全主模型 M+H: $${(d.allMainTotalCost || d.hypotheticalCost || 0).toFixed(4)}</span>
            </div>
            <div class="pi-enh-savings-subnote">
              * 子任务自身少花 ${d.subSavedRatio}% · 筛选期整体少花 ${d.overallSavedRatio}%（筛选期范围基准测算，非实际账单承诺）
            </div>
          </div>`;
          })() : "";

          const inTok = m.inputTokens || 0;
          const crTok = m.cacheReadTokens || 0;
          const cwTok = m.cacheWriteTokens || 0;
          const denom = inTok + crTok;
          const hitRate = denom > 0 ? `${((crTok / denom) * 100).toFixed(1)}%` : "0.0%";

          return `<div class="pi-enh-model-card" data-model-key="${esc(m.key)}" data-tokens="${m.totalTokens || 0}" data-cost-nano="${m.costNano || 0}" data-messages="${m.messageCount || 0}">
          <div class="pi-enh-model-card-header">
            <div class="pi-enh-model-card-title">
              <span class="pi-enh-model-dot"></span>
              <span>${esc(m.name)}</span>
            </div>
            <span class="pi-enh-model-card-badge">${(m.percentage || 0).toFixed(1)}%</span>
          </div>
          <div style="font-size:11px;color:#38bdf8;margin:6px 0 8px;font-weight:500;">渠道：${esc(m.provider)}</div>
          <div class="pi-enh-model-card-kpis">
            ${[
              ["涉及会话", m.sessionCount || 0],
              ["模型回复", m.messageCount || 0],
              ["输入 Token", tokens(inTok)],
              ["输出 Token", tokens(m.outputTokens || 0)],
              ["缓存读", tokens(crTok)],
              ["缓存命中率", hitRate, cwTok > 0 ? `缓存读取 / (非缓存输入 + 缓存读取) · 缓存写 ${tokens(cwTok)}` : "缓存读取 / (非缓存输入 + 缓存读取)"],
              ["总计消耗", tokens(m.totalTokens || 0)],
              ["预估费用", cost(m)],
            ].map(([key, val, hint]) => `<div class="metric-item"${hint ? ` title="${esc(hint)}"` : ""}><span class="lbl">${key}</span><span class="val ${key === '总计消耗' ? 'highlight' : key === '预估费用' ? 'cost' : ''}">${val}</span></div>`).join("")}
          </div>
          ${savingsHtml}
          <div style="margin-top:10px;padding:8px 10px;background:rgba(255,255,255,0.025);border:1px solid rgba(255,255,255,0.06);border-radius:6px;box-sizing:border-box;">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:11px;line-height:1.4;">
              <span style="color:#a1a1aa;white-space:nowrap;">主会话直接:</span>
              <span style="font-weight:600;color:#f4f4f5;font-variant-numeric:tabular-nums;white-space:nowrap;">${tokens(mainTokens)}</span>
            </div>
            <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:11px;line-height:1.4;margin-top:4px;">
              <span style="color:${workerTokens > 0 ? '#38bdf8' : '#71717a'};font-weight:500;white-space:nowrap;">执行 Sub agent:</span>
              <span style="font-weight:700;color:${workerTokens > 0 ? '#38bdf8' : '#71717a'};background:${workerTokens > 0 ? 'rgba(56,189,248,0.14)' : 'transparent'};padding:1px 6px;border-radius:3px;font-variant-numeric:tabular-nums;white-space:nowrap;">
                ${tokens(workerTokens)}${workerCalls > 0 || workerMessages > 0 ? ` (${workerCalls}个任务 · ${workerMessages}条回复)` : ""}
              </span>
            </div>
            ${dispatchedTokens > 0 ? `
            <div class="pi-enh-dispatch-row">
              <span class="pi-enh-dispatch-lbl">调度 Sub agent:</span>
              <span class="pi-enh-dispatch-badge">
                ${tokens(dispatchedTokens)} (${dispatchedCalls}个任务)
              </span>
            </div>
            <div class="pi-enh-dispatch-total-row">
              <span class="pi-enh-dispatch-total-lbl">主控总调度负荷 (含Sub):</span>
              <span class="pi-enh-dispatch-total-val">
                ${tokens(mainTokens + dispatchedTokens)}
              </span>
            </div>` : ""}
            ${systemTokens > 0 ? `
            <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:11px;line-height:1.4;margin-top:4px;">
              <span style="color:#fbbf24;font-weight:500;white-space:nowrap;">系统工具/摘要:</span>
              <span style="font-weight:600;color:#fbbf24;font-variant-numeric:tabular-nums;white-space:nowrap;">${tokens(systemTokens)}</span>
            </div>` : ""}
            <div class="pi-enh-role-ratio-bar" style="height:3px;background:rgba(255,255,255,0.08);border-radius:2px;overflow:hidden;display:flex;margin-top:6px;" title="主会话(灰) vs 执行Sub(蓝) vs 系统工具(黄)">
              <div style="height:100%;background:#d4d4d8;width:${mainRatio}%;"></div>
              <div style="height:100%;background:#38bdf8;width:${workerRatio}%;"></div>
              <div style="height:100%;background:#fbbf24;width:${systemRatio}%;"></div>
            </div>
            <div style="font-size:10px;color:#a1a1aa;margin-top:6px;line-height:1.4;">
              * 本模型直接总计 = 主会话 (${tokens(mainTokens)}) + 执行Sub (${tokens(workerTokens)}) + 系统工具 (${tokens(systemTokens)}) = ${tokens(m.totalTokens || 0)}
              ${dispatchedTokens > 0 ? `<br><span class="pi-enh-dispatch-note">* 调度 Sub agent (${tokens(dispatchedTokens)}) 计入执行模型自身的直接消耗。由本模型牵头的任务总负荷实为 <strong>${tokens(mainTokens + dispatchedTokens)}</strong>。</span>` : ""}
            </div>
          </div>
          ${(m.key !== "system-summaries" && (m.totalTokens || 0) > 0) ? (() => {
            const flashUsd = (((m.inputTokens || 0) * 0.15 + (m.outputTokens || 0) * 0.60 + (m.cacheReadTokens || 0) * 0.003 + (m.cacheWriteTokens || 0) * 0.003) / 1e6);
            const flashCny = (((m.inputTokens || 0) * 1.00 + (m.outputTokens || 0) * 4.00 + (m.cacheReadTokens || 0) * 0.02 + (m.cacheWriteTokens || 0) * 0.02) / 1e6);

            let subInfo = "";
            if (workerTokens > 0) {
              const subFlashUsd = (((mRoles.subagent?.inputTokens || 0) * 0.15 + (mRoles.subagent?.outputTokens || 0) * 0.60 + (mRoles.subagent?.cacheReadTokens || 0) * 0.003 + (mRoles.subagent?.cacheWriteTokens || 0) * 0.003) / 1e6);
              const subFlashCny = (((mRoles.subagent?.inputTokens || 0) * 1.00 + (mRoles.subagent?.outputTokens || 0) * 4.00 + (mRoles.subagent?.cacheReadTokens || 0) * 0.02 + (mRoles.subagent?.cacheWriteTokens || 0) * 0.02) / 1e6);
              subInfo = `<div style="font-size:10px;color:#7dd3fc;margin-top:2px;">含执行 Sub agent (${tokens(workerTokens)}): $${subFlashUsd.toFixed(3)} (约 ¥${subFlashCny.toFixed(2)})</div>`;
            }

            return `
          <div data-usage-deepseek-estimate style="margin-top:10px;padding:8px 10px;background:rgba(56,189,248,0.05);border:1px solid rgba(56,189,248,0.22);border-radius:6px;box-sizing:border-box;">
            <div style="display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:6px;">
              <div style="display:flex;flex-wrap:wrap;align-items:center;gap:6px;">
                <span style="font-size:13px;font-weight:700;color:#38bdf8;font-variant-numeric:tabular-nums;">折算 DeepSeek-V4.1 Flash 低谷期: $${flashUsd.toFixed(3)}</span>
                <span style="font-size:10px;color:#7dd3fc;border:1px solid rgba(56,189,248,0.3);border-radius:3px;padding:0 4px;">约 ¥${flashCny.toFixed(2)}</span>
              </div>
              <span style="font-size:10px;color:#71717a;border:1px solid rgba(255,255,255,0.1);border-radius:3px;padding:0 4px;">闲时 5折</span>
            </div>
            <div style="font-size:11px;color:#a1a1aa;margin-top:4px;line-height:1.4;">
              按当前内置低谷单价（输入 $0.15/M，输出 $0.60/M，缓存命中 $0.003/M）基准测算。
              ${subInfo}
            </div>
          </div>
          `;
          })() : ''}
          <div class="pi-enh-progress-track"><div class="pi-enh-progress-fill" style="width:${m.percentage || 0}%"></div></div>
        </div>`;
        }).join("") || '<div style="padding:20px;text-align:center;color:#71717a;font-size:13px;">当前筛选范围内无模型消耗记录</div>'}
      </div>

      <h3 style="font-size:14px;margin-top:28px;">高消耗会话 Top 10</h3>
      <div class="pi-enh-top-sessions-list">
        ${stats.topSessions.map((s, i) => `<div class="pi-enh-top-session-row" data-goto-session="${esc(s.id)}">
          <span class="pi-enh-session-rank-badge">#${i + 1}</span>
          <span class="session-title">${esc(s.title || s.id)}</span>
          <span class="session-tokens">${tokens(s.totalTokens || 0)} · ${cost(s)}</span>
        </div>`).join("")}
      </div>

      ${unknown.length ? `<p style="color:#fbbf24;font-size:12px;">另保留 ${unknown.length} 个旧账本会话，但原始记录不可核验，未混入以上合计。</p>` : ""}
      ${stats.missingUsage ? `<p style="color:#fbbf24;">${stats.missingUsage} 条回复缺 usage，未按消息数编造 Token。</p>` : ""}
    </div>`;

    const rerender = () => render(panel, nav, hooks);
    panel.querySelectorAll("[data-usage-time]").forEach(btn => {
      btn.onclick = () => {
        timeRange = btn.dataset.usageTime;
        persistFilters({ timeRange, model, role, startDate, endDate });
        rerender();
      };
    });

    const dropdownToggle = panel.querySelector("[data-pi-usage-dropdown-toggle]");
    const dropdownMenu = panel.querySelector(".pi-enh-time-dropdown-menu");
    if (dropdownToggle && dropdownMenu) {
      dropdownToggle.onclick = (e) => {
        e.stopPropagation();
        const isOpen = dropdownMenu.style.display === "flex";
        if (isOpen) {
          dropdownMenu.style.display = "none";
          dropdownToggle.setAttribute("aria-expanded", "false");
          const tri = dropdownToggle.querySelector(".pi-enh-dropdown-triangle");
          if (tri) tri.style.transform = "none";
        } else {
          dropdownMenu.style.display = "flex";
          dropdownToggle.setAttribute("aria-expanded", "true");
          const tri = dropdownToggle.querySelector(".pi-enh-dropdown-triangle");
          if (tri) tri.style.transform = "rotate(180deg)";
        }
      };

      const handleOutsideClick = (e) => {
        if (!panel.contains(e.target) || (!dropdownToggle.contains(e.target) && !dropdownMenu.contains(e.target))) {
          dropdownMenu.style.display = "none";
          dropdownToggle.setAttribute("aria-expanded", "false");
          const tri = dropdownToggle.querySelector(".pi-enh-dropdown-triangle");
          if (tri) tri.style.transform = "none";
          document.removeEventListener("click", handleOutsideClick);
        }
      };
      outsideClickDisposers.set(panel, () => document.removeEventListener("click", handleOutsideClick));
      dropdownToggle.addEventListener("click", () => {
        if (dropdownMenu.style.display === "flex") {
          document.addEventListener("click", handleOutsideClick);
        } else {
          document.removeEventListener("click", handleOutsideClick);
        }
      });
    }
    const startInput = panel.querySelector("[data-usage-start-date]");
    if (startInput) {
      startInput.onchange = e => {
        startDate = e.target.value;
        persistFilters({ timeRange, model, role, startDate, endDate });
        rerender();
      };
    }
    const endInput = panel.querySelector("[data-usage-end-date]");
    if (endInput) {
      endInput.onchange = e => {
        endDate = e.target.value;
        persistFilters({ timeRange, model, role, startDate, endDate });
        rerender();
      };
    }
    const modelSelect = panel.querySelector("[data-usage-model-select]");
    if (modelSelect) {
      modelSelect.onchange = e => {
        model = e.target.value;
        persistFilters({ timeRange, model, role, startDate, endDate });
        rerender();
      };
    }
    const roleSelect = panel.querySelector("[data-usage-role-select]");
    if (roleSelect) {
      roleSelect.onchange = e => {
        role = e.target.value;
        persistFilters({ timeRange, model, role, startDate, endDate });
        rerender();
      };
    }

    const triggerFullRescanAndRefresh = async () => {
      if (activeRescanPromise) {
        return activeRescanPromise;
      }

      const allSyncBtns = panel.querySelectorAll("[data-pi-usage-sync-btn], [data-pi-usage-audit-sync-btn]");
      allSyncBtns.forEach(b => { b.disabled = true; b.style.opacity = "0.65"; });
      const statusEl = panel.querySelector("[data-usage-refresh-status]");
      if (statusEl) statusEl.textContent = "⏳ 正在触发服务端全量扫描会话并统计...";

      const oldId = ledger.snapshotId;
      const postAbortCtrl = typeof AbortController !== "undefined" ? new AbortController() : null;
      const timeoutMs = getPostTimeoutMs();
      let timedOut = false;
      const postTimer = setTimeout(() => {
        timedOut = true;
        if (postAbortCtrl) postAbortCtrl.abort();
      }, timeoutMs);

      activeRescanPromise = (async () => {
        try {
          const currentHost = (typeof window !== "undefined" && window.location.hostname) ? window.location.hostname : "10.0.0.2";
          let postRes;
          try {
            postRes = await fetch(`http://${currentHost}:30149/usage/refresh`, {
              method: "POST",
              cache: "no-store",
              signal: postAbortCtrl ? postAbortCtrl.signal : undefined,
            });
          } catch (fetchErr) {
            if (timedOut || fetchErr?.name === "AbortError") {
              throw new Error("请求 40 秒超时：未在 40 秒内收到服务端扫描响应，请稍后重试");
            }
            if (currentHost !== "10.0.0.2") {
              try {
                postRes = await fetch("http://10.0.0.2:30149/usage/refresh", {
                  method: "POST",
                  cache: "no-store",
                  signal: postAbortCtrl ? postAbortCtrl.signal : undefined,
                });
              } catch (retryErr) {
                if (timedOut || retryErr?.name === "AbortError") {
                  throw new Error("请求 40 秒超时：未在 40 秒内收到服务端扫描响应，请稍后重试");
                }
                throw retryErr;
              }
            } else {
              throw fetchErr;
            }
          } finally {
            clearTimeout(postTimer);
          }

          if (!panel.isConnected || (hooks && hooks.enabled && !hooks.enabled())) return;

          let postBody = null;
          try {
            postBody = await postRes.json();
          } catch (jsonErr) {}

          if (!postRes.ok) {
            const serverError = (postBody && typeof postBody === "object" && postBody.error)
              ? String(postBody.error)
              : null;
            if (serverError) {
              throw new Error(serverError);
            }
            throw new Error(`服务端刷新失败: HTTP ${postRes.status}`);
          }

          if (!postBody || typeof postBody !== "object") {
            throw new Error("服务端刷新响应格式错误");
          }
          if (postBody.ok !== true) {
            throw new Error(postBody.error ? String(postBody.error) : "服务端返回未成功");
          }

          if (!panel.isConnected || (hooks && hooks.enabled && !hooks.enabled())) return;

          const fresh = await refresh({
            isCancelled: () => !panel.isConnected || (hooks && hooks.enabled && !hooks.enabled()),
            onProgress: ({ attempt, totalRetries, delayMs }) => {
              const curStatusEl = panel.querySelector("[data-usage-refresh-status]");
              if (panel.isConnected && curStatusEl) {
                curStatusEl.textContent = `网络短暂波动，${Math.round(delayMs / 1000)}秒后自动重试 (${attempt}/${totalRetries})...`;
              }
            },
          });

          if (!panel.isConnected || (hooks && hooks.enabled && !hooks.enabled())) return;

          render(panel, nav, hooks);
          const nextStatusEl = panel.querySelector("[data-usage-refresh-status]");
          if (nextStatusEl) {
            const d = new Date();
            const pad = n => String(n).padStart(2, "0");
            const timeStr = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
            nextStatusEl.textContent = fresh.snapshotId === oldId
              ? `快照未变化，已是对齐最新 (${timeStr})`
              : `✅ 已成功完成全量扫描与统计 (${timeStr})`;
          }
        } catch (err) {
          activeRescanPromise = null;
          if (panel.isConnected) {
            const isAbort = timedOut || err?.name === "AbortError" || String(err?.message || "").includes("40 秒") || String(err?.message || "").includes("40秒");
            const displayMsg = isAbort
              ? "请求 40 秒超时：未在 40 秒内收到服务端扫描响应，请稍后重试"
              : (err?.message || String(err || "未知异常"));
            const curStatusEl = panel.querySelector("[data-usage-refresh-status]");
            if (curStatusEl) {
              curStatusEl.textContent = `刷新失败，保留已有快照：${displayMsg}`;
            }
          }
        } finally {
          clearTimeout(postTimer);
          activeRescanPromise = null;
          if (panel.isConnected) {
            const curSyncBtns = panel.querySelectorAll("[data-pi-usage-sync-btn], [data-pi-usage-audit-sync-btn]");
            curSyncBtns.forEach(b => { b.disabled = false; b.style.opacity = ""; });
          }
        }
      })();

      return activeRescanPromise;
    };

    if (activeRescanPromise) {
      const currentSyncBtns = panel.querySelectorAll("[data-pi-usage-sync-btn], [data-pi-usage-audit-sync-btn]");
      currentSyncBtns.forEach(b => { b.disabled = true; b.style.opacity = "0.65"; });
      const currentStatusEl = panel.querySelector("[data-usage-refresh-status]");
      if (currentStatusEl) {
        currentStatusEl.textContent = "⏳ 正在触发服务端全量扫描会话并统计...";
      }
    }

    panel.querySelectorAll("[data-pi-usage-sync-btn], [data-pi-usage-audit-sync-btn]").forEach(b => {
      b.onclick = triggerFullRescanAndRefresh;
    });

    const quickTodayBtn = panel.querySelector("[data-pi-usage-quick-today-btn]");
    if (quickTodayBtn) {
      quickTodayBtn.onclick = () => {
        timeRange = "today";
        persistFilters({ timeRange, model, role, startDate, endDate });
        rerender();
      };
    }

    panel.querySelectorAll("[data-goto-session]").forEach(row => {
      row.onclick = () => {
        const sid = row.dataset.gotoSession;
        if (hooks && typeof hooks.openSession === "function") {
          hooks.openSession(sid, ledger.sessions ? ledger.sessions[sid] : null);
        }
      };
    });
  }

  // Fetch snapshots only when the usage panel opens or a deletion needs ingestion proof.
  root.PiUsagePanel = {
    render,
    dispose,
    refresh,
    fetchSnapshotOnce,
    cancelActiveRetry,
    read,
    getActiveRescanPromise: () => activeRescanPromise,
    getFilters: () => ({ timeRange, model, role, startDate, endDate }),
    setFilters: (next = {}) => updateFilters(next),
    resetFilters,
    STORAGE_KEY,
    DEFAULT_RETRY_DELAYS,
  };
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));
