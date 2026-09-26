  // Debounced DOM Synchronization and Mutex Guard
  function scheduleDomSync() {
    if (isDisposed) return;
    if (isMutatingInternally) {
      hasDeferredSync = true;
      return;
    }
    if (domSyncTimerId !== null) {
      clearTimeout(domSyncTimerId);
    }
    syncScheduled = true;
    const flush = () => {
      domSyncFrameId = null;
      domSyncTimerId = null;
      syncScheduled = false;
      if (isDisposed) return;
      runAllSyncOperations();
    };
    domSyncTimerId = setTimeout(flush, 50);
  }

  activeCleanups.push(() => {
    if (domSyncFrameId !== null && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(domSyncFrameId);
    }
    if (domSyncTimerId !== null) clearTimeout(domSyncTimerId);
    domSyncFrameId = null;
    domSyncTimerId = null;
    syncScheduled = false;
    hasDeferredSync = false;
  });

  function initChatObserver() {
    if (chatObserver) return;
    try {
      if (typeof MutationObserver !== "function") return;
      chatObserver = new MutationObserver((mutations) => {
        if (isMutatingInternally) return;
        if (observedTarget === document.body || observedTarget === document.documentElement) {
          const container = getChatContentContainer();
          if (container && container !== document.body && container !== document.documentElement) {
            chatObserver.disconnect();
            chatObserver.observe(container, { childList: true, subtree: true });
            observedTarget = container;
          }
        }
        if (isPluginEnabled("task-tool-auto-collapse")) {
          syncAllTaskToolAutoCollapse();
        }

        // 针对输入框、队列变动立即触发同步，消除 50ms 延时导致的界面跳动（带内部变更守卫防死循环）
        if (mutations && mutations.length > 0) {
          let touchesComposer = false;
          let touchesDialog = false;
          for (let i = 0; i < mutations.length; i++) {
            const m = mutations[i];
            const target = m.target;
            if (target && typeof target.closest === "function" && target.closest("fieldset, .pi-enh-queue-panel, .pi-enh-cursor-composer")) {
              touchesComposer = true;
            }
            if (m.type === "childList" && m.addedNodes && m.addedNodes.length > 0) {
              for (let j = 0; j < m.addedNodes.length; j++) {
                const node = m.addedNodes[j];
                if (node.nodeType === 1) {
                  if (node.getAttribute?.("role") === "dialog" || (typeof node.querySelector === "function" && node.querySelector('[role="dialog"]'))) {
                    touchesDialog = true;
                  }
                }
              }
            }
          }
          if (touchesComposer && !isMutatingInternally) {
            withMutationGuard(() => {
              syncCodexComposerLayout();
              syncComposerMarkdownFormat();
              syncComposerModes();
              syncComposerQueuePanel();
              syncComposerCleanPlaceholder();
              const textarea = findComposerTextarea();
              const card = textarea?.closest('fieldset > div[style*="max-width"]');
              if (card && textarea) updateCardContentState(card, textarea);
            });
          }
          if (touchesDialog && isPluginEnabled("ask-user-web-native") && !isMutatingInternally) {
            withMutationGuard(() => {
              syncAskUserWebNative();
            });
          }
        }

        scheduleDomSync();
      });

      const container = getChatContentContainer();
      observedTarget = container || document.body || document.documentElement;
      if (observedTarget) {
        chatObserver.observe(observedTarget, { childList: true, subtree: true });
      }
    } catch (e) {
      console.warn("[Pi Web Enhancements] chatObserver init warning:", e);
    }
  }

  instantDialogObserver = null;
  function initInstantDialogObserver() {
    if (instantDialogObserver || typeof MutationObserver !== "function" || typeof document === "undefined") return;
    try {
      instantDialogObserver = new MutationObserver((mutations) => {
        if (isMutatingInternally || !isPluginEnabled("ask-user-web-native")) return;
        let hasDialog = false;
        for (let i = 0; i < mutations.length; i++) {
          const m = mutations[i];
          if (m.type === "childList" && m.addedNodes && m.addedNodes.length > 0) {
            for (let j = 0; j < m.addedNodes.length; j++) {
              const node = m.addedNodes[j];
              if (node.nodeType === 1) {
                if (node.getAttribute?.("role") === "dialog" || (typeof node.querySelector === "function" && node.querySelector('[role="dialog"]'))) {
                  hasDialog = true;
                  break;
                }
              }
            }
          }
          if (hasDialog) break;
        }
        if (hasDialog) {
          withMutationGuard(() => {
            syncAskUserWebNative();
          });
        }
      });
      const root = document.documentElement || document.body;
      if (root) {
        instantDialogObserver.observe(root, { childList: true, subtree: true });
        activeCleanups.push(() => {
          if (instantDialogObserver) {
            instantDialogObserver.disconnect();
            instantDialogObserver = null;
          }
        });
      }
    } catch (e) {}
  }

  initChatObserver();
  initInstantDialogObserver();

  function syncSidebarRowsImmediate() {
    withMutationGuard(() => {
      syncSessionItemCompact();
      syncSessionPinArchiveControls();
      syncSessionBatchActions();
      syncSessionModelLabels();
      syncSessionColorEffects();
      syncSessionTags();
      syncSessionOdooAddons();
    });
  }

  sidebarObserver = null;
  function initSidebarObserver() {
    if (sidebarObserver || typeof MutationObserver !== "function" || typeof document === "undefined") return;
    try {
      sidebarObserver = new MutationObserver((mutations) => {
        if (isMutatingInternally) return;
        let hasNewSessionRows = false;
        for (let i = 0; i < mutations.length; i++) {
          const m = mutations[i];
          if (m.type === "childList" && m.addedNodes && m.addedNodes.length > 0) {
            for (let j = 0; j < m.addedNodes.length; j++) {
              const node = m.addedNodes[j];
              if (node.nodeType === 1) {
                if (node.classList?.contains("pi-enh-session-row-host") ||
                    (typeof node.querySelector === "function" && node.querySelector(".pi-enh-session-row-host"))) {
                  hasNewSessionRows = true;
                  break;
                }
              }
            }
          }
          if (hasNewSessionRows) break;
        }
        if (hasNewSessionRows && !isMutatingInternally) {
          syncSidebarRowsImmediate();
        }
      });
      const root = document.querySelector(".sidebar-container") || document.documentElement || document.body;
      if (root) {
        sidebarObserver.observe(root, { childList: true, subtree: true });
        activeCleanups.push(() => {
          if (sidebarObserver) {
            try { sidebarObserver.disconnect(); } catch (e) {}
            sidebarObserver = null;
          }
        });
      }
    } catch (e) {}
  }

  initSidebarObserver();

  try {
    const rawSessions = typeof window !== "undefined" && typeof window.__PI_ENH_GET_RAW_SESSIONS__ === "function" ? window.__PI_ENH_GET_RAW_SESSIONS__() : null;
    if (Array.isArray(rawSessions)) {
      for (const s of rawSessions) {
        if (s?.id) {
          knownSessionsMap.set(s.id, s);
          knownSessionTitles.set(s.id, computeSessionTitle(s));
        }
      }
    }
    if ((!Array.isArray(latestKnownSessionGroups) || latestKnownSessionGroups.length === 0) &&
        typeof window !== "undefined" && typeof window.__PI_ENH_RERENDER_SESSIONS__ === "function") {
      window.__PI_ENH_RERENDER_SESSIONS__();
    }
  } catch (e) {}

  // 先于定时同步建立会话列表的布局保护；移动端点击会话后不能暴露原生 hover 操作，
  // 否则选中行会在首个 800ms 同步窗口内被压缩成竖排文本。
  syncSessionPinArchiveControls();
  syncSessionBatchActions();
  void syncManifestPinnedEntries();
  void syncManifestQuickShortcuts();
  void syncManifestArchivedEntries();
  if (typeof syncManifestSessionColors === "function") void syncManifestSessionColors(false);
  if (typeof syncManifestSessionTags === "function") void syncManifestSessionTags(false);
  syncSessionItemCompact();
  syncToolCardLayoutStability();
  syncSidebarRowsImmediate();

  function showDurationTooltip(badge) {
    if (!badge || !isPluginEnabled("turn-duration")) return;
    if (usageTooltip && usageTooltip.style.display !== "none") {
      hideUsageTooltip();
    }
    const assistantMsg = badge.closest('[data-message-role="assistant"], div[data-message-role="assistant"]');
    if (!assistantMsg) return;

    // 1. Total duration accurately parsed
    let totalSec = parseInt(badge.getAttribute("data-total-sec"), 10);
    if (isNaN(totalSec) || totalSec <= 0) {
      const badgeText = badge.textContent || "";
      const mMatch = badgeText.match(/(\d+)\s*m/);
      const sMatch = badgeText.match(/(\d+(\.\d+)?)\s*s/);
      const mins = mMatch ? parseInt(mMatch[1], 10) : 0;
      const secs = sMatch ? parseFloat(sMatch[1], 10) : 0;
      totalSec = mins * 60 + secs;
    }
    if (totalSec <= 0) return;

    const queueSec = parseInt(badge.getAttribute("data-queue-sec"), 10) || 0;
    let badgeTools = {};
    try {
      badgeTools = JSON.parse(badge.getAttribute("data-tools") || "{}");
    } catch(err){}

    // 2. Scan all assistant messages belonging to this turn (from this assistant message backwards)
    const turnElements = [assistantMsg];
    let curr = assistantMsg.previousElementSibling;
    while (curr) {
      if (curr !== assistantMsg && curr.querySelector('div[title="任务执行总耗时"]')) break;
      if (curr.style && (curr.style.alignItems === "flex-end" || curr.querySelector('[class*="markdown-user-message"]'))) {
        break;
      }
      if (curr.getAttribute && curr.getAttribute("data-message-role") === "assistant") {
        turnElements.push(curr);
      }
      curr = curr.previousElementSibling;
    }

    let thinkingSec = 0;
    let toolSec = 0;
    const scannedTools = {};

    turnElements.forEach((el) => {
      // Thinking spans
      const thinkingSpans = el.querySelectorAll('button[aria-expanded] span[style*="tabular-nums"], button[aria-label*="Thinking"] span[style*="tabular-nums"]');
      thinkingSpans.forEach((sp) => {
        const s = parseFloat(sp.textContent?.replace("s", ""));
        if (!isNaN(s) && s > 0) thinkingSec += s;
      });

      // Tool call spans
      const tabularSpans = el.querySelectorAll('span[style*="tabular-nums"]');
      tabularSpans.forEach((sp) => {
        if (sp.closest("button[aria-expanded], button[aria-label*='Thinking']")) return;
        const s = parseFloat(sp.textContent?.replace("s", ""));
        if (!isNaN(s) && s > 0) {
          toolSec += s;
          const parentRow = sp.closest("div[style*='display: flex'], div[style*='display:flex']");
          const nameEl = parentRow?.querySelector("span[style*='font-mono'], span[style*='fontFamily']");
          const tName = nameEl?.textContent?.trim() || "tool";
          scannedTools[tName] = (scannedTools[tName] || 0) + 1;
        }
      });
    });

    const finalTools = Object.keys(scannedTools).length > 0 ? scannedTools : badgeTools;
    const hasTools = Object.keys(finalTools).length > 0;
    const realActiveSec = parseInt(badge.getAttribute("data-active-sec"), 10) || Math.max(1, totalSec - queueSec);
    const pausedSec = parseInt(badge.getAttribute("data-paused-sec"), 10) || 0;
    const steerCount = parseInt(badge.getAttribute("data-steer-count"), 10) || 0;
    const interruptCount = parseInt(badge.getAttribute("data-interrupt-count"), 10) || 0;

    const activeSec = Math.max(1, realActiveSec - queueSec);

    // If tools were called but tabular durations were not in DOM (e.g. collapsed/compacted)
    if (hasTools && toolSec === 0) {
      toolSec = Math.round(activeSec * 0.85);
    }
    toolSec = Math.min(activeSec, toolSec);

    let genSec = Math.max(0, activeSec - thinkingSec - toolSec);
    if (genSec === 0 && !hasTools) {
      genSec = activeSec;
    }

    const queuePct = Math.round((queueSec / totalSec) * 100);
    const pausedPct = Math.round((pausedSec / totalSec) * 100);
    const thinkingPct = Math.round((thinkingSec / totalSec) * 100);
    const toolPct = Math.round((toolSec / totalSec) * 100);
    const genPct = Math.max(0, 100 - queuePct - pausedPct - thinkingPct - toolPct);

    // 3. Construct tooltip content
    const tt = getDurationTooltip();
    tt.__currentBadge = badge;

    const uTime = parseInt(badge.getAttribute("data-u-time"), 10) || 0;
    const aTime = parseInt(badge.getAttribute("data-a-time"), 10) || 0;
    let timeRowHtml = "";
    if (uTime > 0 && aTime > 0) {
      const uStr = new Date(uTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      const aStr = new Date(aTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      let notes = [];
      if (steerCount > 0) notes.push(`含 ${steerCount} 次引导`);
      if (interruptCount > 0) notes.push(`中断 ${interruptCount} 次`);
      const notesStr = notes.length > 0 ? ` (${notes.join(" · ")})` : "";
      timeRowHtml = `
        <div class="pi-enh-tt-timestamps">
          <span>🕒 下达: ${uStr}${notesStr}</span>
          <span style="opacity: 0.35;">|</span>
          <span>🏁 完成: ${aStr}</span>
        </div>
      `;
    }

    let toolTagsHtml = "";
    const toolEntries = Object.entries(finalTools);
    if (toolEntries.length > 0) {
      toolTagsHtml = `
        <div class="pi-enh-tt-tools-detail">
          ${toolEntries.map(([tName, cnt]) => `<span class="pi-enh-tt-tool-tag">${tName} × ${cnt}</span>`).join("")}
        </div>
      `;
    }

    let queueRowHtml = "";
    let queueBarHtml = "";
    if (queueSec > 3) {
      queueBarHtml = `<div class="pi-enh-tt-bar-seg" style="width: ${queuePct}%; background: #f59e0b;" title="任务排队等待: ${queuePct}%"></div>`;
      queueRowHtml = `
        <div class="pi-enh-tt-row">
          <span style="display: flex; align-items: center; gap: 6px;">
            <span style="display: inline-flex; align-items: center; justify-content: center; width: 16px; flex-shrink: 0;">⏳</span>
            排队与首Token延迟
          </span>
          <span>${formatSec(queueSec)} (${queuePct}%)</span>
        </div>
      `;
    }

    let pausedRowHtml = "";
    let pausedBarHtml = "";
    if (pausedSec > 0) {
      pausedBarHtml = `<div class="pi-enh-tt-bar-seg" style="width: ${pausedPct}%; background: #ef4444;" title="任务中断暂停: ${pausedPct}%"></div>`;
      pausedRowHtml = `
        <div class="pi-enh-tt-row" style="color: #f87171;">
          <span style="display: flex; align-items: center; gap: 6px;">
            <span style="display: inline-flex; align-items: center; justify-content: center; width: 16px; flex-shrink: 0;">⏸️</span>
            任务中断暂停
          </span>
          <span>${formatSec(pausedSec)} (${pausedPct}%)</span>
        </div>
      `;
    }

    const titleSpanText = pausedSec > 0
      ? `<span>⏱️ 任务总耗时 (净执行)</span><span style="color: #60a5fa; font-variant-numeric: tabular-nums;">${formatSec(realActiveSec)} <span style="font-size: 11px; color: var(--text-dim, #a1a1aa); font-weight: normal;">(总历时 ${formatSec(totalSec)})</span></span>`
      : `<span>⏱️ 任务总耗时 (下达到完成)</span><span style="color: #60a5fa; font-variant-numeric: tabular-nums;">${formatSec(totalSec)}</span>`;

    tt.innerHTML = `
      <div class="pi-enh-tt-title">
        ${titleSpanText}
      </div>
      <div class="pi-enh-tt-bar">
        ${queueBarHtml}
        ${pausedBarHtml}
        ${thinkingSec > 0 ? `<div class="pi-enh-tt-bar-seg" style="width: ${thinkingPct}%; background: #a855f7;" title="深度思考: ${thinkingPct}%"></div>` : ""}
        ${toolSec > 0 ? `<div class="pi-enh-tt-bar-seg" style="width: ${toolPct}%; background: #3b82f6;" title="工具调用: ${toolPct}%"></div>` : ""}
        <div class="pi-enh-tt-bar-seg" style="width: ${genPct}%; background: #10b981;" title="生成与响应: ${genPct}%"></div>
      </div>
      ${queueRowHtml}
      ${pausedRowHtml}
      ${thinkingSec > 0 ? `
      <div class="pi-enh-tt-row">
        <span style="display: flex; align-items: center; gap: 6px;">
          <span style="display: inline-flex; align-items: center; justify-content: center; width: 16px; flex-shrink: 0;">💭</span>
          深度思考
        </span>
        <span>${formatSec(thinkingSec)} (${thinkingPct}%)</span>
      </div>` : ""}
      ${hasTools ? `
      <div class="pi-enh-tt-row">
        <span style="display: flex; align-items: center; gap: 6px;">
          <span style="display: inline-flex; align-items: center; justify-content: center; width: 16px; flex-shrink: 0;">🛠️</span>
          工具调用执行
        </span>
        <span>${formatSec(toolSec)} (${toolPct}%)</span>
      </div>` : ""}
      <div class="pi-enh-tt-row">
        <span style="display: flex; align-items: center; gap: 6px;">
          <span style="display: inline-flex; align-items: center; justify-content: center; width: 16px; flex-shrink: 0;">⚡</span>
          生成与网络响应
        </span>
        <span>${formatSec(genSec)} (${genPct}%)</span>
      </div>
      ${toolTagsHtml}
      ${timeRowHtml}
    `;

    tt.style.display = "block";
    tt.style.visibility = "visible";
    const maxAllowedWidth = Math.min(window.innerWidth - 24, 420);
    tt.style.width = "";
    tt.style.maxWidth = `${maxAllowedWidth}px`;
    tt.style.boxSizing = "border-box";
    activeTooltipType = "duration";
    updateActiveTooltipPosition();
  }

  function showUsageTooltip(usageBadge) {
    if (!usageBadge || !isPluginEnabled("turn-usage-total")) return;
    if (durationTooltip && durationTooltip.style.display !== "none") {
      hideDurationTooltip();
    }
    let turnUsage = null;
    let lastStepUsage = null;
    try {
      turnUsage = JSON.parse(usageBadge.getAttribute("data-turn-usage") || "null");
      lastStepUsage = JSON.parse(usageBadge.getAttribute("data-last-step-usage") || "null");
    } catch (err) {}
    if (!turnUsage) return;

    if (!turnUsage.model) {
      const currentSessionId = getCurrentSessionId();
      const currentSession = currentSessionId ? knownSessionsMap.get(currentSessionId) : null;
      if (currentSession && currentSession.model) {
        turnUsage.model = currentSession.model;
      }
    }

    const tt = getUsageTooltip();
    tt.__currentBadge = usageBadge;
    const costInfo = resolveTurnCostInfo(turnUsage, lastStepUsage);
    const totalCost = costInfo.totalCost;
    const lastCost = costInfo.lastCost;
    const sym = costInfo.currency;
    const costRatio = totalCost > 0 ? ((lastCost / totalCost) * 100).toFixed(1) : "0.0";
    const cacheHitRate = (turnUsage.input + turnUsage.cacheRead) > 0
      ? ((turnUsage.cacheRead / (turnUsage.input + turnUsage.cacheRead)) * 100).toFixed(1)
      : "0.0";

    const costBadgeHeader = totalCost > 0
      ? `<span style="color: #7dd3fc; font-variant-numeric: tabular-nums; font-weight: 600; white-space: nowrap; flex-shrink: 0; font-size: 13px;">${sym}${totalCost.toFixed(4)}</span>`
      : `<span style="color: var(--text-dim, #a1a1aa); font-size: 11px; font-weight: 500; white-space: nowrap; flex-shrink: 0;">免费 / 未计费</span>`;

    const costRowHtml = totalCost > 0
      ? `
        <div class="pi-enh-grid-col-left">
          总计费用 <span style="font-size: 10px; color: var(--accent, #60a5fa);">${costInfo.isEstimate ? `(${costInfo.modelCategory ? `${costInfo.modelCategory}参考价` : "参考价"})` : "(记录值)"}</span>
        </div>
        <div class="pi-enh-grid-col-right" style="color: #7dd3fc; font-weight: 600;">
          ${sym}${totalCost.toFixed(4)}
        </div>
        <div class="pi-enh-grid-col-right" style="color: var(--text-dim, #71717a);">
          ${sym}${lastCost.toFixed(4)} (${costRatio}%)
        </div>
        <div class="pi-enh-grid-divider"></div>`
      : "";

    const subagent = turnUsage.subagent;
    const hasSubagent = subagent && subagent.callCount > 0 && subagent.totalTokens > 0;
    const allTurnTokens = (turnUsage.totalTokens || 0) + (hasSubagent ? subagent.totalTokens : 0);
    const subagentTokenPct = hasSubagent && allTurnTokens > 0
      ? ((subagent.totalTokens / allTurnTokens) * 100).toFixed(1)
      : "0.0";

    const savings = hasSubagent
      ? (subagent.savings || computeSubagentSavings(subagent.items || [subagent], turnUsage.model || costInfo.modelName, (typeof totalCost === "number" && totalCost > 0) ? totalCost : (turnUsage.cost || 0)))
      : null;
    const subagentSavingsBoxHtml = (hasSubagent && savings)
      ? renderSubagentSavingsHtml(savings)
      : "";

    const subagentRowHtml = hasSubagent
      ? `
        <div class="pi-enh-grid-divider" style="background: rgba(56, 189, 248, 0.22); margin: 6px 0;"></div>
        <div class="pi-enh-grid-col-left" style="color: #38bdf8; font-weight: 600; display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 4px; white-space: normal; line-height: 1.35;" title="${(subagent.agents || []).join(', ')}">
          <span style="white-space: nowrap;">子 Agent 消耗</span>
          <span style="font-size: 9.5px; color: var(--text-dim, #a1a1aa); font-weight: 400; white-space: nowrap;">(${subagent.callCount}次)</span>
        </div>
        <div class="pi-enh-grid-col-right" style="color: #38bdf8; font-weight: 600;">
          ${savings?.canEstimate === false ? "—" : `${sym}${(savings?.actualCost ?? subagent.actualCost).toFixed(4)}`}
        </div>
        <div class="pi-enh-grid-col-right" style="color: #38bdf8; font-weight: 500;">
          ${subagent.totalTokens.toLocaleString()} <span style="font-size: 10px; color: #7dd3fc;">(${subagentTokenPct}%)</span>
        </div>`
      : "";

    const deepseekRowHtml = costInfo.deepseekTotalCost > 0
      ? `
        <div class="pi-enh-grid-divider"></div>
        <div class="pi-enh-grid-col-left" style="color: #fbbf24; font-weight: 500; display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 4px; white-space: normal; line-height: 1.35;">
          <span style="white-space: nowrap;">折算 DeepSeek-V4.1 Flash</span>
          <span style="font-size: 10px; color: var(--text-dim, #71717a); font-weight: 400; white-space: nowrap;">(低峰${costInfo.hasSubagent ? "·合并" : ""})</span>
        </div>
        <div class="pi-enh-grid-col-right" style="color: #fbbf24; font-weight: 600;">
          ${sym}${costInfo.deepseekTotalCost.toFixed(4)} <span style="font-size: 11px; color: #fde68a; font-weight: 600; margin-left: 2px;" title="${costInfo.hasSubagent ? `主模型与子 Agent 合并总支出 (${sym}${costInfo.effectiveTotalCost.toFixed(4)}) 是 DeepSeek 最便宜低峰档的 ` : "当前模型原价是 DeepSeek 最便宜低峰档的 "}${costInfo.multiplier} 倍">(${costInfo.multiplier}x)</span>
        </div>
        <div class="pi-enh-grid-col-right" style="color: var(--text-dim, #71717a);">
          ${sym}${costInfo.deepseekLastCost.toFixed(4)}
        </div>`
      : "";

    const noteHtml = `
      <div style="font-size: 10px; color: var(--text-dim, #71717a); border-top: 1px solid rgba(255,255,255,0.08); margin-top: 8px; padding-top: 5px; line-height: 1.45;">
        <div>💡 费用按 ${costInfo.modelDisplayName} ${costInfo.isEstimate ? "参考价" : "记录值"}折算${costInfo.hasSubagent ? " · DeepSeek 折算已合并主模型与子 Agent 全部 Token" : ""}</div>
        <div style="margin-top: 2px; color: var(--text-dim, #888892); white-space: normal;">DeepSeek-V4.1 Flash 官网最新低谷单价：输入 $0.15/M · 输出 $0.60/M · 缓存命中 $0.003/M</div>
      </div>
    `;

    tt.innerHTML = `
      <div class="pi-enh-tt-title" style="margin-bottom: 9px; display: flex; align-items: center; justify-content: space-between; gap: 8px;">
        <div style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight: 600; font-size: 13px; display: flex; align-items: center; gap: 6px; min-width: 0;">
          <span style="flex-shrink: 0; display: inline-flex; align-items: center; gap: 5px;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex-shrink: 0; opacity: 0.85;">
              <line x1="18" y1="20" x2="18" y2="10"></line><line x1="12" y1="20" x2="12" y2="4"></line><line x1="6" y1="20" x2="6" y2="14"></line>
            </svg>
            <span>回合消耗明细</span>
          </span>
          <span style="font-size: 11px; font-weight: 500; color: #93c5fd; background: rgba(59, 130, 246, 0.15); padding: 1px 6px; border-radius: 4px; border: 1px solid rgba(59, 130, 246, 0.3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${costInfo.modelDisplayName}">${costInfo.modelDisplayName}</span>
          <span style="font-size: 11px; color: var(--text-dim, #71717a); font-weight: 400; flex-shrink: 0;">(${turnUsage.stepCount}轮)</span>
        </div>
        ${costBadgeHeader}
      </div>

      ${subagentSavingsBoxHtml}

      <div class="pi-enh-usage-detail-scroll">
        <div class="pi-enh-usage-grid">
          <div class="pi-enh-grid-header pi-enh-grid-col-left">统计维度</div>
          <div class="pi-enh-grid-header pi-enh-grid-col-right">回合总计 (真实)</div>
          <div class="pi-enh-grid-header pi-enh-grid-col-right">最终单步 (原生)</div>

          ${costRowHtml}

          <div class="pi-enh-grid-col-left">输入 Tokens</div>
          <div class="pi-enh-grid-col-right" style="font-weight: 500; color: #f4f4f5;">
            ${(turnUsage.input || 0).toLocaleString()}
          </div>
          <div class="pi-enh-grid-col-right" style="color: var(--text-dim, #71717a);">
            ${(lastStepUsage?.input || 0).toLocaleString()}
          </div>

          <div class="pi-enh-grid-col-left">输出 Tokens</div>
          <div class="pi-enh-grid-col-right" style="font-weight: 500; color: #f4f4f5;">
            ${(turnUsage.output || 0).toLocaleString()}
          </div>
          <div class="pi-enh-grid-col-right" style="color: var(--text-dim, #71717a);">
            ${(lastStepUsage?.output || 0).toLocaleString()}
          </div>

          <div class="pi-enh-grid-col-left">缓存读取 (Cache R)</div>
          <div class="pi-enh-grid-col-right" style="font-weight: 500; color: #f4f4f5;">
            ${(turnUsage.cacheRead || 0).toLocaleString()}
          </div>
          <div class="pi-enh-grid-col-right" style="color: var(--text-dim, #71717a);">
            ${(lastStepUsage?.cacheRead || 0).toLocaleString()}
          </div>

          ${turnUsage.cacheWrite > 0 ? `
          <div class="pi-enh-grid-col-left">缓存写入 (Cache W)</div>
          <div class="pi-enh-grid-col-right" style="font-weight: 500; color: #f4f4f5;">
            ${(turnUsage.cacheWrite || 0).toLocaleString()}
          </div>
          <div class="pi-enh-grid-col-right" style="color: var(--text-dim, #71717a);">
            ${(lastStepUsage?.cacheWrite || 0).toLocaleString()}
          </div>` : ""}

          <div class="pi-enh-grid-divider"></div>

          <div class="pi-enh-grid-col-left" style="color: #60a5fa;">缓存命中率</div>
          <div class="pi-enh-grid-col-right" style="color: #60a5fa; font-weight: 600;">
            ${cacheHitRate}%
          </div>
          <div class="pi-enh-grid-col-right" style="color: var(--text-dim, #71717a);">-</div>

          ${subagentRowHtml}

          ${deepseekRowHtml}
        </div>

        ${noteHtml}
      </div>
    `;

    tt.style.display = "flex";
    tt.style.visibility = "visible";
    tt.style.boxSizing = "border-box";
    const ttWidth = Math.min(window.innerWidth - 24, 480);
    tt.style.width = `${ttWidth}px`;
    tt.style.maxWidth = `${ttWidth}px`;
    activeTooltipType = "usage";
    updateActiveTooltipPosition();
  }

  // 电脑端与手机端统一采用主动点击展开/收起机制（彻底禁用 hover 悬停，彻底消除误触）：
  // 1. 点击耗时或消耗徽章：若已打开则收起；若未打开则展开并保持，同时互斥关闭另一浮层。
  // 2. 点击浮层内部：保持显示，方便用户细看、滚动或选中文本。
  // 3. 点击外部区域：平滑收起所有浮层。
  addManagedListener(document, "click", (e) => {
    const el = e.target && typeof e.target.closest === "function"
      ? e.target
      : (e.target && e.target.parentElement && typeof e.target.parentElement.closest === "function" ? e.target.parentElement : null);
    const badge = el ? el.closest('div[title*="任务执行总耗时"], div[title*="任务执行耗时"], .pi-enh-duration-badge') : null;
    const usageBadge = el ? el.closest(".pi-enh-usage-badge") : null;
    const insideTooltip = el ? el.closest(".pi-enh-tooltip") : null;

    if (badge) {
      const isCurrent = activeTooltipType === "duration" && durationTooltip && durationTooltip.style.display !== "none" && durationTooltip.__currentBadge === badge;
      if (isCurrent) {
        hideDurationTooltip();
      } else {
        hideUsageTooltip();
        showDurationTooltip(badge);
      }
      return;
    }

    if (usageBadge) {
      const isCurrent = activeTooltipType === "usage" && usageTooltip && usageTooltip.style.display !== "none" && usageTooltip.__currentBadge === usageBadge;
      if (isCurrent) {
        hideUsageTooltip();
      } else {
        hideDurationTooltip();
        showUsageTooltip(usageBadge);
      }
      return;
    }

    // 点击弹窗内部：保持打开，不执行关闭
    if (insideTooltip) {
      return;
    }

    // 点击外部其他区域：关闭所有打开的浮层
    if (activeTooltipType || (durationTooltip && durationTooltip.style.display !== "none") || (usageTooltip && usageTooltip.style.display !== "none")) {
      hideAllTooltips();
    }
  });

  // ==========================================
  // 4. Live Running Stopwatch & Browser Title Timer (实时运行与标签页计时)
  // ==========================================
  activeTurnStartTime = null;
  activeTurnEntryId = null;
  baseTitle = cleanSessionTitleBase(document.title) || "会话";
  restoreTitleTimer = null;
  wasRunning = false;
  notRunningConsecutiveTicks = 0;

  function handleSessionSwitchLiveCleanup() {
    activeTurnStartTime = null;
    activeTurnEntryId = null;
    wasRunning = false;
    notRunningConsecutiveTicks = 0;
    document.querySelectorAll(".pi-enh-live-timer").forEach((el) => el.remove());
  }

  function isLiveRunning(sessionId) {
    const sid = sessionId || getCurrentSessionId();
    if (sid && typeof projectStatusModel !== "undefined" && projectStatusModel?.entry) {
      const statusEntry = projectStatusModel.entry(sid);
      if (statusEntry?.execution === "running") {
        window.__PI_ENH_LAST_RUNNING_REASON__ = "projectStatusModel running";
        return true;
      }
      if (["ended", "completed", "idle", "stopped"].includes(statusEntry?.execution) ||
          ["completed", "idle", "stopped", "interrupted"].includes(statusEntry?.status)) {
        const hasActiveStop = Boolean(findActiveStopButton());
        const textarea = findComposerTextarea();
        const ph = String(textarea?.getAttribute("placeholder") || textarea?.placeholder || "");
        const hasRunningPlaceholder = ph.includes("引导") || ph.includes("排队") || ph.includes("运行中") || ph.includes("Steer") || ph.includes("running");
        const hasChatSpin = Array.from(document.querySelectorAll(".animate-spin")).some((el) => Boolean(el.closest?.(".chat-content")));
        if (!hasActiveStop && !hasRunningPlaceholder && !hasChatSpin) {
          window.__PI_ENH_LAST_RUNNING_REASON__ = "projectStatusModel idle/completed";
          return false;
        }
      }
    }

    const stopBtn = findActiveStopButton();
    if (stopBtn) {
      window.__PI_ENH_LAST_RUNNING_REASON__ = "active stop button: " + (stopBtn.outerHTML || stopBtn.textContent);
      return true;
    }

    const textarea = findComposerTextarea();
    if (textarea) {
      const ph = String(textarea.getAttribute("placeholder") || textarea.placeholder || "");
      if (ph.includes("引导") || ph.includes("排队") || ph.includes("运行中") || ph.includes("Steer") || ph.includes("running")) {
        window.__PI_ENH_LAST_RUNNING_REASON__ = "textarea placeholder: " + ph;
        return true;
      }
    }

    const hasActiveChatSpin = Array.from(document.querySelectorAll(".animate-spin")).some((el) => Boolean(el.closest?.(".chat-content")));
    if (hasActiveChatSpin) {
      window.__PI_ENH_LAST_RUNNING_REASON__ = "animate-spin in chat";
      return true;
    }

    window.__PI_ENH_LAST_RUNNING_REASON__ = "default false";
    return false;
  }
  window.__PI_ENH_IS_LIVE_RUNNING__ = isLiveRunning;

  function tickLiveDuration() {
    if (!isPluginEnabled("live-stopwatch")) {
      for (const timer of document.querySelectorAll(".pi-enh-live-timer")) {
        timer.remove();
      }
      return;
    }
    const currentSessionId = getCurrentSessionId();
    const isRunning = isLiveRunning(currentSessionId);
    
    if (isRunning) {
      notRunningConsecutiveTicks = 0;
      let turnStartTime = getActiveTurnStartTime(currentSessionId);
      if (!turnStartTime) {
        turnStartTime = activeTurnStartTime || Date.now();
        recordActiveTurnStart(currentSessionId, turnStartTime, null, false);
        scheduleCurrentSessionMetrics(100);
      }
      activeTurnStartTime = turnStartTime;
      if (!wasRunning) {
        wasRunning = true;
        activeTurnEntryId = null;
        baseTitle = cleanSessionTitleBase(document.title) || "会话";
        if (restoreTitleTimer) {
          clearManagedTimeout(restoreTitleTimer);
          restoreTitleTimer = null;
        }
        // 运行开始时同步一次标题，标签页绝不带跳动的秒表，保持彻底静止无抖动
        applyProjectStatusTitle("running", baseTitle);
      }
      const elapsed = Math.max(0, (Date.now() - turnStartTime) / 1000);
      const timeStr = formatSec(elapsed);

      // 找出当前活跃轮次（严格位于最新 user 消息之后）的所有 assistant 消息
      const userMsgs = findUserMessages();
      const lastUserMsg = userMsgs.length > 0 ? userMsgs[userMsgs.length - 1] : null;
      const assistantMsgs = document.querySelectorAll ? document.querySelectorAll('div[data-message-role="assistant"]') : [];
      const activeAssistantMsgs = [];
      for (let i = 0; i < assistantMsgs.length; i++) {
        const m = assistantMsgs[i];
        if (!lastUserMsg) {
          // 若暂无已识别的 user 消息，仅将最后一条未完成的助手消息视作候选活跃卡片，绝不把历史已完成消息全部囊括
          if (i === assistantMsgs.length - 1 && !m.hasAttribute("data-pi-enh-completed")) {
            activeAssistantMsgs.push(m);
          }
        } else if (typeof lastUserMsg.compareDocumentPosition === "function") {
          const isPreceding = Boolean(lastUserMsg.compareDocumentPosition(m) & 2);
          if (!isPreceding && m !== lastUserMsg) {
            activeAssistantMsgs.push(m);
          }
        } else {
          activeAssistantMsgs.push(m);
        }
      }

      // 寻找当前活跃回合中挂载秒表的最佳卡片及 footer
      let currentMsg = null;
      let footer = null;

      // 1. 优先寻找未标记 completed 且具有合法 footer 的最新 assistant 消息
      for (let i = activeAssistantMsgs.length - 1; i >= 0; i--) {
        const m = activeAssistantMsgs[i];
        if (!m.hasAttribute("data-pi-enh-completed")) {
          const f = m.querySelector('div[style*="margin-top: 4px"], div[style*="marginTop: 4px"]') ||
                    m.querySelector('div[style*="gap: 8px"]');
          if (f) {
            currentMsg = m;
            footer = f;
            break;
          }
        }
      }

      // 2. 多步工具与等待模型鲁棒保障：如果最新消息尚在流式等待（无 footer），
      // 只要当前回合处于运行中（isRunning），从后往前在当前活跃未完成的助手卡片中选取拥有合法 footer 的卡片挂载秒表！
      if (!footer && activeAssistantMsgs.length > 0) {
        for (let i = activeAssistantMsgs.length - 1; i >= 0; i--) {
          const m = activeAssistantMsgs[i];
          const entryId = getMessageEntryId(m);
          // 铁律：已完成的历史消息或已有正式耗时徽章的卡片，坚决保留，绝对严禁被秒表剥夺或互删！
          if (m.hasAttribute("data-pi-enh-completed") || m.querySelector(".pi-enh-duration-badge") || (entryId && knownTurnMetrics.has(entryId))) {
            continue;
          }
          const f = m.querySelector('div[style*="margin-top: 4px"], div[style*="marginTop: 4px"]') ||
                    m.querySelector('div[style*="gap: 8px"]');
          if (f) {
            currentMsg = m;
            footer = f;
            break;
          }
        }
      }

      // 3. 终极保底：当前回合刚开始，尚未产生带标准 footer 的助手消息
      if (!footer && activeAssistantMsgs.length > 0) {
        currentMsg = activeAssistantMsgs[activeAssistantMsgs.length - 1];
        footer = currentMsg.querySelector('div[style*="margin-top: 4px"], div[style*="marginTop: 4px"]') ||
                 currentMsg.querySelector('div[style*="gap: 8px"]') ||
                 currentMsg.lastElementChild;
      }

      syncAllModelSpeedBadges();

      // ONLY attach liveBadge to the active uncompleted message
      // NEVER attach to any previously completed assistant message!
      if (currentMsg && footer) {
        activeTurnEntryId = getMessageEntryId(currentMsg) || null;
        let liveBadge = footer.querySelector(".pi-enh-live-timer");
        const copyBtn = findCopyButton(footer);
        const usageEl = typeof findUsageElement === "function" ? findUsageElement(footer) : null;
        const timeSpan = findTimestampElement(footer);

        function anchorLiveTimer(targetBadge) {
          targetBadge.style.marginLeft = "auto";
          targetBadge.style.marginRight = "4px";
          if (timeSpan) {
            if (timeSpan.style && timeSpan.style.marginLeft === "auto") {
              timeSpan.style.marginLeft = "0";
            }
            if (targetBadge.nextElementSibling !== timeSpan) {
              footer.insertBefore(targetBadge, timeSpan);
            }
          } else if (copyBtn) {
            if (targetBadge.previousElementSibling !== copyBtn) {
              copyBtn.after(targetBadge);
            }
          } else if (usageEl) {
            if (targetBadge.previousElementSibling !== usageEl) {
              usageEl.after(targetBadge);
            }
          } else if (targetBadge.parentElement !== footer) {
            footer.appendChild(targetBadge);
          }
        }

        if (!liveBadge) {
          liveBadge = document.createElement("span");
          liveBadge.className = "pi-enh-live-timer";
          liveBadge.style.fontSize = "11px";
          liveBadge.style.color = "#38bdf8";
          liveBadge.style.display = "inline-flex";
          liveBadge.style.alignItems = "center";
          liveBadge.style.gap = "3px";
          liveBadge.style.whiteSpace = "nowrap";
          liveBadge.style.flexShrink = "0";
          liveBadge.style.fontWeight = "500";
          anchorLiveTimer(liveBadge);
        } else {
          anchorLiveTimer(liveBadge);
        }
        liveBadge.textContent = `⏱️ 运行中 ${timeStr}`;

        // 清理多余的残留 liveBadge
        const allLiveTimers = document.querySelectorAll(".pi-enh-live-timer");
        for (const timer of allLiveTimers) {
          if (timer !== liveBadge) timer.remove();
        }
      }
    } else {
      // Transition from running -> completed
      if (wasRunning) {
        if (hasActiveAskUserOnScreen() || isCurrentSessionInAttention(currentSessionId)) {
          applyProjectStatusTitle("attention", baseTitle);
          return;
        }

        notRunningConsecutiveTicks++;
        if (notRunningConsecutiveTicks < 2) {
          return;
        }

        const turnStartTime = getActiveTurnStartTime(currentSessionId) || activeTurnStartTime;
        if (turnStartTime) {
          const totalElapsed = Math.max(0, (Date.now() - turnStartTime) / 1000);
          const finalSec = Math.max(1, Math.round(totalElapsed));
          const finalTimeStr = formatSec(totalElapsed);

          applyProjectStatusTitle("completed", baseTitle);
          if (restoreTitleTimer) clearManagedTimeout(restoreTitleTimer);
          restoreTitleTimer = addManagedTimeout(() => {
            restoreTitleTimer = null;
            applyProjectStatusTitle(null, baseTitle);
          }, 4000);

          // Find the assistant message that just finished (latest assistant message in active turn)
          const assistantMsgs = document.querySelectorAll('div[data-message-role="assistant"]');
          const userMsgs = document.querySelectorAll ? document.querySelectorAll('div[data-message-role="user"]') : [];
          const lastUserMsg = userMsgs.length > 0 ? userMsgs[userMsgs.length - 1] : null;

          let lastActiveAssistantMsg = null;
          if (assistantMsgs.length > 0) {
            for (let i = assistantMsgs.length - 1; i >= 0; i--) {
              const cand = assistantMsgs[i];
              if (!lastUserMsg) {
                lastActiveAssistantMsg = cand;
                break;
              } else if (typeof lastUserMsg.compareDocumentPosition === "function") {
                const isPreceding = Boolean(lastUserMsg.compareDocumentPosition(cand) & 2);
                if (!isPreceding && cand !== lastUserMsg) {
                  lastActiveAssistantMsg = cand;
                  break;
                }
              } else {
                lastActiveAssistantMsg = cand;
                break;
              }
            }
          }

          let targetMsg = lastActiveAssistantMsg;
          if (!targetMsg && activeTurnEntryId) {
            targetMsg = document.querySelector(`div[data-message-role="assistant"][data-entry-id="${activeTurnEntryId}"]`);
          }
          if (!targetMsg) {
            for (let i = assistantMsgs.length - 1; i >= 0; i--) {
              if (!assistantMsgs[i].hasAttribute("data-pi-enh-completed")) {
                targetMsg = assistantMsgs[i];
                break;
              }
            }
          }
          if (!targetMsg && assistantMsgs.length > 0) {
            targetMsg = assistantMsgs[assistantMsgs.length - 1];
          }

          if (targetMsg && lastUserMsg) {
            let isPreceding = false;
            if (typeof lastUserMsg.compareDocumentPosition === "function") {
              isPreceding = Boolean(lastUserMsg.compareDocumentPosition(targetMsg) & 2);
            }
            if (isPreceding) {
              targetMsg = null;
            }
          }

          if (targetMsg) {
            const hasFooter = targetMsg.querySelector('div[style*="margin-top: 4px"], div[style*="marginTop: 4px"]') ||
                              targetMsg.querySelector('div[style*="gap: 8px"]');
            if (!hasFooter && assistantMsgs.length > 0) {
              for (let i = assistantMsgs.length - 1; i >= 0; i--) {
                const candidate = assistantMsgs[i];
                if (lastUserMsg && typeof lastUserMsg.compareDocumentPosition === "function") {
                  const isPreceding = Boolean(lastUserMsg.compareDocumentPosition(candidate) & 2);
                  if (isPreceding) continue;
                }
                const f = candidate.querySelector('div[style*="margin-top: 4px"], div[style*="marginTop: 4px"]') ||
                          candidate.querySelector('div[style*="gap: 8px"]');
                if (f) {
                  targetMsg = candidate;
                  break;
                }
              }
            }
          }

          if (targetMsg) {
            // Remove live badge from it
            const liveBadge = targetMsg.querySelector(".pi-enh-live-timer");
            if (liveBadge) liveBadge.remove();

            insertDurationBadge(targetMsg, finalSec, 0, {}, turnStartTime, Date.now());

            if (activeTurnEntryId) {
              setKnownTurnMetric(activeTurnEntryId, {
                totalSec: finalSec,
                queueSec: 0,
                toolCounts: {},
                uTime: turnStartTime,
                aTime: Date.now()
              });
            }
          }

          clearActiveTurn(currentSessionId);
          activeTurnStartTime = null;
          activeTurnEntryId = null;

          // Clean up any stray live timers anywhere in the document
          document.querySelectorAll(".pi-enh-live-timer").forEach((el) => el.remove());

          // Fetch exact metrics after the mobile navigation quiet period.
          scheduleCurrentSessionMetrics(600);
        }

        wasRunning = false;
        notRunningConsecutiveTicks = 0;
      } else {
        notRunningConsecutiveTicks = 0;
        // 防御性清理：非运行态且页面上存在残留的实时秒表时，立即清除，根除切会话后的幽灵读秒
        const strayTimers = document.querySelectorAll(".pi-enh-live-timer");
        if (strayTimers.length > 0) {
          strayTimers.forEach((el) => el.remove());
        }
      }
    }
  }
  const liveStopwatchIntervalId = addManagedInterval(tickLiveDuration, 400);

  // ==========================================
  // 5. Thinking Level Persistence & Auto-Restore (思考深度记忆与自动恢复)
  // ==========================================
  const THINKING_STORAGE_KEY = "pi-thinking-level";
  restoredThinkingSessionScopes = new Set();

  function findThinkingButton() {
    const buttons = document.querySelectorAll("button");
    for (const btn of buttons) {
      if (btn.querySelector('path[d*="M9.5 2A5.5"]')) {
        return btn;
      }
    }
    return null;
  }

  function getButtonThinkingLevel(btn) {
    if (!btn) return null;
    const span = btn.querySelector("span");
    return span ? span.textContent.trim().toLowerCase() : null;
  }

  function isModelReadyForThinking() {
    const selector = document.querySelector(".model-selector");
    if (!selector) return false;
    const btn = selector.querySelector("button");
    if (!btn) return false;
    if (btn.disabled || btn.getAttribute("aria-busy") === "true") return false;
    const text = (btn.textContent || "").trim();
    if (!text) return false;
    const notReadyTexts = ["select model", "no models", "no available models", "选择模型", "无可用模型", "switching model", "正在切换"];
    const lower = text.toLowerCase();
    if (notReadyTexts.some((marker) => lower.includes(marker))) return false;
    return true;
  }

  function getThinkingSessionScope() {
    const sessionId = (typeof getCurrentSessionId === "function" ? getCurrentSessionId() : null) || "";
    if (sessionId) return `session:${sessionId}`;
    try {
      const url = window.location.href;
      return `draft:${url}`;
    } catch {
      return "draft:default";
    }
  }

  // Record user selection when clicking inside the reasoning popup menu
  addManagedListener(document, "click", (e) => {
    const target = e.target;
    if (!target) return;
    const btn = target.closest("button");
    if (!btn) return;

    // Check if the clicked button is an option inside the reasoning menu
    const popup = btn.closest('div[style*="boxShadow"], div[style*="box-shadow"], div[style*="box_shadow"]');
    if (popup) {
      const text = btn.textContent.trim().toLowerCase();
      const levels = ["high", "medium", "low", "minimal", "off", "xhigh", "max", "auto"];
      for (const lvl of levels) {
        if (text === lvl || text.startsWith(lvl + " ") || text.includes(`(${lvl})`) || text.startsWith(lvl + "(")) {
          try {
            localStorage.setItem(THINKING_STORAGE_KEY, lvl);
          } catch {}
          const scope = getThinkingSessionScope();
          if (scope) restoredThinkingSessionScopes.add(scope);
          break;
        }
      }
    }
  }, true);

  // Auto-restore preferred thinking level if UI falls back to "auto"
  isRestoringThinking = false;

  function autoRestoreThinkingLevel() {
    if (!isPluginEnabled("thinking-persistence")) return;
    if (isRestoringThinking) return;

    // 1. 用户偏好硬守卫：只有用户曾经主动设定过偏好，且不是 auto 时才执行恢复
    let preferred = null;
    try {
      preferred = localStorage.getItem(THINKING_STORAGE_KEY);
    } catch {}
    if (!preferred || preferred === "auto") return;

    // 2. 模型就绪硬守卫：如果模型选择器尚未加载完成或模型不可用，绝对不碰思考按钮，绝对不弹窗
    if (!isModelReadyForThinking()) return;

    // 3. 单会话单次尝试守卫：每个会话或新建草稿只允许尝试一次，避免死循环“弹啊弹”
    const scope = getThinkingSessionScope();
    if (restoredThinkingSessionScopes.has(scope)) return;

    const btn = findThinkingButton();
    if (!btn || btn.disabled) return;

    const currentLevel = getButtonThinkingLevel(btn);
    if (currentLevel === preferred) {
      restoredThinkingSessionScopes.add(scope);
      return;
    }

    if (currentLevel === "auto") {
      isRestoringThinking = true;
      restoredThinkingSessionScopes.add(scope);
      if (restoredThinkingSessionScopes.size > 200) {
        const first = restoredThinkingSessionScopes.values().next().value;
        if (first) restoredThinkingSessionScopes.delete(first);
      }

      const host = btn.parentElement || btn;
      host.setAttribute("data-pi-enh-thinking-silent", "true");

      btn.click();
      addManagedTimeout(() => {
        try {
          const popups = document.querySelectorAll('div[style*="boxShadow"], div[style*="box-shadow"], div[style*="box_shadow"]');
          let matchedBtn = null;
          for (const popup of popups) {
            const options = popup.querySelectorAll("button");
            for (const opt of options) {
              const optText = opt.textContent.trim().toLowerCase();
              if (optText === preferred || optText.startsWith(preferred + " ") || optText.includes(`(${preferred})`)) {
                matchedBtn = opt;
                break;
              }
            }
            if (matchedBtn) break;
          }
          if (matchedBtn) {
            matchedBtn.click();
          } else {
            // 当前模型不支持该思考级别，安全关闭弹窗，不再重试
            btn.click();
          }
        } finally {
          host.removeAttribute("data-pi-enh-thinking-silent");
          addManagedTimeout(() => {
            isRestoringThinking = false;
          }, 200);
        }
      }, 50);
    }
  }
  const thinkingIntervalId = addManagedInterval(autoRestoreThinkingLevel, 1000);

