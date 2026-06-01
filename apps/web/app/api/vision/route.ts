import { visionDecide } from "@yume/engine";
import type { VisionRequest } from "@yume/types";
import { NextResponse } from "next/server";
import { loadEngineConfig } from "@/lib/config";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  let body: VisionRequest;
  try {
    body = (await req.json()) as VisionRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.session || !body.prevImageUrl || !body.click) {
    return NextResponse.json(
      { error: "session, prevImageUrl, click are required" },
      { status: 400 },
    );
  }

  try {
    const config = loadEngineConfig();
    const result = await visionDecide(config, body);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
