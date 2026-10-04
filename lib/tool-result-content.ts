import type { ToolResultMessage } from "./types";

const MAX_ENTRIES = 32, MAX_BYTES = 8 * 1024 * 1024;
const cache = new Map<string, { request: Promise<ToolResultMessage>; bytes: number }>();
export function clearToolResultContentCache(): void { cache.clear(); }
export function deleteToolResultContentCache(sessionId: string): void {
  for (const key of cache.keys()) if (JSON.parse(key)[0] === sessionId) cache.delete(key);
}

/** Coalesce opens; retain only bounded successful, versioned historical bodies. */
export function loadToolResultContent(sessionId: string, ref: { entryId: string; revision: string }, toolCallId: string): Promise<ToolResultMessage> {
  const key = JSON.stringify([sessionId, ref.entryId, ref.revision, toolCallId]);
  const old = cache.get(key);
  if (old) { cache.delete(key); cache.set(key, old); return old.request; }
  const entry = { request: undefined as unknown as Promise<ToolResultMessage>, bytes: 0 };
  entry.request = fetch(`/api/sessions/${encodeURIComponent(sessionId)}/entries/${encodeURIComponent(ref.entryId)}/tool-result?revision=${encodeURIComponent(ref.revision)}`, {
    signal: AbortSignal.timeout(30_000),
  }).then(async response => {
    if (!response.ok) throw new Error(response.status === 409 ? "工具结果已变化，请刷新会话。" : "读取工具结果失败，请重新打开详情重试。");
    const data = await response.json() as { entryId?: unknown; revision?: unknown; result?: ToolResultMessage };
    if (data.entryId !== ref.entryId || data.revision !== ref.revision || data.result?.role !== "toolResult"
      || data.result.toolCallId !== toolCallId || !Array.isArray(data.result.content) || data.result.deferredResult) {
      throw new Error("工具结果校验失败，请刷新会话。");
    }
    entry.bytes = new TextEncoder().encode(JSON.stringify(data.result)).byteLength;
    let bytes = [...cache.values()].reduce((total, item) => total + item.bytes, 0);
    while (cache.size > MAX_ENTRIES || bytes > MAX_BYTES) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) break;
      bytes -= cache.get(oldest)!.bytes; cache.delete(oldest);
    }
    return data.result;
  }).catch(error => { if (cache.get(key) === entry) cache.delete(key); throw error; });
  cache.set(key, entry);
  if (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value!);
  return entry.request;
}
