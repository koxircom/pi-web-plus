import { useLayoutEffect, useState, type RefObject } from "react";

/** Share the scroll viewport's available column with the fixed composer.
 * Includes both the minimap rail and the platform's actual scrollbar gutter. */
export function useChatColumnInset(
  scrollRef: RefObject<HTMLElement | null>,
  enabled: boolean,
  fallback: number,
): number {
  const [inset, setInset] = useState(fallback);
  useLayoutEffect(() => {
    const viewport = enabled ? scrollRef.current : null;
    const parent = viewport?.parentElement;
    if (!viewport || !parent) {
      setInset(fallback);
      return;
    }
    const measure = () => setInset(Math.max(0, parent.clientWidth - viewport.clientWidth));
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(viewport);
    observer?.observe(parent);
    return () => observer?.disconnect();
  }, [scrollRef, enabled, fallback]);
  return inset;
}
