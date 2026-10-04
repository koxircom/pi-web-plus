import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { MINIMAP_BOOKMARK_PREFIX, readMinimapBookmarks, writeMinimapBookmarks } from "@/lib/minimap-bookmarks";

export function useMinimapBookmarks(sessionId: string | null) {
  const [snapshot, setSnapshot] = useState({ sessionId, ids: new Set<string>() });
  const current = useRef(snapshot);

  useLayoutEffect(() => {
    const refresh = () => {
      const next = { sessionId, ids: sessionId ? readMinimapBookmarks(sessionId) : new Set<string>() };
      current.current = next;
      setSnapshot(next);
    };
    refresh();
    const sync = (event: StorageEvent) => {
      if (event.key === null || event.key === MINIMAP_BOOKMARK_PREFIX + sessionId) refresh();
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, [sessionId]);

  const toggle = useCallback((entryId: string) => {
    if (!sessionId || !entryId || current.current.sessionId !== sessionId) return;
    const ids = new Set(current.current.ids);
    if (ids.has(entryId)) ids.delete(entryId);
    else ids.add(entryId);
    const next = { sessionId, ids };
    current.current = next;
    writeMinimapBookmarks(sessionId, ids);
    setSnapshot(next);
  }, [sessionId]);

  return { bookmarks: snapshot.sessionId === sessionId ? snapshot.ids : new Set<string>(), toggle };
}
