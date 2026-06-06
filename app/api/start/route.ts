import { startSession } from "@infiplot/engine";
import type { StartRequest } from "@infiplot/types";
import { NextResponse } from "next/server";
import { loadEngineConfig } from "@/lib/config";

export const runtime = "nodejs";
export const maxDuration = 60;

// Matches /api/vision and /api/parse-style-image — the user's resized 512px
// webp is ~30-80 KB; this caps pathological direct-API payloads (which would
// then ride along in every subsequent /api/scene request body via session).
const MAX_STYLE_REF_BYTES = 3 * 1024 * 1024;

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
  if (typeof body.styleReferenceImage === "string") {
    if (!body.styleReferenceImage.startsWith("data:image/")) {
      return NextResponse.json(
        { error: "styleReferenceImage must be a data:image/... base64 URL" },
        { status: 400 },
      );
    }
    if (body.styleReferenceImage.length > MAX_STYLE_REF_BYTES) {
      return NextResponse.json(
        { error: `styleReferenceImage exceeds ${MAX_STYLE_REF_BYTES} bytes` },
        { status: 413 },
      );
    }
  }

  try {
    const base = loadEngineConfig();
    // BYO key: the browser provisions + synths voices directly against Xiaomi
    // (key never reaches us), so strip server-side TTS so the engine skips all
    // provisioning + synth. See StartRequest.clientTts.
    const config = body.clientTts === true ? { ...base, tts: undefined } : base;
    const result = await startSession(config, body);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
