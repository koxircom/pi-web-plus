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

export function AskUserPanel({ request, question, onInput }: { request: Request; question: AskUserQuestion; onInput: Input }) {
  const [collapsed, setCollapsed] = useState(false);
  const [selected, setSelected] = useState<number[]>(() => {
    const checked = readAskTerminal(request.lines).options.flatMap((option, index) => option.checked ? [index] : []);
    return checked.length ? checked : question.options.length ? [0] : [];
  });
  const [freeform, setFreeform] = useState(question.options.length === 0);
  const [notesOpen, setNotesOpen] = useState(question.options.length === 0);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const sending = useRef(false);
  const firstOption = useRef<HTMLButtonElement>(null);
  const draftKey = freeform ? "freeform" : selected.join(",");
  const notes = drafts[draftKey] ?? "";
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
    }
  }, [terminalMode]);

  function submit() {
    if (sending.current) return;
    try { void send(buildAskAnswerInputs(question, request.lines, selected, notes, freeform)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "请选择答案"); }
  }

  function choose(index: number) {
    if (busy) return;
    setFreeform(false); setError("");
    setSelected(current => question.allowMultiple
      ? current.includes(index) ? current.filter(value => value !== index) : [...current, index].sort((a, b) => a - b)
      : [index]);
  }

  return <div className="pi-native-ask-host" data-pi-native-ask-owner={request.id}>
    <section className="pi-native-ask-card" role="dialog" aria-label="等待你的答复" aria-busy={busy} data-ask-user-picker data-collapsed={collapsed || undefined}
      onKeyDown={event => {
        if (event.nativeEvent.isComposing || event.repeat || busy) return;
        if ((event.target as HTMLElement).matches("textarea")) {
          if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); submit(); }
          if (event.key === "Escape") { event.preventDefault(); setNotesOpen(false); }
          return;
        }
        const option = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-ask-option]");
        if (event.key === "Escape") { event.preventDefault(); setCollapsed(true); return; }
        if (collapsed) return;
        if (/^[1-9]$/.test(event.key) && Number(event.key) <= question.options.length) {
          event.preventDefault(); choose(Number(event.key) - 1); return;
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
      <header className="pi-native-ask-header">
        <span className="pi-native-ask-dot" aria-hidden="true" />
        <span className="pi-native-ask-heading">等待你的答复</span>
        <span className="pi-native-ask-kind">{question.allowMultiple ? "可多选" : "选择一个答案"}</span>
        <button type="button" className="pi-native-ask-link" aria-expanded={!collapsed} onClick={() => setCollapsed(value => !value)}>{collapsed ? "展开回答" : "收起"}</button>
      </header>
      <div className="pi-native-ask-body" hidden={collapsed}>
        <h2 className="pi-native-ask-question">{question.question}</h2>
        {question.context && <details className="pi-native-ask-context"><summary>查看背景与方案</summary><div>{question.context}</div></details>}
        <div className="pi-native-ask-options" role="group" aria-label={question.allowMultiple ? "多选答案" : "单选答案"}>
          {question.options.map((option, index) => <button key={index} ref={index === 0 ? firstOption : undefined} type="button" className="pi-native-ask-option" data-ask-option={index} aria-pressed={!freeform && selected.includes(index)} disabled={busy} onClick={() => choose(index)}>
            <span className="pi-native-ask-index">{index + 1}</span>
            <span className="pi-native-ask-copy"><span className="pi-native-ask-label">{option.title}</span>{option.description && <span className="pi-native-ask-description">{option.description}</span>}</span>
            <span className="pi-native-ask-check" aria-hidden="true">{!freeform && selected.includes(index) ? "✓" : ""}</span>
          </button>)}
          {question.allowFreeform && question.options.length > 0 && <button type="button" className="pi-native-ask-option pi-native-ask-other" aria-label="其他 · 自定义回答" aria-pressed={freeform} disabled={busy} onClick={() => { setFreeform(true); setNotesOpen(true); setError(""); }}><span className="pi-native-ask-index">…</span><span>其他 · 自定义回答</span><span className="pi-native-ask-check">{freeform ? "✓" : ""}</span></button>}
        </div>
        {!freeform && question.allowComment && <button type="button" className="pi-native-ask-link pi-native-ask-notes-toggle" aria-expanded={notesOpen} disabled={busy} onClick={() => setNotesOpen(value => !value)}>{notesOpen ? "收起补充说明" : "＋ 补充说明"}</button>}
        <div className="pi-native-ask-notes" hidden={!notesOpen && !freeform}>
          <textarea aria-label={freeform ? "自定义回答" : "补充说明"} placeholder={freeform ? "输入你的回答…" : "可选：补充你的要求或理由…"} rows={2} value={notes} disabled={busy} onChange={event => setDrafts(current => ({ ...current, [draftKey]: event.target.value }))} />
        </div>
      </div>
      <footer className="pi-native-ask-footer" hidden={collapsed}>
        <span className="pi-native-ask-hint" role="status">{error || (busy ? "正在提交，等待确认…" : "先选择，再确认 · Enter 提交")}</span>
        <button type="button" className="pi-native-ask-cancel" disabled={busy} onClick={() => void send(["\x03"])}>取消</button>
        <button type="button" className="pi-native-ask-submit" disabled={busy || (freeform ? !notes.trim() : !selected.length)} onClick={submit}>{busy ? "提交中…" : "确认回答"}</button>
      </footer>
    </section>
  </div>;
}
