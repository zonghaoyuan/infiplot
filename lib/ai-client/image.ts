import OpenAI, { toFile, type Uploadable } from "openai";
import type { Orientation, ProviderConfig, ProviderProtocol } from "@infiplot/types";
import { fetchWithRetry } from "./fetchWithRetry";
import { normalizeBaseUrl } from "./normalizeUrl";

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
   * `referenceImages` for visual continuity instead. Runware-only.
   */
  seedImage?: string;
  /**
   * Reference images (UUIDs, URLs, or base64) to condition generation on —
   * typically character portraits + the prior scene image. Runware caps at 4;
   * we silently truncate beyond that. On the native OpenAI path these are
   * fetched/decoded and sent to `images.edit`.
   */
  referenceImages?: string[];
  /** 0–1, FLUX needs ≥ 0.8 to actually have an effect. Runware-only. */
  strength?: number;
  /**
   * Output aspect, locked per session. "portrait" → 9:16 vertical for mobile;
   * default/"landscape" → 16:9 widescreen. Mapped to each provider's nearest
   * supported size: Runware 1024×1792, OpenAI-compatible REST 1024x1792,
   * native gpt-image 1024x1536.
   */
  orientation?: Orientation;
};

export type GenerateImageResult = {
  /**
   * Image the client can render directly. A Runware CDN URL on the Runware
   * path; a `data:<mime>;base64,...` URI on the native OpenAI path when GPT
   * image models return raw bytes instead of a hosted URL.
   */
  imageUrl: string;
  /**
   * Stable handle for cheap re-reference in later `referenceImages`. A real
   * Runware UUID on the Runware path; a synthetic UUID on other paths (those
   * re-reference via the URL/data-URL form instead).
   */
  imageUuid: string;
};

// Match the Runware host by parsed hostname (exact match or subdomain), not a
// bare substring — otherwise `notrunware.ai` or `api.runware.ai.evil.com` would
// misroute to the Runware protocol. Falls back to false on an unparseable URL.
function isRunwareHost(baseUrl: string): boolean {
  try {
    const host = new URL(baseUrl).hostname.toLowerCase();
    return host === "runware.ai" || host.endsWith(".runware.ai");
  } catch {
    return false;
  }
}

// Image roles support more protocols than text/vision. When IMAGE_PROVIDER is
// unset we keep the historical URL-based inference so existing deployments
// (Runware, or an OpenAI-compatible gateway) behave exactly as before.
function inferImageProtocol(config: ProviderConfig): ProviderProtocol {
  const isOpenAiCompat =
    !isRunwareHost(config.baseUrl) || config.model === "image-2-vip";
  return isOpenAiCompat ? "openai_compatible" : "runware";
}

function resolveImageProtocol(config: ProviderConfig): ProviderProtocol {
  return config.provider ?? inferImageProtocol(config);
}

// ──────────────────────────────────────────────────────────────────────
//  generateImage — text-to-image (default) or referenceImages-conditioned.
//  Returns both a renderable image URL and a re-reference handle (see
//  GenerateImageResult). Dispatches on the resolved wire protocol.
// ──────────────────────────────────────────────────────────────────────

export async function generateImage(
  config: ProviderConfig,
  prompt: string,
  options?: GenerateImageOptions,
): Promise<GenerateImageResult> {
  const protocol = resolveImageProtocol(config);
  switch (protocol) {
    case "openai":
      return generateImageOpenAi(config, prompt, options);
    case "runware":
      return generateImageRunware(config, prompt, options);
    case "openai_compatible":
    default:
      return generateImageOpenAiCompatible(config, prompt, options);
  }
}

// Native OpenAI (gpt-image) via the official OpenAI SDK. Unlike the compatible
// fetch path, this supports reference-image editing through `images.edit`.
// GPT image models return raw bytes, so we hand the client a data URI and
// synthesize a UUID; continuity references reuse the data URI rather than a
// provider UUID.
async function generateImageOpenAi(
  config: ProviderConfig,
  prompt: string,
  options?: GenerateImageOptions,
): Promise<GenerateImageResult> {
  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: normalizeBaseUrl(config.baseUrl, "openai"),
    maxRetries: 2,
    dangerouslyAllowBrowser: true,
  });
  const refs = (options?.referenceImages ?? []).slice(0, MAX_REFERENCE_IMAGES);
  const portrait = options?.orientation === "portrait";
  const size = portrait ? "1024x1536" : "1536x1024";

  const response =
    refs.length > 0
      ? await client.images.edit({
          model: config.model,
          prompt,
          image: await Promise.all(refs.map(referenceImageToUploadable)),
          n: 1,
          size,
        })
      : await client.images.generate({
          model: config.model,
          prompt,
          n: 1,
          size,
        });

  return imageResponseToResult(response);
}

