import { handleToolResultRequest } from "@/lib/session-tool-result-service";

export async function GET(req: Request, { params }: { params: Promise<{ id: string; entryId: string }> }): Promise<Response> {
  return handleToolResultRequest(req, await params);
}
