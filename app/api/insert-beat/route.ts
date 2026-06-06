import { requestInsertBeat } from "@infiplot/engine";
import type { InsertBeatRequest } from "@infiplot/types";
import { NextResponse } from "next/server";
import { loadEngineConfig } from "@/lib/config";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  let body: InsertBeatRequest;
  try {
    body = (await req.json()) as InsertBeatRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.session || !body.freeformAction) {
    return NextResponse.json(
      { error: "session and freeformAction are required" },
      { status: 400 },
    );
  }

  try {
    const base = loadEngineConfig();
    // See StartRequest.clientTts — BYO clients synth in-browser, so drop server TTS.
    const config = body.clientTts === true ? { ...base, tts: undefined } : base;
    const result = await requestInsertBeat(config, body);
    return NextResponse.json({
      ...result,
      characters: result.characters.map((c) => ({ ...c, voice: undefined })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
