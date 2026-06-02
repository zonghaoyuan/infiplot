import { startSession } from "@infiplot/engine";
import type { StartRequest } from "@infiplot/types";
import { NextResponse } from "next/server";
import { loadEngineConfig } from "@/lib/config";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  let body: StartRequest;
  try {
    body = (await req.json()) as StartRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.worldSetting?.trim() || !body.styleGuide?.trim()) {
    return NextResponse.json(
      { error: "worldSetting and styleGuide are required" },
      { status: 400 },
    );
  }

  try {
    const config = loadEngineConfig();
    const result = await startSession(config, body);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
