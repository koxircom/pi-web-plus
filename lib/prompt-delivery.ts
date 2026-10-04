import { createHash } from "node:crypto";

export type PromptReceipt =
  | { status: "pending" | "accepted" | "unknown" }
  | { status: "rejected"; error: string };

type Delivery = { fingerprint: string; receipt: PromptReceipt; result: Promise<unknown>; at: number };
const key = Symbol.for("pi-web:prompt-delivery");
const registry = globalThis as typeof globalThis & { [key]?: Map<string, Delivery> };
const deliveries = registry[key] ??= new Map<string, Delivery>();
const MAX_RECEIPTS = 512;
const RETENTION_MS = 24 * 60 * 60 * 1000;
const receiptKey = (sid: string, requestId: string) => JSON.stringify([sid, requestId]);

export function validPromptRequestId(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z0-9-]{16,80}$/.test(value);
}

export function getPromptReceipt(sid: string, requestId: string): PromptReceipt {
  return deliveries.get(receiptKey(sid, requestId))?.receipt ?? { status: "unknown" };
}

/** Register before any async session/preflight work. A lost response is not a
 * negative acknowledgement. Unknown after restart never authorizes a resend. */
export function runPromptDelivery(sid: string, requestId: string, command: Record<string, unknown>, execute: () => Promise<unknown>): Promise<unknown> {
  const id = receiptKey(sid, requestId);
  const fingerprint = createHash("sha256").update(JSON.stringify([
    command.message, command.images ?? [], command.streamingBehavior ?? null, command.toolNames ?? null,
  ])).digest("hex");
  const existing = deliveries.get(id);
  if (existing) {
    if (existing.fingerprint !== fingerprint) return Promise.reject(new Error("Prompt request ID already belongs to another submission"));
    return existing.result;
  }
  const now = Date.now();
  for (const [k, item] of deliveries) {
    if (item.receipt.status !== "pending" && now - item.at > RETENTION_MS) deliveries.delete(k);
  }
  // Do not evict live or retained receipts to admit a new request.
  if (deliveries.size >= MAX_RECEIPTS) return Promise.reject(new Error("Too many retained prompt receipts; submission was not sent"));
  const delivery: Delivery = { fingerprint, receipt: { status: "pending" }, at: now, result: Promise.resolve() };
  deliveries.set(id, delivery);
  delivery.result = Promise.resolve().then(execute).then((result) => {
    delivery.receipt = { status: "accepted" };
    return result;
  }, (error: unknown) => {
    delivery.receipt = { status: "rejected", error: error instanceof Error ? error.message : String(error) };
    throw error;
  });
  return delivery.result;
}
