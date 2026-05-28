import { requestBeatAudio } from "@yume/engine";
import type { BeatAudioRequest } from "@yume/types";
import { NextResponse } from "next/server";
import { loadEngineConfig } from "@/lib/config";

export const runtime = "nodejs";
// The synth itself has a 15s per-call ceiling in the engine. 30s here just
// covers JSON parsing + outbound network buffer.
export const maxDuration = 30;

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
    return NextResponse.json(result);
  } catch (err) {
    // Engine already swallows synth errors and returns audio:null. Anything
    // that reaches here is config-level — surface so the client can log it.
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
