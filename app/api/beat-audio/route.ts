import { requestBeatAudio } from "@infiplot/engine";
import type { BeatAudioRequest } from "@infiplot/types";
import { NextResponse } from "next/server";
import { loadEngineConfig } from "@/lib/config";
import { requireUser } from "@/lib/supabase/guard";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;

  let body: BeatAudioRequest;
  try {
    body = (await req.json()) as BeatAudioRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Accept either provider's voice shape — xiaomi carries referenceAudioBase64,
  // stepfun carries voiceId. We only check the discriminator + the line text;
  // shape-specific validation lives in each provider's synth function.
  const VALID_TTS_PROVIDERS = ["xiaomi", "stepfun"];
  if (
    !body.beat?.id ||
    !body.beat?.line ||
    !body.voice?.provider ||
    !VALID_TTS_PROVIDERS.includes(body.voice.provider)
  ) {
    return NextResponse.json(
      { error: "beat.id, beat.line and voice.provider (xiaomi|stepfun) are required" },
      { status: 400 },
    );
  }

  try {
    const config = loadEngineConfig();
    const result = await requestBeatAudio(config, body);
    if (!result.audio) return new Response(null, { status: 204 });
    const binary = Buffer.from(result.audio.base64, "base64");
    return new Response(binary, {
      headers: { "Content-Type": result.audio.mime },
    });
  } catch (err) {
    // Engine already swallows synth errors and returns audio:null. Anything
    // that reaches here is config-level — surface so the client can log it.
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
