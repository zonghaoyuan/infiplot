import { generateImage } from "@yume/ai-client";
import type { GenerateImageOptions, GenerateImageResult } from "@yume/ai-client";
import type {
  Beat,
  Character,
  EngineConfig,
  ProviderConfig,
} from "@yume/types";
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
): string[] {
  const refs: string[] = [];
  const seen = new Set<string>();

  // Slot 0 — prior scene image for spatial continuity. Goes first because
  // backdrop drift is the most jarring discontinuity across same-sceneKey
  // scenes; character drift is partially masked by character archetype text
  // in the prompt anyway.
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

async function tryGenerate(
  config: ProviderConfig,
  prompt: string,
  options: GenerateImageOptions,
  label: string,
): Promise<GenerateImageResult | null> {
  try {
    return await generateImage(config, prompt, options);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[painter] ${label} failed: ${msg}`);
    return null;
  }
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
    return { kind: "mock", imageUrl: await mockImageDataUri() };
  }

  const prompt = buildPainterPrompt(
    input.integratedPrompt,
    input.styleGuide,
    input.onStageCharacters,
  );

  const refs = collectReferenceImages(
    input.onStageCharacters,
    entryBeat,
    input.priorSceneImage,
  );

  // Tier A — with referenceImages (priorSceneImage + character portraits).
  // FLUX.2 [klein] 9B KV's KV cache accelerates this multi-reference path
  // ~2.5× compared to the non-KV variant.
  if (refs.length > 0) {
    const r = await tryGenerate(
      config.image,
      prompt,
      { referenceImages: refs },
      `referenceImages (${refs.length})`,
    );
    if (r) return { kind: "real", imageUrl: r.imageUrl, imageUuid: r.imageUuid };
  }

  // Tier B — pure text-to-image. Last resort, used when Tier A failed OR
  // there are no references to send (first scene with no characters yet).
  // Errors here propagate to the caller.
  const r = await generateImage(config.image, prompt);
  return { kind: "real", imageUrl: r.imageUrl, imageUuid: r.imageUuid };
}
