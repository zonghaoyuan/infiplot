import { generateImage } from "@infiplot/ai-client";
import type { GenerateImageOptions, GenerateImageResult } from "@infiplot/ai-client";
import type {
  Beat,
  Character,
  EngineConfig,
  Orientation,
  ProviderConfig,
} from "@infiplot/types";
import { mockImageDataUri } from "../mockImage";
import { buildPainterPrompt } from "../prompts";

// ──────────────────────────────────────────────────────────────────────
//  Painter — final image generation with multi-reference anchoring.
//
//  FLUX.2 [klein] 9B KV does NOT support seedImage (img2img). Instead,
//  visual continuity comes entirely from `referenceImages` (capped at 4),
//  which the KV-optimized variant accelerates ~2.5× via key-value caching
//  of reference latents.
//
//  References are slotted in priority order (max 4):
//    1. Prior scene image — when sceneKey matched a previous scene, this
//       anchors the same physical space (lighting/layout/style continuity)
//    2. Entry beat's speaker portrait — the NPC the player is talking with
//       (most visually prominent)
//    3. Other on-stage NPCs' portraits — secondary characters in the frame
//
//  References are sent as UUIDs (preferred — cheapest in transport) or URLs
//  (fallback — still cheaper than base64). Base64 fallback was removed when
//  generateImage switched to outputType=URL, which always returns both a UUID
//  and a URL so we never lack a cheap reference handle.
//
//  Failure handling — two-tier degradation:
//    A. referenceImages call           (preferred — full visual anchoring)
//    B. pure text-to-image fallback    (last resort if Runware refs API errors)
// ──────────────────────────────────────────────────────────────────────

const MAX_REFERENCE_IMAGES = 4;

export type PainterInput = {
  integratedPrompt: string;
  styleGuide: string;
  onStageCharacters: Character[];
  /**
   * Prior scene's Runware UUID or URL. When set (= sceneKey hit a prior
   * scene), it slots into referenceImages[0] for spatial continuity.
   * Capacity-wise this displaces ONE character portrait — slot is shared
   * with character refs, capped at 4 total per Runware spec.
   */
  priorSceneImage?: string;
  /**
   * User-uploaded style reference (data URL base64). When set, it takes the
   * highest-priority slot in referenceImages so the painting STYLE (brush /
   * color / mood) of the user's image is anchored across every scene this
   * session paints — even before any priorScene exists.
   */
  styleReferenceImage?: string;
  /**
   * Session-locked output aspect. Drives both the Painter prompt's framing
   * rules and the generated image's pixel dimensions. Default "landscape".
   */
  orientation?: Orientation;
};

