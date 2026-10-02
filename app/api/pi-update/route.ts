import { NextResponse } from "next/server";
import { getLatestPiAgentRelease } from "@/lib/pi-update";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ installedVersion: process.env.NEXT_PUBLIC_PI_VERSION ?? null, ...await getLatestPiAgentRelease() });
}
