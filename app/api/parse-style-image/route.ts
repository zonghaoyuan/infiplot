import { analyzeImageDataUrl } from "@infiplot/ai-client";
import type {
  ParseStyleImageRequest,
  ParseStyleImageResponse,
} from "@infiplot/types";
import { NextResponse } from "next/server";
import { loadEngineConfig } from "@/lib/config";
import { requireUser } from "@/lib/supabase/guard";

export const runtime = "nodejs";

// Same rationale as /api/vision: the client resizes to 512px max-dim webp
// (~30-80KB base64 typical) before upload, so 3 MB is generous headroom
// against malformed / abusive direct-API payloads.
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;

const STYLE_EXTRACTION_PROMPT = `You are a senior concept artist helping describe an image's visual style so that a text-to-image diffusion model (FLUX) can reproduce the same aesthetic on different subjects.

Look at the attached image and produce a single English style-prompt string that captures ONLY its visual style — NOT its subject matter. Focus on:
- Medium / technique (e.g., watercolor, oil painting, cel-shaded anime, 3D render, pixel art)
- Line work and rendering (sharp ink outlines, soft shading, painterly brushstrokes, flat colors)
- Color palette and lighting (pastel, saturated, monochrome, warm golden-hour, cool neon, high contrast)
- Mood and atmosphere (dreamy, melancholic, cinematic, nostalgic, gritty)
- Any recognizable artistic influence (Ghibli, Makoto Shinkai, ukiyo-e, vaporwave, cyberpunk anime, etc.)

Do NOT describe the characters, objects, or scene contents. Output exactly one JSON object:
{"stylePrompt": "<comma-separated English visual-style attributes, ~30-60 words>"}`;

export async function POST(req: Request) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;

  let body: ParseStyleImageRequest;
  try {
    body = (await req.json()) as ParseStyleImageRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (
    typeof body.imageDataUrl !== "string" ||
    !body.imageDataUrl.startsWith("data:image/")
  ) {
    return NextResponse.json(
      { error: "imageDataUrl must be a data:image/... base64 URL" },
      { status: 400 },
    );
  }
  if (body.imageDataUrl.length > MAX_IMAGE_BYTES) {
    return NextResponse.json(
      { error: `imageDataUrl exceeds ${MAX_IMAGE_BYTES} bytes` },
      { status: 413 },
    );
  }

  try {
    const config = loadEngineConfig();
    const raw = await analyzeImageDataUrl(
      config.vision,
      body.imageDataUrl,
      STYLE_EXTRACTION_PROMPT,
    );

    let parsed: { stylePrompt?: string };
    try {
      parsed = JSON.parse(raw);
    } catch {
      // Fall back: treat the raw response as the style prompt directly.
      parsed = { stylePrompt: raw };
    }
    const stylePrompt = (parsed.stylePrompt ?? "").trim();
    if (!stylePrompt) {
      return NextResponse.json(
        { error: "Vision model returned an empty stylePrompt" },
        { status: 502 },
      );
    }

    const payload: ParseStyleImageResponse = { stylePrompt };
    return NextResponse.json(payload);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
