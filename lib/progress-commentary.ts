import type { InlineExtension } from "@earendil-works/pi-coding-agent";

export const PROGRESS_COMMENTARY_GUIDANCE = `[Pi Web progress communication]
Use milestone updates, not a tool-call log. For nontrivial work, give one brief orientation at task start, not before each model turn or tool batch. Group related checks into meaningful phases. Within a phase, continue with tool calls alone; do not announce each command, file read or routine retry. Report a phase change, a verified finding and its impact, a changed approach, or a blocker needing user input. Keep updates to 1–2 short sentences in the user's language. Native tool rows already show actions and status; do not restate them or make extra model requests for summaries. Example: “已检查网络和代理配置，问题集中在 TUN 路由；接下来验证修复。” Respect explicit requests for detailed progress. Do not expose private reasoning or invent results. Finish with the verified outcome and remaining gaps. For simple tasks, answer directly.`;

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
