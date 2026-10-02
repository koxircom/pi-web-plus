export type ChatScrollPosition =
  | { atBottom: true }
  | {
      atBottom: false;
      anchorEntryId: string;
      anchorKey?: string;
      anchorOffset: number;
      oldestEntryId: string | null;
    };

export interface ChatScrollAnchorCandidate {
  entryId: string;
  anchorKey?: string;
  top: number;
  bottom: number;
}

export function findChatScrollAnchor(
  candidates: ChatScrollAnchorCandidate[],
  viewportTop: number,
): Pick<Extract<ChatScrollPosition, { atBottom: false }>, "anchorEntryId" | "anchorKey" | "anchorOffset"> | null {
  let candidate = candidates[0];
  for (const item of candidates) {
    if (item.top > viewportTop) break;
    candidate = item;
  }
  if (!candidate) return null;
  return {
    anchorEntryId: candidate.entryId,
    ...(candidate.anchorKey ? { anchorKey: candidate.anchorKey } : {}),
    anchorOffset: candidate.top - viewportTop,
  };
}

// Keep the established tab-local key so older reading positions migrate in place.
export const CHAT_SCROLL_STORAGE_KEY = "pi-enh-session-scroll-memory-v2";
export const MAX_SAVED_CHAT_POSITIONS = 80;

export function readChatScrollPositions(raw: string | null): Map<string, ChatScrollPosition> {
  const positions = new Map<string, ChatScrollPosition>();
  try {
    const records: unknown = JSON.parse(raw ?? "null");
    if (!Array.isArray(records)) return positions;
    for (const record of records.slice(-MAX_SAVED_CHAT_POSITIONS)) {
      if (!record || typeof record.sessionId !== "string" || !record.sessionId) continue;
      if (record.atBottom === true || record.isAtBottom === true) {
        positions.set(record.sessionId, { atBottom: true });
      } else if ((record.atBottom === false || record.isAtBottom === false)
        && typeof record.anchorEntryId === "string" && record.anchorEntryId
        && Number.isFinite(record.anchorOffset)) {
        positions.set(record.sessionId, {
          atBottom: false,
          anchorEntryId: record.anchorEntryId,
          ...(typeof record.anchorKey === "string" && record.anchorKey ? { anchorKey: record.anchorKey } : {}),
          anchorOffset: record.anchorOffset,
          oldestEntryId: typeof record.oldestEntryId === "string" ? record.oldestEntryId : null,
        });
      }
    }
  } catch { /* Invalid or unavailable tab storage must not block the conversation. */ }
  return positions;
}

export function serializeChatScrollPositions(positions: Map<string, ChatScrollPosition>): string {
  return JSON.stringify(Array.from(positions.entries()).slice(-MAX_SAVED_CHAT_POSITIONS)
    .map(([sessionId, position]) => ({ sessionId, ...position })));
}
