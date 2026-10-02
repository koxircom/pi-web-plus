import type { InlineExtension } from "@earendil-works/pi-coding-agent";

export const PROGRESS_COMMENTARY_GUIDANCE = `[Pi Web progress communication]
For tasks that involve tools or multiple steps, briefly explain the next meaningful action in ordinary assistant text before the first tool batch. During longer work, provide short updates when you learn something important, change direction, encounter a blocker, or finish a stage. Use the user's language and explain what the finding means. Do not narrate every tool call or repeat unchanged status. Tool names, arguments, logs, and internal reasoning are not progress explanations. Do not expose private chain of thought. Only report observations you actually made; do not invent progress or claim success before verification. Finish with a clear result and any remaining gap. For a simple answer, respond directly.`;

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
