import { requestScene } from "@infiplot/engine";
import type { Character, SceneRequest, SceneStreamEvent } from "@infiplot/types";
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

// SSE formatting helper: encodes event as `event: type\ndata: {...}\n\n`
function formatSSE(event: SceneStreamEvent | { type: "done" | "error"; [k: string]: unknown }): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
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

  const acceptsSSE = req.headers.get("accept")?.includes("text/event-stream");

  try {
    const official = loadEngineConfig();
    const base = body.byo ? buildByoEngineConfig(body.byo, official) : official;
    const config = body.clientTts === true ? { ...base, tts: undefined } : base;

    if (!acceptsSSE) {
      // Degrade path: no emit, await full result, return JSON.
      const result = await requestScene(config, body);
      const knownNames = new Set(
        (body.session.characters ?? []).map((c) => c.name),
      );
      return NextResponse.json({
        ...result,
        characters: stripKnownVoices(result.characters, knownNames),
      });
    }

    // SSE path: stream progressive events + done.
    const encoder = new TextEncoder();
    const knownNames = new Set(
      (body.session.characters ?? []).map((c) => c.name),
    );

    const stream = new ReadableStream({
      async start(controller) {
        try {
          const result = await requestScene(config, body, (event) => {
            controller.enqueue(encoder.encode(formatSSE(event)));
          });
          // Final 'done' event with full result (voice-stripped).
          controller.enqueue(
            encoder.encode(
              formatSSE({
                type: "done",
                result: {
                  ...result,
                  characters: stripKnownVoices(result.characters, knownNames),
                },
              }),
            ),
          );
          controller.close();
        } catch (err) {
          const message = err instanceof Error ? err.message : "Unknown error";
          controller.enqueue(
            encoder.encode(formatSSE({ type: "error", error: message })),
          );
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    const status = message.includes("Invalid BYO") || message.includes("Missing BYO") ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
