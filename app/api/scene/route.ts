import { requestScene } from "@infiplot/engine";
import type { Character, SceneRequest, SceneStreamEvent } from "@infiplot/types";
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

function formatSSE(event: SceneStreamEvent | { type: string; [k: string]: unknown }): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
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

  const acceptsSSE = req.headers.get("accept")?.includes("text/event-stream");

  try {
    const base = loadEngineConfig();
    const config = body.clientTts === true ? { ...base, tts: undefined } : base;

    if (!acceptsSSE) {
      const result = await requestScene(config, body);
      const knownNames = new Set(
        (body.session.characters ?? []).map((c) => c.name),
      );
      return NextResponse.json({
        ...result,
        characters: stripKnownVoices(result.characters, knownNames),
      });
    }

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
          controller.enqueue(
            encoder.encode(
              formatSSE({
                type: "done",
                response: {
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
            encoder.encode(formatSSE({ type: "error", message })),
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
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
