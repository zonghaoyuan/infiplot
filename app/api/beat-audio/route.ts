import { requestBeatAudio } from "@infiplot/engine";
import type { BeatAudioRequest } from "@infiplot/types";
import { NextResponse } from "next/server";
import { loadEngineConfig } from "@/lib/config";

export const runtime = "nodejs";

export async function POST(req: Request) {
  let body: BeatAudioRequest;
  try {
    body = (await req.json()) as BeatAudioRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.beat?.id || !body.beat?.line || !body.voice?.referenceAudioBase64) {
    return NextResponse.json(
      { error: "beat.id, beat.line and voice.referenceAudioBase64 are required" },
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
