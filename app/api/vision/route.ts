import { visionDecide } from "@infiplot/engine";
import type { VisionRequest } from "@infiplot/types";
import { NextResponse } from "next/server";
import { loadEngineConfig } from "@/lib/config";
import { requireUser } from "@/lib/supabase/guard";

export const runtime = "nodejs";

// Browser annotator resizes to 768 wide → typically 200-800 KB base64.
// 3 MB caps abusive direct-API payloads (which would inflate upstream
// vision LLM costs) while leaving ~4x headroom for legitimate inputs.
const MAX_ANNOTATED_BYTES = 3 * 1024 * 1024;

export async function POST(req: Request) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;

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
    const config = loadEngineConfig();
    const result = await visionDecide(config, body);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
