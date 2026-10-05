"use client";

import React, { useCallback, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { QueuedMessages } from "@/hooks/useAgentSession";

type Entry = { kind: "steer" | "follow-up"; text: string };
type Image = { data: string; mimeType: string; alt?: string };
type Details = { signature: string; enabled: boolean; busy: boolean; reorder?: boolean; images: Image[][] };

function QueueIcon({ kind }: { kind: "more" | "delete" | "promote" | "sort" }) {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {kind === "more" ? <><circle cx="5" cy="12" r=".8" /><circle cx="12" cy="12" r=".8" /><circle cx="19" cy="12" r=".8" /></>
      : kind === "delete" ? <><path d="M4 6h16M18 6l-1 14H7L6 6M9 6V3h6v3M10 10v6M14 10v6" /></>
      : kind === "sort" ? <><path d="M4 4v14h15m-4-4 4 4-4 4M9 6h10M9 11h6" /></>
      : <path d="M4 5v4a5 5 0 0 0 5 5h11m-5-5 5 5-5 5" />}
  </svg>;
}

/** Queue nodes belong to React from their first paint to consumption. The
 * existing enhancement service provides secure actions and attachment data,
 * through an explicit extension boundary; it never inspects/writes these nodes. */
export function ComposerQueue({ sessionId, queuedMessages, onRecallQueue, pending }: {
  pending?: { kind: "steering" | "followUp"; text: string; images: Image[] } | null;
  sessionId: string; queuedMessages?: QueuedMessages | null; onRecallQueue?: () => void;
}) {
  const host = useRef<HTMLElement>(null);
  const entries: Entry[] = [
    ...(queuedMessages?.steering ?? []).map(text => ({ kind: "steer" as const, text })),
    ...(queuedMessages?.followUp ?? []).map(text => ({ kind: "follow-up" as const, text })),
  ];
  const rows = [...entries.map(entry => ({...entry, pending: false})), ...(pending ? [{ kind: pending.kind === "steering" ? "steer" as const : "follow-up" as const, text: pending.text, pending: true }] : [])];
  const signature = JSON.stringify([sessionId, entries]);
  const current = useRef({ sessionId, entries, signature });
  current.current = { sessionId, entries, signature };
  const [details, setDetails] = useState<Details | null>(null);
  const [confirmation, setConfirmation] = useState<{signature: string; index: number} | null>(null);
  const [hover, setHover] = useState<{src: string; left: number; bottom: number; count: number} | null>(null);
  const [menu, setMenu] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const drag = useRef<{index: number; target: number; signature: string; pointerId: number; startY: number; moved: boolean} | null>(null);
  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const publish = useCallback(() => {
    window.dispatchEvent(new CustomEvent("pi:native-queue-snapshot", {
      detail: { ...current.current, host: host.current },
    }));
  }, []);
  useLayoutEffect(() => {
    const receive = (event: Event) => {
      const data = (event as CustomEvent<Details>).detail;
      if (data?.signature === current.current.signature) setDetails(data);
      else if (data?.enabled === false && !data.signature) setDetails(null);
    };
    window.addEventListener("pi:native-queue-details", receive);
    window.addEventListener("pi:native-queue-ready", publish);
    return () => {
      window.removeEventListener("pi:native-queue-details", receive);
      window.removeEventListener("pi:native-queue-ready", publish);
      if (confirmTimer.current) clearTimeout(confirmTimer.current);
    };
  }, [publish]);
  useLayoutEffect(() => { publish(); }, [signature, publish]);
  useLayoutEffect(() => {
    setHover(null); setMenu(null); setDropIndex(null); drag.current = null;
  }, [signature]);
  useLayoutEffect(() => {
    if (!hover) return;
    const close = () => setHover(null);
    const escape = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("blur", close);
    window.addEventListener("scroll", close, {capture: true, passive: true});
    window.addEventListener("keydown", escape);
    return () => { window.removeEventListener("blur", close); window.removeEventListener("scroll", close, true); window.removeEventListener("keydown", escape); };
  }, [hover]);
  const active = details?.signature === signature ? details : null;
  const action = (name: string, index = -1, targetIndex = -1) => {
    if (!active?.enabled) {
      if (name === "recallAll") onRecallQueue?.();
      return;
    }
    window.dispatchEvent(new CustomEvent("pi:native-queue-action", {
      detail: { action: name, index, targetIndex, sessionId, signature },
    }));
  };
  const remove = (index: number) => {
    if (confirmTimer.current) clearTimeout(confirmTimer.current);
    if (confirmation?.signature === signature && confirmation.index === index) {
      setConfirmation(null);
      action("delete", index);
    } else {
      setConfirmation({signature, index});
      confirmTimer.current = setTimeout(() => setConfirmation(null), 3500);
    }
  };
  return <section ref={host} className="pi-enh-queue-panel" data-pi-native-queue="true" aria-label="排队消息" hidden={!rows.length}>
    <div className="pi-enh-queue-header"><span>待处理 · {rows.length}</span>
      <button type="button" className="pi-enh-queue-recall" disabled={active?.busy || (!active?.enabled && !onRecallQueue)} onClick={() => action("recallAll")} title="安全移回全部排队消息至输入框">↩ 全部编辑</button>
    </div>
    <div className="pi-enh-queue-list">{rows.map((entry, index) => {
      const images = entry.pending ? pending?.images ?? [] : active?.images[index] ?? [];
      const src = images[0] ? `data:${images[0].mimeType};base64,${images[0].data}` : "";
      const confirming = confirmation?.signature === signature && confirmation.index === index;
      const disabled = entry.pending || !active?.enabled || active.busy;
      const sortable = !disabled && active?.reorder && entries.filter(row => row.kind === entry.kind).length > 1;
      const move = (target: number) => {
        if (sortable && entries[target]?.kind === entry.kind) action("reorder", index, target);
      };
      return <div ref={node => {rowRefs.current[index] = node;}} data-queue-index={index} className={`pi-enh-queue-row${dropIndex === index ? " pi-enh-queue-row-target" : ""}`} key={`${entry.kind}-${index}`}>
        <button type="button" className="pi-enh-queue-sort" aria-label={`拖动排序第 ${index + 1} 条排队消息`} title="拖动调整同类消息顺序；也可用上下方向键" disabled={!sortable}
          onKeyDown={e => {if (e.key === "ArrowUp" || e.key === "ArrowDown") {e.preventDefault(); move(index + (e.key === "ArrowUp" ? -1 : 1));}}}
          onPointerDown={e => {
            if (!sortable || e.button !== 0) return;
            e.currentTarget.setPointerCapture(e.pointerId);
            drag.current = {index, target: index, signature, pointerId: e.pointerId, startY: e.clientY, moved: false};
            setMenu(null); setHover(null);
          }} onPointerMove={e => {
            const d = drag.current;
            if (!d || d.pointerId !== e.pointerId || d.signature !== signature) return;
            if (Math.abs(e.clientY - d.startY) < 5 && !d.moved) return;
            d.moved = true;
            const target = rowRefs.current.findIndex((row, i) => {
              if (!row || !entries[i] || entries[i].kind !== entry.kind) return false;
              const rect = row.getBoundingClientRect();
              return e.clientY >= rect.top && e.clientY <= rect.bottom;
            });
            if (target >= 0) {d.target = target; setDropIndex(target);}
          }} onPointerUp={e => {
            const d = drag.current; drag.current = null; setDropIndex(null);
            if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
            if (d?.moved && d.signature === signature) move(d.target);
          }} onPointerCancel={() => {drag.current = null; setDropIndex(null);}} onLostPointerCapture={() => {drag.current = null; setDropIndex(null);}}><QueueIcon kind="sort" /></button>
        {!!images.length && <button type="button" className="pi-enh-queue-image-badge" aria-label="查看排队消息附带图片" disabled={entry.pending} onClick={() => { setHover(null); action("gallery", index); }} onMouseEnter={e => {
            const rect = e.currentTarget.getBoundingClientRect();
            setHover({src, count: images.length, left: Math.max(10, Math.min(window.innerWidth - 250, rect.left)), bottom: window.innerHeight - rect.top + 8});
          }} onMouseLeave={() => setHover(null)}>
          <img className="pi-enh-queue-thumb" src={src} alt={images[0].alt || "图片附件"} data-no-zoom="true" />
          {images.length > 1 && <span className="pi-enh-queue-image-count">{images.length}</span>}
        </button>}
        <button type="button" className="pi-enh-queue-text" disabled={entry.pending || !active?.enabled || active.busy} title={`点击移回输入框编辑：${entry.text || "图片消息"}`} onClick={() => action("recall", index)}>{entry.text || (images.length ? "" : "图片消息")}</button>
        <div className="pi-enh-queue-actions">
          {entry.kind === "follow-up" && <button type="button" className="pi-enh-queue-promote" aria-label={`立即引导第 ${index + 1} 条排队消息`} disabled={entry.pending || !active?.enabled || active.busy} onClick={() => action("promote", index)}><QueueIcon kind="promote" /><span>引导</span></button>}
          <button type="button" className={`pi-enh-queue-delete${confirming ? " pi-enh-queue-delete-confirming" : ""}`} aria-label={`删除第 ${index + 1} 条排队消息`} title={confirming ? "再次点击确认删除" : "删除此排队消息"} disabled={entry.pending || !active?.enabled || active.busy} onClick={() => remove(index)}><QueueIcon kind="delete" /></button>
          <button type="button" className="pi-enh-queue-more" aria-label={`更多操作：第 ${index + 1} 条排队消息`} aria-expanded={menu === index} disabled={disabled} onClick={() => setMenu(menu === index ? null : index)}><QueueIcon kind="more" /></button>
        </div>
        {menu === index && <div className="pi-enh-queue-menu" onKeyDown={e => {if (e.key === "Escape") {setMenu(null); e.stopPropagation();}}}>
          <button type="button" onClick={() => {setMenu(null); action("recall", index);}}>移回输入框编辑</button>
          <button type="button" disabled={!sortable || entries[index - 1]?.kind !== entry.kind} onClick={() => {setMenu(null); move(index - 1);}}>上移</button>
          <button type="button" disabled={!sortable || entries[index + 1]?.kind !== entry.kind} onClick={() => {setMenu(null); move(index + 1);}}>下移</button>
        </div>}
      </div>;
    })}</div>
    {hover && createPortal(<div className="pi-enh-queue-hover-preview" style={{left: hover.left, bottom: hover.bottom}}><img src={hover.src} alt="图片附件预览" /><span>{hover.count > 1 ? `共 ${hover.count} 张图片 · 点击放大左右切换` : "图片附件预览 · 点击放大"}</span></div>, document.body)}
  </section>;
}