// Pick the references we send to Runware as `referenceImages`. Priority:
//   slot 0: priorSceneImage (if any — sceneKey continuity)
//   slot 1: entry beat's speaker portrait (the NPC speaking to the player)
//   slot 2+: other on-stage NPCs from entry beat's activeCharacters
// Caps at 4 total. Returns the array exactly as it'll be sent — already
// truncated, already deduplicated.
export function collectReferenceImages(
  characters: Character[],
  entryBeat: Beat | undefined,
  priorSceneImage: string | undefined,
  styleReferenceImage?: string,
): string[] {
  const refs: string[] = [];
  const seen = new Set<string>();

  // Slot 0 — user-uploaded style reference image, if any. Goes first because
  // it anchors the whole-session painting STYLE (brush / color / mood) that
  // the user explicitly chose. priorScene continuity comes second; character
  // archetypes are partially covered by the prompt text anyway.
  if (styleReferenceImage) {
    refs.push(styleReferenceImage);
  }

  // Slot N — prior scene image for spatial continuity. Backdrop drift is the
  // next-most jarring discontinuity across same-sceneKey scenes; character
  // drift is partially masked by character archetype text in the prompt.
  if (priorSceneImage) {
    refs.push(priorSceneImage);
  }

  // Slot 1+ — character portraits, speaker-first.
  //
  // Prefer URL over UUID: Runware's `imageInference` returns a UUID, but that
  // UUID isn't always recognized by the `referenceImages` pipeline (the error
  // surfaces as `failedToTransferImage`). The URL is Runware's own CDN link —
  // they can always fetch it from their own infra. UUID is kept as a backstop
  // for any edge case where URL is missing (e.g., legacy session state).
  const speakerName = entryBeat?.speaker;
  if (speakerName) {
    const speaker = characters.find((c) => c.name === speakerName);
    const ref = speaker?.basePortraitUrl ?? speaker?.basePortraitUuid;
    if (ref && refs.length < MAX_REFERENCE_IMAGES) {
      refs.push(ref);
      seen.add(speakerName);
    }
  }

  for (const c of entryBeat?.activeCharacters ?? []) {
    if (refs.length >= MAX_REFERENCE_IMAGES) break;
    if (seen.has(c.name)) continue;
    const char = characters.find((x) => x.name === c.name);
    const ref = char?.basePortraitUrl ?? char?.basePortraitUuid;
    if (ref) {
      refs.push(ref);
      seen.add(c.name);
    }
  }

  return refs.slice(0, MAX_REFERENCE_IMAGES);
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function tryGenerate(
  config: ProviderConfig,
  prompt: string,
  options: GenerateImageOptions,
  label: string,
): Promise<GenerateImageResult | null> {
  try {
    return await generateImage(config, prompt, options);
  } catch (err) {
    console.warn(`[painter] ${label} failed: ${errMsg(err)}`);
    return null;
  }
}

// Hedged Tier-A: fire leg 1; if it hasn't settled after hedgeMs, race an
// identical leg 2 and take whichever finishes first. This rescues straggler
// paints (a single task stuck on a slow worker) without waiting out the
// provider's own gateway limit (Runware kills tasks at ~55s with a 504).
//
// Deliberately NOT retry-on-error: a leg that fails fast (429/503 queue
// saturation, 4xx) falls through to Tier B immediately — hedging into a
// saturated queue only adds load. Each leg runs with retries=0 so the hedge
// itself is the only retry layer (no retry×retry multiplication).
async function tryGenerateHedged(
  config: ProviderConfig,
  prompt: string,
  options: GenerateImageOptions,
  label: string,
  hedgeMs: number,
): Promise<GenerateImageResult | null> {
  type Settled =
    | { leg: 1 | 2; ok: GenerateImageResult }
    | { leg: 1 | 2; err: unknown };

  const t0 = Date.now();
  const controllers: (AbortController | undefined)[] = [undefined, undefined];
  const fire = (leg: 1 | 2): Promise<Settled> => {
    const ac = new AbortController();
    controllers[leg - 1] = ac;
    return generateImage(config, prompt, {
      ...options,
      retries: 0,
      signal: ac.signal,
    }).then(
      (ok) => ({ leg, ok }) as Settled,
      (err) => ({ leg, err }) as Settled,
    );
  };

  const leg1 = fire(1);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const hedgeTimer = new Promise<"hedge">((resolve) => {
    timer = setTimeout(() => resolve("hedge"), hedgeMs);
  });

  const first = await Promise.race([leg1, hedgeTimer]);
  if (first !== "hedge") {
    clearTimeout(timer);
    if ("ok" in first) return first.ok;
    console.warn(`[painter] ${label} failed: ${errMsg(first.err)}`);
    return null;
  }

  console.warn(
    `[painter] hedge fired: ${label} still pending after ${hedgeMs}ms`,
  );
  const leg2 = fire(2);

  let result = await Promise.race([leg1, leg2]);
  if ("err" in result) {
    // First settler failed — give the survivor its full chance.
    console.warn(
      `[painter] hedge leg${result.leg} failed: ${errMsg(result.err)}`,
    );
    result = await (result.leg === 1 ? leg2 : leg1);
  }

  if ("ok" in result) {
    const loserIdx = result.leg === 1 ? 1 : 0;
    controllers[loserIdx]?.abort();
    const loser = result.leg === 1 ? leg2 : leg1;
    loser.then(
      (s) => "err" in s && console.debug(`[painter] hedge loser leg${s.leg} aborted`),
      () => {},
    );
    console.log(
      `[painter] hedge won by leg${result.leg} in ${Date.now() - t0}ms`,
    );
    return result.ok;
  }
  console.warn(
    `[painter] ${label} failed (both hedge legs): ${errMsg(result.err)}`,
  );
  return null;
}

export type PainterResult =
  | { kind: "real"; imageUrl: string; imageUuid: string }
  | { kind: "mock"; imageUrl: string };

export async function runPainter(
  config: EngineConfig,
  input: PainterInput,
  entryBeat: Beat | undefined,
): Promise<PainterResult> {
  if (config.mockImage) {
    return { kind: "mock", imageUrl: await mockImageDataUri(input.orientation) };
  }

  const prompt = buildPainterPrompt(
    input.integratedPrompt,
    input.styleGuide,
    input.onStageCharacters,
    input.orientation,
  );

  const refs = collectReferenceImages(
    input.onStageCharacters,
    entryBeat,
    input.priorSceneImage,
    input.styleReferenceImage,
  );

  // Tier A — with referenceImages (priorSceneImage + character portraits).
  // FLUX.2 [klein] 9B KV's KV cache accelerates this multi-reference path
  // ~2.5× compared to the non-KV variant. When IMAGE_HEDGE_MS is configured,
  // the scene paint is hedged (see tryGenerateHedged); portraits are not.
  if (refs.length > 0) {
    const tierAOptions: GenerateImageOptions = {
      referenceImages: refs,
      orientation: input.orientation,
      timeoutMs: config.imageTimeoutMs,
    };
    const label = `referenceImages (${refs.length})`;
    const r =
      config.imageHedgeMs && config.imageHedgeMs > 0
        ? await tryGenerateHedged(
            config.image,
            prompt,
            tierAOptions,
            label,
            config.imageHedgeMs,
          )
        : await tryGenerate(config.image, prompt, tierAOptions, label);
    if (r) return { kind: "real", imageUrl: r.imageUrl, imageUuid: r.imageUuid };
  }

  // Tier B — pure text-to-image. Last resort, used when Tier A failed OR
  // there are no references to send (first scene with no characters yet).
  // Errors here propagate to the caller.
  const r = await generateImage(config.image, prompt, {
    orientation: input.orientation,
    timeoutMs: config.imageTimeoutMs,
  });
  return { kind: "real", imageUrl: r.imageUrl, imageUuid: r.imageUuid };
}
