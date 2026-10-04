/** Only stable message entry IDs are stored; history positions and previews are not. */
export const MINIMAP_BOOKMARK_PREFIX = "pi-web:minimap-bookmarks:";

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function bookmarkStorage(): StorageLike | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readMinimapBookmarks(sessionId: string, storage = bookmarkStorage()): Set<string> {
  try {
    const value: unknown = JSON.parse(storage?.getItem(MINIMAP_BOOKMARK_PREFIX + sessionId) ?? "[]");
    return new Set(Array.isArray(value) ? value.filter((id): id is string => typeof id === "string" && id.length > 0 && id.length <= 256) : []);
  } catch {
    return new Set();
  }
}

export function writeMinimapBookmarks(sessionId: string, ids: ReadonlySet<string>, storage = bookmarkStorage()): void {
  try {
    const key = MINIMAP_BOOKMARK_PREFIX + sessionId;
    if (ids.size) storage?.setItem(key, JSON.stringify([...ids]));
    else storage?.removeItem(key);
  } catch {
    // Private browsing or a full store still allows marking in the current view.
  }
}
