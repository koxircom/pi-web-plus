import {
  handleEnhancementStateGet,
  handleEnhancementStateHead,
} from "@/lib/enhancement-state-api";

export const dynamic = "force-dynamic";

export async function HEAD(request: Request) {
  return handleEnhancementStateHead(request);
}

export async function GET(request: Request) {
  return handleEnhancementStateGet(request);
}
