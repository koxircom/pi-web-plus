import React, { useState, useRef, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { ChatInput } from "../../components/ChatInput.tsx";
import { ChatWindow } from "../../components/ChatWindow.tsx";
import { I18nProvider, useI18n } from "../../hooks/useI18n.tsx";
import { COMPOSER_PREFERENCES_CHANGE_EVENT } from "../../hooks/useComposerLayoutPreferences.ts";

const STATIC_MOCK_SESSION = {
  id: "test-session-1",
  cwd: "/workspace/test",
  title: "Test Session",
  createdAt: "2026-10-01T00:00:00.000Z",
  lastModified: "2026-10-01T00:00:00.000Z",
  parentSession: null,
};

const STATIC_LOADING_SESSION = {
  id: "loading-session-id",
  cwd: "/workspace/test",
  title: "Loading Session",
  createdAt: "2026-10-01T00:00:00.000Z",
  lastModified: "2026-10-01T00:00:00.000Z",
  parentSession: null,
};

function InnerTestApp() {
  const [viewMode, setViewMode] = useState("input"); // "input" | "window-normal" | "window-loading" | "window-new"
  const [isStreaming, setIsStreaming] = useState(false);
  const [paneWidth, setPaneWidth] = useState(null);
  const [theme, setTheme] = useState("dark");
  const [disabled, setDisabled] = useState(false);
  const [modelError, setModelError] = useState(null);
  const [draftKey, setDraftKey] = useState("test-session-1");
  const [remountKey, setRemountKey] = useState(0);
  const [sentMessages, setSentMessages] = useState([]);
  const [model, setModel] = useState({ provider: "openai", modelId: "gpt-6.1-sol" });
  const [thinkingLevel, setThinkingLevel] = useState("high");
  const [toolPreset, setToolPreset] = useState("default");
  const [soundEnabled, setSoundEnabled] = useState(true);

  const chatInputRef = useRef(null);
  const { setLocale } = useI18n();

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  // 暴露完整的端到端控制接口给浏览器自动化驱动
  window.__COMPOSER_TEST_API__ = {
    setViewMode,
    setIsStreaming,
    setPaneWidth,
    setTheme,
    setLocale,
    setDisabled,
    setModelError,
    setDraftKey,
    setRemountKey: () => setRemountKey((k) => k + 1),
    getSentMessages: () => sentMessages,
    clearSent: () => setSentMessages([]),
    getChatInputRef: () => chatInputRef.current,
    dispatchPreferencesChange: () => {
      window.dispatchEvent(new CustomEvent(COMPOSER_PREFERENCES_CHANGE_EVENT));
    },
  };

  const handleSend = (text, images) => {
    setSentMessages((prev) => [...prev, { type: "send", text, images }]);
  };

  const handleAbort = () => {
    setSentMessages((prev) => [...prev, { type: "abort" }]);
    setIsStreaming(false);
  };

  const handleSteer = (text, images) => {
    setSentMessages((prev) => [...prev, { type: "steer", text, images }]);
  };

  const handleFollowUp = (text, images) => {
    setSentMessages((prev) => [...prev, { type: "followup", text, images }]);
  };

  return (
    <div style={{ width: "100%", height: "100%", position: "relative" }}>
      {viewMode === "input" && (
        <div style={{ width: paneWidth ?? undefined, maxWidth: 820, margin: "80px auto 0", padding: "0 16px", boxSizing: "border-box" }}>
          <fieldset disabled={disabled} style={{ border: "none", padding: 0, margin: 0 }}>
            <ChatInput
              key={`chat-input-${draftKey}-${remountKey}`}
              ref={chatInputRef}
              isStreaming={isStreaming}
              onSend={handleSend}
              onAbort={handleAbort}
              onSteer={handleSteer}
              onFollowUp={handleFollowUp}
              model={model}
              modelError={modelError}
              modelList={[
                { id: "gpt-6.1-sol", name: "GPT-6.1 Sol", provider: "openai", input: ["text", "image"] },
                { id: "claude-3-5-sonnet", name: "Claude 3.5 Sonnet", provider: "anthropic", input: ["text", "image"] },
              ]}
              onModelChange={(provider, modelId) => setModel({ provider, modelId })}
              toolPreset={toolPreset}
              onToolPresetChange={setToolPreset}
              onCompact={() => setSentMessages(prev => [...prev, { type: "compact" }])}
              soundEnabled={soundEnabled}
              onSoundToggle={() => setSoundEnabled(value => !value)}
              thinkingLevel={thinkingLevel}
              onThinkingLevelChange={(lvl) => setThinkingLevel(lvl)}
              availableThinkingLevels={["low", "medium", "high"]}
              thinkingLevelMap={{ low: "低", medium: "中", high: "高" }}
              draftKey={draftKey}
            />
          </fieldset>
        </div>
      )}

      {viewMode === "window-normal" && (
        <div style={{ width: "100%", height: "100%" }}>
          <ChatWindow
            key={`window-normal-${remountKey}`}
            session={STATIC_MOCK_SESSION}
            newSessionCwd="/workspace/test"
            newSessionDraftKey="test-session-1"
          />
        </div>
      )}

      {viewMode === "window-loading" && (
        <div style={{ width: "100%", height: "100%" }}>
          <ChatWindow
            key={`window-loading-${remountKey}`}
            session={STATIC_LOADING_SESSION}
            newSessionCwd="/workspace/test"
            newSessionDraftKey="test-session-1"
          />
        </div>
      )}

      {viewMode === "window-new" && (
        <div style={{ width: "100%", height: "100%" }}>
          <ChatWindow
            key={`window-new-${remountKey}`}
            session={null}
            newSessionCwd="/workspace/test"
            newSessionDraftKey="test-session-1"
          />
        </div>
      )}
    </div>
  );
}

function TestApp() {
  return (
    <I18nProvider>
      <InnerTestApp />
    </I18nProvider>
  );
}

const rootEl = document.getElementById("root");
if (rootEl) {
  createRoot(rootEl).render(<TestApp />);
}
