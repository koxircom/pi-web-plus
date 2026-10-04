import { createHash } from "node:crypto";
import type { ToolResultMessage } from "./types";

export const DEFERRED_TOOL_RESULT_MIN_BYTES = 4096;

export function toolResultBodyRevision(message: ToolResultMessage): string {
  return createHash("sha256").update(JSON.stringify([message.content, message.details ?? null])).digest("hex");
}

/** Defer only bodies that have no visible collapsed detail beyond images/status. */
export function deferLargeToolResult(message: ToolResultMessage, entryId: string): ToolResultMessage {
  // Subagent details also own the always-visible open-session action.
  if (message.inProgress || (message.details as { kind?: unknown } | undefined)?.kind === "pi-web-subagent") return message;
  const body = JSON.stringify([message.content, message.details ?? null]);
  if (Buffer.byteLength(JSON.stringify(message.content)) < DEFERRED_TOOL_RESULT_MIN_BYTES) return message;
  return {
    ...message,
    content: message.content.filter(block => block.type === "image"),
    deferredResult: { entryId, revision: createHash("sha256").update(body).digest("hex") },
  };
}
