export type HistoryLoadAction = "reveal-local" | "load-remote" | "none";

export function getHistoryLoadAction(startIndex: number, hasEarlierMessages: boolean): HistoryLoadAction {
  if (startIndex > 0) return "reveal-local";
  return hasEarlierMessages ? "load-remote" : "none";
}