async function referenceImageToUploadable(ref: string): Promise<Uploadable> {
  if (ref.startsWith("data:")) {
    const response = await fetch(ref);
    if (!response.ok) {
      throw new Error(`Failed to read data URL reference image.`);
    }
    const mediaType = response.headers.get("content-type") ?? "image/png";
    return toFile(response, `reference.${extensionFromMediaType(mediaType)}`, {
      type: mediaType,
    });
  }

  if (/^https?:\/\//i.test(ref)) {
    const response = await fetch(ref);
    if (!response.ok) {
      throw new Error(
        `Failed to fetch reference image ${ref}: HTTP ${response.status}`,
      );
    }
    const mediaType = response.headers.get("content-type") ?? "image/png";
    return toFile(response, filenameFromUrl(ref, mediaType), {
      type: mediaType,
    });
  }

  throw new Error(
    `Native OpenAI image editing requires reference image URLs or data URLs; got "${ref.slice(0, 32)}...".`,
  );
}

function imageResponseToResult(
  response: OpenAI.Images.ImagesResponse,
): GenerateImageResult {
  const data = response.data?.[0];
  const b64 = data?.b64_json;
  if (b64) {
    const format = response.output_format ?? "png";
    return {
      imageUrl: `data:image/${format};base64,${b64}`,
      imageUuid: crypto.randomUUID(),
    };
  }

  const imageUrl = data?.url;
  if (imageUrl) {
    return { imageUrl, imageUuid: crypto.randomUUID() };
  }

  throw new Error(`No image data in OpenAI response.`);
}

function filenameFromUrl(url: string, mediaType: string): string {
  try {
    const name = new URL(url).pathname.split("/").filter(Boolean).at(-1);
    if (name && /\.[a-z0-9]+$/i.test(name)) return name;
  } catch {
    // Fall back to the media type below.
  }
  return `reference.${extensionFromMediaType(mediaType)}`;
}

function extensionFromMediaType(mediaType: string): string {
  if (mediaType.includes("jpeg") || mediaType.includes("jpg")) return "jpg";
  if (mediaType.includes("webp")) return "webp";
  return "png";
}

// OpenAI-compatible REST route (GPTGod, DALL-E proxies, etc.). Basic
// text-to-image only — no reference images on this path; for editing/anchoring
// set IMAGE_PROVIDER=openai to take the native OpenAI path above.
async function generateImageOpenAiCompatible(
  config: ProviderConfig,
  prompt: string,
  options?: GenerateImageOptions,
): Promise<GenerateImageResult> {
  const base = normalizeBaseUrl(config.baseUrl, "openai_compatible");
  const endpoint = `${base}/images/generations`;
  console.log(
    `[ai-client] Calling OpenAI-compatible image generations at: ${endpoint} with model: ${config.model}`,
  );

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
      // Session-locked aspect (16:9 default, 9:16 portrait for mobile).
      size: options?.orientation === "portrait" ? "1024x1792" : "1792x1024",
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

// Runware task-array route — self-implemented to preserve the UUID/URL closed
// loop (the official @runware/ai-sdk-provider drops both).
async function generateImageRunware(
  config: ProviderConfig,
  prompt: string,
  options?: GenerateImageOptions,
): Promise<GenerateImageResult> {
  const url = normalizeBaseUrl(config.baseUrl, "runware");

  // Session-locked output aspect. Image models emit a FIXED pixel size; CSS
  // object-fit on the client adapts this frame to the exact device/window. Both
  // dimensions stay a multiple of 64 as FLUX requires.
  const portrait = options?.orientation === "portrait";

  const task: Record<string, unknown> = {
    taskType: "imageInference",
    taskUUID: crypto.randomUUID(),
    model: config.model,
    positivePrompt: prompt,
    width: portrait ? 1024 : 1792,
    height: portrait ? 1792 : 1024,
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
