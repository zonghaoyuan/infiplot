import { requestScene } from "@infiplot/engine";
import type { Character, SceneRequest } from "@infiplot/types";
import { NextResponse } from "next/server";
import { loadEngineConfig } from "@/lib/config";
import { requireUser } from "@/lib/supabase/guard";

function stripKnownVoices(
  characters: Character[],
  knownNames: Set<string>,
): Character[] {
  return characters.map((c) =>
    knownNames.has(c.name) ? { ...c, voice: undefined } : c,
  );
}

export const runtime = "nodejs";

export async function POST(req: Request) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;

  let body: SceneRequest;
  try {
    body = (await req.json()) as SceneRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.session) {
    return NextResponse.json({ error: "session is required" }, { status: 400 });
  }

  try {
    const base = loadEngineConfig();
    // See StartRequest.clientTts — BYO clients synth in-browser, so drop server TTS.
    const config = body.clientTts === true ? { ...base, tts: undefined } : base;
    const result = await requestScene(config, body);
    const knownNames = new Set(
      (body.session.characters ?? []).map((c) => c.name),
    );
    return NextResponse.json({
      ...result,
      characters: stripKnownVoices(result.characters, knownNames),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
