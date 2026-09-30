import { handleEnhancementStateOperationsPost } from "@/lib/enhancement-state-api";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return handleEnhancementStateOperationsPost(request);
}
