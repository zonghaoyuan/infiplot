import { requestScene } from "@infiplot/engine";
import type { Character, SceneRequest } from "@infiplot/types";
import { NextResponse } from "next/server";
import { loadEngineConfig, buildByoEngineConfig } from "@/lib/config";

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
    const official = loadEngineConfig();
    // BYOK: if user provided LLM keys, build config from them (with SSRF validation)
    const base = body.byo ? buildByoEngineConfig(body.byo, official) : official;
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
    const status = message.includes("Invalid BYO") || message.includes("Missing BYO") ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
