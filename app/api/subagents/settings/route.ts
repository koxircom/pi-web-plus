import { NextResponse } from "next/server";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import {
  readSubagentSettings,
  MAX_SUBAGENT_MAX_CONCURRENT,
  writeBuiltInSubagentsEnabled,
  writeSubagentModelOverride,
  writeSubagentProfileOverride,
  writeSubagentOverrides,
  writeSubagentMaxConcurrent,
  type SubagentOverride,
} from "@/lib/subagent-settings";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const settings = readSubagentSettings();
    return NextResponse.json({
      enabled: settings.builtInEnabled,
      maxConcurrent: settings.maxConcurrent,
      subagentModel: settings.subagentModel,
      subagentOverrides: settings.subagentOverrides,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

export async function PUT(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  if (!hasJsonContentType(req)) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }

  try {
    const body = await req.json() as {
      enabled?: unknown;
      maxConcurrent?: unknown;
      subagentModel?: unknown;
      profileOverride?: unknown;
      subagentOverrides?: unknown;
    };
    if (
      body.enabled === undefined
      && body.maxConcurrent === undefined
      && body.subagentModel === undefined
      && body.profileOverride === undefined
      && body.subagentOverrides === undefined
    ) {
      return NextResponse.json({ error: "enabled, maxConcurrent, subagentModel, profileOverride, or subagentOverrides is required" }, { status: 400 });
    }
    if (body.enabled !== undefined && typeof body.enabled !== "boolean") {
      return NextResponse.json({ error: "enabled must be a boolean" }, { status: 400 });
    }
    if (body.maxConcurrent !== undefined && (
      typeof body.maxConcurrent !== "number"
      || !Number.isInteger(body.maxConcurrent)
      || body.maxConcurrent < 1
      || body.maxConcurrent > MAX_SUBAGENT_MAX_CONCURRENT
    )) {
      return NextResponse.json({ error: `maxConcurrent must be an integer between 1 and ${MAX_SUBAGENT_MAX_CONCURRENT}` }, { status: 400 });
    }
    if (body.subagentModel !== undefined && body.subagentModel !== null && (
      typeof body.subagentModel !== "string"
      || !body.subagentModel.trim()
    )) {
      return NextResponse.json({ error: "subagentModel must be null or a non-empty string" }, { status: 400 });
    }

    if (body.profileOverride !== undefined) {
      if (!body.profileOverride || typeof body.profileOverride !== "object" || Array.isArray(body.profileOverride)) {
        return NextResponse.json({ error: "profileOverride must be an object with profile name" }, { status: 400 });
      }
      const overrideObj = body.profileOverride as Record<string, unknown>;
      if (typeof overrideObj.profile !== "string" || !overrideObj.profile.trim()) {
        return NextResponse.json({ error: "profileOverride.profile must be a non-empty string" }, { status: 400 });
      }
      if (overrideObj.model !== undefined && overrideObj.model !== null && (
        typeof overrideObj.model !== "string" || !overrideObj.model.trim()
      )) {
        return NextResponse.json({ error: "profileOverride.model must be null or a non-empty string" }, { status: 400 });
      }
      if (overrideObj.thinking !== undefined && overrideObj.thinking !== null && (
        typeof overrideObj.thinking !== "string" || !overrideObj.thinking.trim()
      )) {
        return NextResponse.json({ error: "profileOverride.thinking must be null or a non-empty string" }, { status: 400 });
      }
    }

    if (body.subagentOverrides !== undefined) {
      if (!body.subagentOverrides || typeof body.subagentOverrides !== "object" || Array.isArray(body.subagentOverrides)) {
        return NextResponse.json({ error: "subagentOverrides must be an object mapping profile names to overrides" }, { status: 400 });
      }
      const overridesMap = body.subagentOverrides as Record<string, unknown>;
      for (const [prof, val] of Object.entries(overridesMap)) {
        if (!prof.trim()) {
          return NextResponse.json({ error: "subagentOverrides keys must be non-empty strings" }, { status: 400 });
        }
        if (val !== null && (typeof val !== "object" || Array.isArray(val))) {
          return NextResponse.json({ error: `subagentOverrides[${prof}] must be an object or null` }, { status: 400 });
        }
        if (val) {
          const item = val as Record<string, unknown>;
          if (item.model !== undefined && item.model !== null && (
            typeof item.model !== "string" || !item.model.trim()
          )) {
            return NextResponse.json({ error: `subagentOverrides[${prof}].model must be null or a non-empty string` }, { status: 400 });
          }
          if (item.thinking !== undefined && item.thinking !== null && (
            typeof item.thinking !== "string" || !item.thinking.trim()
          )) {
            return NextResponse.json({ error: `subagentOverrides[${prof}].thinking must be null or a non-empty string` }, { status: 400 });
          }
        }
      }
    }

    let settings = readSubagentSettings();
    if (body.enabled !== undefined) settings = writeBuiltInSubagentsEnabled(body.enabled);
    if (body.maxConcurrent !== undefined) settings = writeSubagentMaxConcurrent(body.maxConcurrent);
    if (body.subagentModel !== undefined) settings = writeSubagentModelOverride(body.subagentModel as string | null);
    if (body.profileOverride !== undefined) {
      const p = body.profileOverride as { profile: string; model?: string | null; thinking?: string | null };
      settings = writeSubagentProfileOverride(p.profile, {
        model: p.model,
        thinking: p.thinking,
      });
    }
    if (body.subagentOverrides !== undefined) {
      settings = writeSubagentOverrides(body.subagentOverrides as Record<string, SubagentOverride | null>);
    }

    return NextResponse.json({
      enabled: settings.builtInEnabled,
      maxConcurrent: settings.maxConcurrent,
      subagentModel: settings.subagentModel,
      subagentOverrides: settings.subagentOverrides,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
