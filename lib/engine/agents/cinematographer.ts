import { chat } from "@infiplot/ai-client";
import type { BeatActiveCharacter, ProviderConfig } from "@infiplot/types";
import { parseJsonLoose } from "../jsonParser";
import {
  CINEMATOGRAPHER_SYSTEM,
  buildCinematographerUserMessage,
} from "../prompts";

// ──────────────────────────────────────────────────────────────────────
//  Cinematographer agent — translates the Writer's narrative scene
//  summary into an English compositional prompt for FLUX.
//
//  Reads: sceneSummary + entry beat's activeCharacters (poses)
//         + prior sceneKey (for continuity hints)
//  Writes: { shotType, integratedPrompt }
//
//  Does NOT describe character APPEARANCE — that's appended at the
//  Painter stage from session.characters[].visualDescription. The
//  Cinematographer only positions named characters in the frame and
//  describes the environment + lighting + camera framing.
//
//  This separation lets the Cinematographer run IN PARALLEL with the
//  CharacterDesigner — neither needs the other's output. They both
//  feed independently into the Painter prompt.
// ──────────────────────────────────────────────────────────────────────

export type CinematographerOutput = {
  shotType: string;
  integratedPrompt: string;
};

type RawCinematographerOutput = {
  shotType?: string;
  integratedPrompt?: string;
};

export type CinematographerInput = {
  sceneSummary: string;
  styleGuide: string;
  entryBeatActive: BeatActiveCharacter[];
  /** Entry beat's speaker — drives the dynamic camera policy:
   *    NPC name → NPC looks toward camera (close-up)
   *    "你"     → medium shot, NPC listens
   *    undefined → wide establishing shot */
  entryBeatSpeaker?: string;
  priorSceneKey?: string;
  currentSceneKey?: string;
};

export async function runCinematographer(
  config: ProviderConfig,
  input: CinematographerInput,
): Promise<CinematographerOutput> {
  const raw = await chat(
    config,
    [
      { role: "system", content: CINEMATOGRAPHER_SYSTEM },
      {
        role: "user",
        content: buildCinematographerUserMessage(
          input.sceneSummary,
          input.styleGuide,
          input.entryBeatActive,
          input.entryBeatSpeaker,
          input.priorSceneKey,
          input.currentSceneKey,
        ),
      },
    ],
    { temperature: 0.6, responseFormat: "json_object" },
  );

  const parsed = parseJsonLoose<RawCinematographerOutput>(raw);

  // Fallback: if the LLM produced nothing usable, synthesize a minimal
  // integratedPrompt from the Writer's sceneSummary so the Painter has
  // SOMETHING to work with rather than blowing up the whole pipeline.
  const integratedPrompt =
    parsed.integratedPrompt?.trim() ||
    `A cinematic illustration depicting: ${input.sceneSummary}. Wide establishing shot, natural lighting, atmospheric mood.`;

  return {
    shotType: parsed.shotType?.trim() || "medium shot",
    integratedPrompt,
  };
}
