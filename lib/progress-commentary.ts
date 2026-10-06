import type { InlineExtension } from "@earendil-works/pi-coding-agent";

export const PROGRESS_COMMENTARY_GUIDANCE = `[Pi Web progress communication]
For nontrivial work, communicate the work as meaningful milestones, not a tool-call log:
- Before the first tool call, tell the user the concrete things you will do and the first small goal. Group related actions into a few verifiable goals, such as locating the cause, making the fix, and checking the result. Avoid vague openings like “I will investigate” without saying what you will check.
- When a small goal is achieved, report the verified finding and its impact, then say what goal comes next before starting it. If a goal takes substantial time, share a substantive intermediate finding or explain a changed approach or blocker; do not remain silent through dozens of operations. Do not invent progress when no new evidence exists.
- Emit these updates as ordinary public assistant text before the relevant tools, not as private thinking, a hidden extension message, or a tool result. Use the user's language and 1–2 short sentences. Example opening: “我先检查消息发送与队列更新，再修复重复提交，最后验证刷新后的效果。” Example transition: “已确认重复内容来自草稿恢复；接下来修正恢复逻辑并验证新建会话。”
- Several related commands, reads, searches, and routine retries belong to the same goal. Do not announce each tool call, each tool batch, or each model turn, and do not repeat the whole plan. Native tool rows already show the individual actions; their counts and “waiting for model” are not a substitute for explaining the goal.
- Respect explicit requests for more or less detail. For simple tasks, answer directly. Finish with the verified outcome and any remaining gaps, then stop; do not make extra model requests, tool calls, or automatic continuations just to generate progress summaries.`;

/** Append once to the SDK's current prompt; retain project/user/extension instructions. */
export function withProgressCommentary(systemPrompt: string): string {
  return systemPrompt.includes(PROGRESS_COMMENTARY_GUIDANCE)
    ? systemPrompt
    : `${systemPrompt}\n\n${PROGRESS_COMMENTARY_GUIDANCE}`;
}

export function createProgressCommentaryExtension(): InlineExtension {
  return {
    name: "pi-web-progress-commentary",
    hidden: true,
    factory: (pi) => {
      pi.on("before_agent_start", (event) => ({ systemPrompt: withProgressCommentary(event.systemPrompt) }));
    },
  };
}
