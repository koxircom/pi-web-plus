"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { isEnhancementPluginEnabled } from "@/lib/enhancement-chat-bridge";
import { convergeChatTail } from "@/lib/chat-scroll-to-bottom";

export function ChatScrollToBottom({ visible, sessionId, containerRef, label }: {
  visible: boolean;
  sessionId: string | null;
  containerRef: RefObject<HTMLDivElement | null>;
  label: string;
}) {
  const [enhanced, setEnhanced] = useState(() => isEnhancementPluginEnabled("scroll-to-bottom"));
  const cancelRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    const update = (event: Event) => {
      const enabled = (event as CustomEvent<{ enabled: boolean }>).detail?.enabled;
      setEnhanced(typeof enabled === "boolean" ? enabled : isEnhancementPluginEnabled("scroll-to-bottom"));
    };
    setEnhanced(isEnhancementPluginEnabled("scroll-to-bottom"));
    window.addEventListener("pi:scroll-bottom-preferences", update);
    return () => window.removeEventListener("pi:scroll-bottom-preferences", update);
  }, []);
  useEffect(() => () => { cancelRef.current?.(); cancelRef.current = null; }, [sessionId]);
  return <button
    type="button"
    className={`chat-scroll-to-bottom${enhanced ? " is-enhanced" : ""}${visible ? " is-visible" : ""}`}
    title={label}
    aria-label={label}
    onClick={() => {
      window.dispatchEvent(new Event("pi-chat-cancel-scroll-restore"));
      cancelRef.current?.();
      const container = containerRef.current;
      if (container) cancelRef.current = convergeChatTail(container);
    }}
  >
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 5v14M5 12l7 7 7-7" />
    </svg>
  </button>;
}
