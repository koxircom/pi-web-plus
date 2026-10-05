import type { AgentMessage } from "@/lib/types";

function extractMessageText(message: Partial<AgentMessage>): string {
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) =>
      block && typeof block === "object"
        && (block as { type?: string }).type === "text"
        && typeof (block as { text?: unknown }).text === "string"
        ? (block as { text: string }).text
        : "")
    .filter(Boolean)
    .join("\n");
}

function imageSignature(block: unknown): string {
  if (!block || typeof block !== "object" || (block as { type?: unknown }).type !== "image") return "";
  const source = (block as { source?: unknown }).source;
  if (source && typeof source === "object") {
    const src = source as { type?: unknown; media_type?: unknown; data?: unknown; url?: unknown };
    return [
      src.type === "url" ? "url" : "base64",
      typeof src.media_type === "string" ? src.media_type : "",
      typeof src.data === "string" ? src.data : "",
      typeof src.url === "string" ? src.url : "",
    ].join(":");
  }
  const flat = block as { data?: unknown; mimeType?: unknown };
  return [
    "base64",
    typeof flat.mimeType === "string" ? flat.mimeType : "",
    typeof flat.data === "string" ? flat.data : "",
    "",
  ].join(":");
}

export function userMessageKey(message: Partial<AgentMessage>): string {
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return JSON.stringify({ text: content, images: [] });
  if (!Array.isArray(content)) return JSON.stringify({ text: "", images: [] });
  return JSON.stringify({
    text: extractMessageText(message),
    images: content.map(imageSignature).filter(Boolean),
  });
}

/** One local submission, owned by the session hook until confirmation/rejection.
 * History reads stay authoritative; this echo is only part of the display view.
 */
export interface OptimisticUserMessage {
  sessionId: string | null;
  message: AgentMessage;
  precedingEntryIds: readonly string[];
}

export function preservePendingUserMessage(
  history: AgentMessage[], entryIds: string[], sessionId: string,
  pending: OptimisticUserMessage | null,
): AgentMessage[] {
  if (!pending || pending.sessionId !== sessionId) return history;
  const previousIds = new Set(pending.precedingEntryIds);
  const key = userMessageKey(pending.message);
  const confirmed = history.some((message, i) => message.role === "user"
    && entryIds[i] && !previousIds.has(entryIds[i]) && userMessageKey(message) === key);
  return confirmed ? history : [...history, pending.message];
}
