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

/** Small, render-local projection: never retain arguments, results or a second
 * execution state. At most six unique category keys are stored per group. */
export type ToolProcessSummary = {
  running: number; success: number; failure: number;
  categories: ToolPublicCategoryKey[];
  runningCategories: ToolPublicCategoryKey[];
};

export function createToolProcessSummary(): ToolProcessSummary {
  return {running: 0, success: 0, failure: 0, categories: [], runningCategories: []};
}

export function includeToolInProcessSummary(summary: ToolProcessSummary, block: ToolCallContent, result?: ToolResultMessage): void {
  const status = getToolPublicStatus(block, result);
  const category = getToolPublicCategoryKey(block.toolName);
  summary[status]++;
  if (!summary.categories.includes(category)) summary.categories.push(category);
  if (status === "running" && !summary.runningCategories.includes(category)) summary.runningCategories.push(category);
}

export function getToolProcessSummaryLabel(
  summary: ToolProcessSummary,
  t: (key: string, params?: Record<string, string | number>) => string,
  streamingThinking = false,
): string {
  const categories = summary.running ? summary.runningCategories : summary.categories;
  if (!categories.length) return t(streamingThinking ? "chat.thinking" : "chat.processThinkingRecord");
  const actions = categories.map(key => t(key === "chat.toolCategory.generic" ? "chat.processAction.generic"
    : key === "chat.toolCategory.subagent" ? "chat.processAction.subagent" : key)).join(t("chat.processActionSeparator"));
  const parts = [t(summary.running ? "chat.processRunning" : "chat.processExecuted", {actions})];
  if (summary.running) parts.push(t("chat.toolStatusRunningCount", {count: summary.running}));
  if (summary.success) parts.push(t("chat.toolStatusSuccessCount", {count: summary.success}));
  if (summary.failure) parts.push(t("chat.toolStatusFailureCount", {count: summary.failure}));
  return parts.join(" · ");
}

/** The slim execution-end event establishes status before the transcript result
 * arrives. Reuse partial output until that authoritative message replaces it. */
export function completeActiveToolResult(
  previous: ToolResultMessage | undefined,
  event: { toolCallId: string; toolName?: string; isError?: boolean },
): ToolResultMessage {
  return {
    ...previous,
    role: "toolResult",
    toolCallId: event.toolCallId,
    toolName: event.toolName ?? previous?.toolName,
    content: previous?.content ?? [],
    isError: event.isError ?? previous?.isError,
    inProgress: false,
  };
}
