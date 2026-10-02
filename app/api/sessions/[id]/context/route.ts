import { handleSessionContextRequest } from "@/lib/session-context-service";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return handleSessionContextRequest(req, { id });
}

export async function HEAD(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return handleSessionContextRequest(req, { id });
}

