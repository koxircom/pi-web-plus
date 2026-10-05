"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { AskUserQuestion, ExtensionUiRequest } from "@/lib/types";
import { buildAskAnswerInputs, readAskTerminal } from "@/lib/ask-user";
import { isEnhancementPluginFastActive } from "@/lib/enhancement-settings.generated";
import { allowsAutomaticEditableFocus } from "@/hooks/useIsMobile";

type Request = Extract<ExtensionUiRequest, { method: "custom" }>;
type Input = (request: Request, data: string | string[]) => Promise<boolean | undefined>;

function subscribePreference(listener: () => void) {
  window.addEventListener("storage", listener);
  window.addEventListener("pi-native-composer-preferences-change", listener);
  return () => {
    window.removeEventListener("storage", listener);
    window.removeEventListener("pi-native-composer-preferences-change", listener);
  };
}

/** Keep the legacy switch, with React owning both renderer and cleanup. */
export function AskUserSurface({ request, onInput, fallback }: { request: Request; onInput: Input; fallback: React.ReactNode }) {
  const enabled = useSyncExternalStore(subscribePreference, () => isEnhancementPluginFastActive("ask-user-web-native"), () => true);
  const terminal = readAskTerminal(request.lines);
  const question: AskUserQuestion | undefined = request.askUser ?? (terminal.question && /\bask_user\b/.test(terminal.text) ? {
    toolCallId: request.id, question: terminal.question,
    options: terminal.options.map(option => ({ title: option.title })),
    allowMultiple: /\d+\.\s+\[/.test(terminal.text),
    allowFreeform: terminal.freeform, allowComment: terminal.comment,
  } : undefined);
  return enabled && question ? <AskUserPanel key={request.id} request={request} question={question} onInput={onInput} /> : fallback;
}

function AskQuestionHeader({ question, collapsed, onToggle }: { question: string; collapsed: boolean; onToggle: () => void }) {
  return <header className="pi-native-ask-header">
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 18.5 3 22l4-1.5A10 10 0 1 0 4 18.5Z" /><path d="M9.5 9a2.5 2.5 0 0 1 5 .5c0 1.5-2.5 1.5-2.5 3" /><path d="M12 16h.01" />
    </svg>
    <span className="pi-native-ask-heading">{collapsed ? question : "问题"}</span>
    <button type="button" className="pi-native-ask-close" aria-label={collapsed ? "展开问题" : "收起问题"} title={collapsed ? "展开问题" : "收起问题"} aria-expanded={!collapsed} onClick={onToggle}>
      {collapsed ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
        : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>}
    </button>
  </header>;
}

// The same question surface handles plain input/editor requests, without a terminal overlay.
type TextRequest = Extract<ExtensionUiRequest, { method: "input" | "editor" }>;
export function AskUserTextPanel({ request, onRespond }: { request: TextRequest; onRespond: (request: TextRequest, response: { value: string } | { cancelled: true }) => void }) {
  const [value, setValue] = useState(request.method === "editor" ? request.prefill ?? "" : "");
  const [collapsed, setCollapsed] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const sending = useRef(false);
  useEffect(() => {
    if (request.expiresAt === undefined) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [request.expiresAt]);
  // ask_user uses a plain input request for answers without choices.
  const contextMarker = request.title.indexOf("\n\nContext:\n");
  const title = contextMarker < 0 ? request.title : request.title.slice(0, contextMarker);
  const context = contextMarker < 0 ? "" : request.title.slice(contextMarker + "\n\nContext:\n".length);
  const canSend = request.method === "editor" || Boolean(value.trim());
  const respond = (skip = false) => {
    if (sending.current || (!skip && !canSend)) return;
    sending.current = true;
    onRespond(request, skip ? { cancelled: true } : { value });
  };
  return <div className="pi-native-extension-host pi-native-ask-host">
    <section className="pi-native-ask-card" role="dialog" aria-label={title} data-collapsed={collapsed || undefined} onKeyDown={event => {
      if (event.nativeEvent.isComposing || event.repeat) return;
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setCollapsed(true); }
      if (event.key === "Enter" && (request.method === "input" || event.ctrlKey || event.metaKey) && (event.target as HTMLElement).matches("input,textarea")) {
        event.preventDefault(); respond();
      }
    }}>
      <AskQuestionHeader question={title} collapsed={collapsed} onToggle={() => setCollapsed(current => !current)} />
      <div className="pi-native-ask-question-row" hidden={collapsed}><h2 className="pi-native-ask-question">{title}</h2></div>
      <div className="pi-native-ask-body" hidden={collapsed}>
        {context && <details className="pi-native-ask-context"><summary>查看背景与方案</summary><div>{context}</div></details>}
        <div className="pi-native-ask-notes">
          {request.method === "input" ? <input aria-label="回答" autoFocus={allowsAutomaticEditableFocus()} placeholder={request.placeholder || "输入你的回答…"} value={value} onChange={event => setValue(event.target.value)} />
            : <textarea aria-label="回答" autoFocus={allowsAutomaticEditableFocus()} placeholder="输入你的回答…" rows={3} value={value} onChange={event => setValue(event.target.value)} />}
        </div>
      </div>
      <footer className="pi-native-ask-footer" hidden={collapsed}>
        <span className="pi-native-ask-hint" role="status">{request.expiresAt === undefined ? "" : `${Math.max(0, Math.ceil((request.expiresAt - now) / 1000))} 秒后到期`}</span>
        <button type="button" className="pi-native-ask-cancel" onClick={() => respond(true)}>跳过</button>
        <button type="button" className="pi-native-ask-submit" disabled={!canSend} onClick={() => respond()}>发送</button>
      </footer>
    </section>
  </div>;
}

export function AskUserPanel({ request, question, onInput }: { request: Request; question: AskUserQuestion; onInput: Input }) {
  const [collapsed, setCollapsed] = useState(false);
  const [selected, setSelected] = useState<number[]>(() => {
    const checked = readAskTerminal(request.lines).options.flatMap((option, index) => option.checked ? [index] : []);
    return readAskTerminal(request.lines).mode === "freeform" ? [] : checked.length ? checked : question.options.length ? [0] : [];
  });
  const freeform = question.allowFreeform && selected.length === 0;
  const [notesOpen, setNotesOpen] = useState(question.options.length === 0);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const sending = useRef(false);
  const firstOption = useRef<HTMLButtonElement>(null);
  const terminalMode = readAskTerminal(request.lines).mode;

  useEffect(() => {
    if (allowsAutomaticEditableFocus()) firstOption.current?.focus({ preventScroll: true });
  }, []);

  async function send(data: string[]) {
    if (sending.current) return;
    sending.current = true; setBusy(true); setError("");
    try {
      if (!await onInput(request, data)) throw new Error("回答未确认送达，请检查连接后重试。");
      // Closure belongs to the server's request id, never a local timer.
      // If the terminal opens an editor instead, allow continuing it in place.
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "回答发送失败");
      sending.current = false; setBusy(false);
    }
  }

  // A remounted server-side editor is a continuation of this same question.
  // Do not replace the card with a terminal dialog or clear the draft.
  useEffect(() => {
    if (terminalMode !== "select") {
      sending.current = false; setBusy(false); setNotesOpen(true);
      if (terminalMode === "freeform") setSelected([]);
    }
  }, [terminalMode]);

  function submit() {
    if (sending.current) return;
    try { void send(buildAskAnswerInputs(question, request.lines, selected, notes, freeform)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "请选择答案"); }
  }

  function choose(index: number, toggle = true) {
    if (busy) return;
    setError("");
    setSelected(current => question.allowMultiple
      ? current.includes(index) ? current.filter(value => value !== index) : [...current, index].sort((a, b) => a - b)
      : toggle && question.allowFreeform && current.includes(index) ? [] : [index]);
  }

  return <div className="pi-native-ask-host" data-pi-native-ask-owner={request.id}>
    <section className="pi-native-ask-card" role="dialog" aria-label={question.question} aria-busy={busy} data-ask-user-picker data-collapsed={collapsed || undefined}
      onKeyDown={event => {
        if (event.nativeEvent.isComposing || event.repeat || busy) return;
        if ((event.target as HTMLElement).matches("textarea")) {
          if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); submit(); }
          if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setCollapsed(true); }
          return;
        }
        const option = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-ask-option]");
        if (event.key === "Escape") { event.preventDefault(); setCollapsed(true); return; }
        if (collapsed) return;
        if (/^[1-9]$/.test(event.key) && Number(event.key) <= question.options.length) {
          event.preventDefault(); choose(Number(event.key) - 1, false); return;
        }
        if (option && ["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) {
          event.preventDefault();
          const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("[data-ask-option]"));
          const index = buttons.indexOf(option);
          const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
          if (!question.allowMultiple) setSelected([next]);
          buttons[next]?.focus({ preventScroll: true }); buttons[next]?.scrollIntoView({ block: "nearest" });
        }
        if (option && event.key === "Enter") { event.preventDefault(); submit(); }
      }}>
      <AskQuestionHeader question={question.question} collapsed={collapsed} onToggle={() => setCollapsed(value => !value)} />
      <div className="pi-native-ask-question-row" hidden={collapsed}><h2 className="pi-native-ask-question">{question.question}</h2></div>
      <div className="pi-native-ask-body" hidden={collapsed}>
        {question.context && <details className="pi-native-ask-context"><summary>查看背景与方案</summary><div>{question.context}</div></details>}
        <div className="pi-native-ask-options" role="group" aria-label={question.allowMultiple ? "多选答案" : "单选答案"}>
          {question.options.map((option, index) => <button key={index} ref={index === 0 ? firstOption : undefined} type="button" className="pi-native-ask-option" data-ask-option={index} aria-pressed={!freeform && selected.includes(index)} disabled={busy} onClick={() => choose(index)}>
            <span className="pi-native-ask-index">{index + 1}</span>
            <span className="pi-native-ask-copy"><span className="pi-native-ask-label">{option.title}</span>{option.description && <span className="pi-native-ask-description">{option.description}</span>}</span>
            <span className="pi-native-ask-check" aria-hidden="true">{!freeform && selected.includes(index) ? "✓" : ""}</span>
          </button>)}
        </div>
        {(question.allowFreeform || question.allowComment) && <>
          {question.options.length > 0 && <div className="pi-native-ask-answer-tools">
            <button type="button" className="pi-native-ask-link" aria-expanded={notesOpen || freeform} disabled={busy || freeform} onClick={() => setNotesOpen(value => !value)}>{freeform ? "回答" : notesOpen ? "收起补充回答" : "＋ 补充回答"}</button>
            {question.allowFreeform && !freeform && <button type="button" className="pi-native-ask-link" disabled={busy} onClick={() => { setSelected([]); setNotesOpen(true); setError(""); }}>直接回答</button>}
          </div>}
          <div className="pi-native-ask-notes" hidden={!(notesOpen || freeform)}>
            <textarea aria-label="回答" placeholder={freeform ? "输入你的回答…" : "补充你的要求（可选）…"} rows={2} value={notes} disabled={busy} onChange={event => setNotes(event.target.value)} />
          </div>
        </>}
      </div>
      <footer className="pi-native-ask-footer" hidden={collapsed}>
        <span className="pi-native-ask-hint" role="status">{error || (busy ? "正在提交，等待确认…" : "")}</span>
        <button type="button" className="pi-native-ask-cancel" disabled={busy} onClick={() => void send(["\x03"])}>跳过</button>
        <button type="button" className="pi-native-ask-submit" disabled={busy || (freeform ? !notes.trim() : !selected.length)} onClick={submit}>{busy ? "发送中…" : "发送"}</button>
      </footer>
    </section>
  </div>;
}
