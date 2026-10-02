import { applyPatchResultHasFailures } from "./apply-patch";
import { isApplyPatchToolName, isEditToolName, isWriteToolName } from "./tool-names";
import type { ToolCallContent, ToolResultMessage } from "./types";

export type ToolPublicStatus = "running" | "success" | "failure";

export type ToolPublicCategoryKey =
  | "chat.toolCategory.read"
  | "chat.toolCategory.command"
  | "chat.toolCategory.write"
  | "chat.toolCategory.search"
  | "chat.toolCategory.subagent"
  | "chat.toolCategory.generic";

/** Project a tool result to the short status shown in the conversation. */
export function getToolPublicStatus(
  block: ToolCallContent,
  result?: ToolResultMessage,
): ToolPublicStatus {
  if (!result || result.inProgress) return "running";
  if (result.isError || (isApplyPatchToolName(block.toolName) && applyPatchResultHasFailures(result.details))) {
    return "failure";
  }
  return "success";
}

/** Map implementation-specific tool names to a small set of user-facing categories. */
export function getToolPublicCategoryKey(toolName: string): ToolPublicCategoryKey {
  const name = toolName.toLowerCase();
  const tokens = name.split(/[^a-z0-9]+/).filter(Boolean);
  const has = (...values: string[]) => values.some((value) => tokens.includes(value));

  if (has("agent", "subagent", "sub_agent") || name.includes("get_subagent_result") || name.includes("steer_subagent")) {
    return "chat.toolCategory.subagent";
  }
  if (has("bash", "powershell", "shell", "terminal", "exec", "execute", "command")) {
    return "chat.toolCategory.command";
  }
  if (
    isApplyPatchToolName(toolName)
    || isEditToolName(toolName)
    || isWriteToolName(toolName)
    || has("patch", "create", "update", "delete", "remove", "move", "rename", "mkdir")
  ) {
    return "chat.toolCategory.write";
  }
  if (has("grep", "find", "search", "glob", "ripgrep", "rg", "query")) {
    return "chat.toolCategory.search";
  }
  if (has("read", "file", "get", "list", "ls", "cat", "open", "fetch")) {
    return "chat.toolCategory.read";
  }
  return "chat.toolCategory.generic";
}
