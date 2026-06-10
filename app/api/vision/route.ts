import { visionDecide } from "@infiplot/engine";
import type { VisionRequest } from "@infiplot/types";
import { NextResponse } from "next/server";
import { loadEngineConfig, buildByoEngineConfig } from "@/lib/config";

export const runtime = "nodejs";

// Browser annotator resizes to 768 wide → typically 200-800 KB base64.
// 3 MB caps abusive direct-API payloads (which would inflate upstream
// vision LLM costs) while leaving ~4x headroom for legitimate inputs.
const MAX_ANNOTATED_BYTES = 3 * 1024 * 1024;

export async function POST(req: Request) {
  let body: VisionRequest;
  try {
    body = (await req.json()) as VisionRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.session) {
    return NextResponse.json(
      { error: "session is required" },
      { status: 400 },
    );
  }
  if (
    typeof body.annotatedImageBase64 !== "string" ||
    body.annotatedImageBase64.length === 0
  ) {
    return NextResponse.json(
      { error: "annotatedImageBase64 must be a non-empty string" },
      { status: 400 },
    );
  }
  if (body.annotatedImageBase64.length > MAX_ANNOTATED_BYTES) {
    return NextResponse.json(
      { error: `annotatedImageBase64 exceeds ${MAX_ANNOTATED_BYTES} bytes` },
      { status: 413 },
    );
  }

  try {
    const official = loadEngineConfig();
    const config = body.byo ? buildByoEngineConfig(body.byo, official) : official;
    const result = await visionDecide(config, body);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    const status = message.includes("Invalid BYO") || message.includes("Missing BYO") ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
