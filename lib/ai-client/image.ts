import type { ProviderConfig } from "@infiplot/types";
import { fetchWithRetry } from "./fetchWithRetry";

// Runware uses its own task-array protocol (not OpenAI-compatible).
// POST <baseUrl> with [{ taskType: "imageInference", ... }]; errors come
// back as a 200 with `errors[]`, so we have to inspect the body either way.
//
// referenceImages accepts UUIDs, public URLs, or base64. UUID is cheapest
// in transport cost; URL is next; base64 last resort. The FLUX.2 [klein] 9B
// KV variant (runware:400@6) accelerates multi-reference inference ~2.5× via
// its KV cache for reference latents (cached only within one inference run,
// not persisted across calls — hence the need to keep stable UUIDs/URLs for
// later reuse).
//
// We request outputType=URL so Runware persists the image and returns a CDN
// link the client can render directly. The same response also carries the
// image UUID, so we never need a separate uploadImage round-trip to anchor
// future referenceImages.
const DEFAULT_IMG2IMG_STRENGTH = 0.85;
const MAX_REFERENCE_IMAGES = 4;

type RunwareImageResult = {
  imageURL?: string;
  imageUUID?: string;
};
type RunwareError = {
  code?: string;
  message?: string;
  parameter?: string;
};
type RunwareResponse = {
  data?: RunwareImageResult[];
  errors?: RunwareError[];
};

export type GenerateImageOptions = {
  /**
   * Reference image (UUID, public URL, or base64) for img2img. When set,
   * FLUX preserves the seed image's composition and applies `strength` to
   * deviate. NOTE: FLUX.2 [klein] 9B KV does NOT support seedImage — use
   * `referenceImages` for visual continuity instead.
   */
  seedImage?: string;
  /**
   * Reference images (UUIDs, URLs, or base64) to condition generation on —
   * typically character portraits + the prior scene image. Runware caps at 4;
   * we silently truncate beyond that.
   */
  referenceImages?: string[];
  /** 0–1, FLUX needs ≥ 0.8 to actually have an effect. */
  strength?: number;
};

export type GenerateImageResult = {
  /** Public CDN URL of the generated image (Runware-hosted). */
  imageUrl: string;
  /** Stable UUID for cheap re-reference in later `referenceImages`. */
  imageUuid: string;
};

// ──────────────────────────────────────────────────────────────────────
//  generateImage — text-to-image (default) or referenceImages-conditioned.
//  Returns both the public URL (for client display + future references)
//  and the UUID (cheapest reference form for subsequent calls).
// ──────────────────────────────────────────────────────────────────────

export async function generateImage(
  config: ProviderConfig,
  prompt: string,
  options?: GenerateImageOptions,
): Promise<GenerateImageResult> {
  const url = config.baseUrl.replace(/\/$/, "");

  // 1. OpenAI-compatible route (GPTGod, DALL-E, etc.)
  const isOpenAi = !url.includes("runware.ai") || config.model === "image-2-vip";
  if (isOpenAi) {
    const endpoint = url.endsWith("/images/generations") ? url : `${url}/images/generations`;
    console.log(`[ai-client] Calling OpenAI-compatible image generations at: ${endpoint} with model: ${config.model}`);
    
    const res = await fetchWithRetry(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        prompt: prompt,
        n: 1,
        size: "1792x1024", // Use horizontal size (16:9)
      }),
    });

    const text = await res.text();
    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`OpenAI Image API error ${res.status}: ${text.slice(0, 500)}`);
    }

    if (json.error) {
      throw new Error(`OpenAI Image API error: ${json.error.message || JSON.stringify(json.error)}`);
    }

    const data = json.data?.[0];
    const imageUrl = data?.url;
    if (!imageUrl) {
      throw new Error(`No image URL in OpenAI response: ${text.slice(0, 300)}`);
    }
    // Generate a mock UUID since OpenAI compatible endpoint doesn't have UUIDs
    const imageUuid = crypto.randomUUID();
    return { imageUrl, imageUuid };
  }

  // 2. Runware task-array route
  const task: Record<string, unknown> = {
    taskType: "imageInference",
    taskUUID: crypto.randomUUID(),
    model: config.model,
    positivePrompt: prompt,
    width: 1792,
    height: 1024,
    steps: 4,
    CFGScale: 3.5,
    numberResults: 1,
    outputType: "URL",
    outputFormat: "PNG",
    includeCost: false,
  };

  if (options?.seedImage) {
    task.seedImage = options.seedImage;
    task.strength = options.strength ?? DEFAULT_IMG2IMG_STRENGTH;
  }

  if (options?.referenceImages?.length) {
    task.referenceImages = options.referenceImages.slice(0, MAX_REFERENCE_IMAGES);
  }

  const res = await fetchWithRetry(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify([task]),
  });

  const text = await res.text();
  let json: RunwareResponse;
  try {
    json = JSON.parse(text) as RunwareResponse;
  } catch {
    throw new Error(`Image API error ${res.status}: ${text.slice(0, 500)}`);
  }

  if (json.errors?.length) {
    const e = json.errors[0]!;
    throw new Error(
      `Runware error [${e.code ?? "unknown"}]: ${e.message ?? "no message"}` +
        (e.parameter ? ` (parameter: ${e.parameter})` : ""),
    );
  }

  const result = json.data?.[0];
  const imageUrl = result?.imageURL;
  const imageUuid = result?.imageUUID;
  if (!imageUrl || !imageUuid) {
    throw new Error(`No image URL/UUID in Runware response: ${text.slice(0, 300)}`);
  }
  return { imageUrl, imageUuid };
}
