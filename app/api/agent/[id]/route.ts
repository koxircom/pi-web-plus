import { NextResponse } from "next/server";
import { resolveSessionPath } from "@/lib/session-reader";
import { startRpcSession, getRpcSession, setRpcSessionTools } from "@/lib/rpc-manager";
import { getPromptReceipt, runPromptDelivery, validPromptRequestId } from "@/lib/prompt-delivery";

async function executeCommand(id: string, body: Record<string, unknown>): Promise<unknown> {
  const requestedToolNames = body.toolNames;
  if (requestedToolNames !== undefined
    && (!Array.isArray(requestedToolNames) || requestedToolNames.some((name) => typeof name !== "string"))) {
    throw new Error("toolNames must be an array of strings");
  }
  const toolNames = requestedToolNames as string[] | undefined;
  const existing = getRpcSession(id);
  if (body.type === "set_tools") {
    const filePath = existing?.sessionFile || await resolveSessionPath(id) || undefined;
    if (!existing?.isAlive() && !filePath) throw new Error("Session not found");
    const changed = await setRpcSessionTools(id, filePath, toolNames);
    return { sessionId: changed.sessionId, recreated: changed.recreated };
  }
  if (existing?.isAlive()) return await existing.send(body);
  const filePath = await resolveSessionPath(id);
  if (!filePath) throw new Error("Session not found");
  const { session } = await startRpcSession(id, filePath, undefined, {
    ...(toolNames !== undefined ? { toolNames } : {}),
  });
  return await session.send(body);
}

// A request ID identifies one submission, not the text (identical messages are valid).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let commandType: string | undefined;
  try {
    const body = await req.json() as Record<string, unknown>;
    commandType = typeof body.type === "string" ? body.type : undefined;
    if (body.type === "prompt" && body.requestId !== undefined && !validPromptRequestId(body.requestId)) {
      throw new Error("Invalid prompt request ID");
    }
    const execute = () => executeCommand(id, body);
    const result = body.type === "prompt" && validPromptRequestId(body.requestId)
      ? await runPromptDelivery(id, body.requestId, body, execute)
      : await execute();
    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message,
      ...(commandType === "prompt" ? { code: "prompt_rejected", accepted: false } : {}),
    }, { status: message === "Session not found" ? 404 : 500 });
  }
}

// Receipt reads neither create a wrapper nor start a model request.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const requestId = new URL(req.url).searchParams.get("requestId");
  if (requestId !== null) {
    if (!validPromptRequestId(requestId)) return NextResponse.json({ error: "Invalid prompt request ID" }, { status: 400 });
    return NextResponse.json(getPromptReceipt(id, requestId), { headers: { "Cache-Control": "no-store" } });
  }
  try {
    const session = getRpcSession(id);
    if (!session || !session.isAlive()) return NextResponse.json({ running: false });
    const state = await session.send({ type: "get_state" });
    return NextResponse.json({ running: session.isRunning(), runtimeAlive: true, state });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
