import { chat } from "@yume/ai-client";
import type {
  Character,
  EngineConfig,
  InsertBeatPartial,
  ProviderConfig,
  Scene,
  Session,
} from "@yume/types";
import { designCharacter, provisionVoiceForName } from "./agents/characterDesigner";
import { runCinematographer } from "./agents/cinematographer";
import { runPainter } from "./agents/painter";
import {
  collectActiveCharacterNames,
  isPovName,
  normalizeSpeakerName,
  POV_DISPLAY_NAME,
  runWriter,
} from "./agents/writer";
import { parseJsonLoose } from "./jsonParser";
import { INSERT_BEAT_SYSTEM, buildInsertBeatUserMessage } from "./prompts";

// ══════════════════════════════════════════════════════════════════════
//  director.ts — multi-agent orchestrator for one full Scene generation.
//
//  Critical path (per Scene call):
//
//    Writer LLM (~3s, serial)
//      │
//      ├─ CharacterDesigner LLM × N    (parallel per new char)
//      │     │
//      │     ├─ portrait gen (Runware returns URL + UUID in one call)
//      │     └─ voice provisioning     (parallel within agent)
//      │
//      ├─ Cinematographer LLM          (parallel with all of the above)
//      │
//      └─ wait for all parallel branches
//      │
//      ▼
//    Painter — generateImage with referenceImages (UUID/URL refs only;
//              no base64 to upload, since outputType=URL gives both back)
//      │
//      ▼
//    return { scene, sceneImageUrl, characters }
//
//  The Cinematographer intentionally does NOT depend on CharacterDesigner
//  output — it only positions named characters in the frame, not their
//  appearance. This unlocks the parallelism that makes the full pipeline
//  ~9-12s instead of ~15-18s serial.
// ══════════════════════════════════════════════════════════════════════

function newSceneId(): string {
  return `scene_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

function tlog(label: string, t0: number): void {
  console.log(`${label}: ${Date.now() - t0}ms`);
}

// Merge a freshly-designed Character into a registry, preserving any
// previously-set voice/portrait that the new design didn't fill in (so
// re-designing a known character can't silently drop their voice or wipe
// out an already-generated portrait UUID). Match by name.
export function mergeCharacters(
  existing: Character[],
  updates: Character[],
): Character[] {
  if (updates.length === 0) return existing;
  const byName = new Map(existing.map((c) => [c.name, c]));
  for (const u of updates) {
    const prev = byName.get(u.name);
    if (!prev) {
      byName.set(u.name, u);
      continue;
    }
    // Preserve any prior provisioned resource that the new design omitted.
    byName.set(u.name, {
      ...u,
      voice: u.voice ?? prev.voice,
      visualDescription: u.visualDescription ?? prev.visualDescription,
      basePortraitUrl: u.basePortraitUrl ?? prev.basePortraitUrl,
      basePortraitUuid: u.basePortraitUuid ?? prev.basePortraitUuid,
      voiceDescription: u.voiceDescription || prev.voiceDescription,
    });
  }
  return Array.from(byName.values());
}

// Pick a reference to the prior scene image when sceneKey matches a prior
// scene — used by the Painter as one of the `referenceImages` (NOT as a
// seedImage, because FLUX.2 [klein] 9B KV does not support seedImage).
//
// Prefer URL over UUID for the same reason painter.collectReferenceImages
// does: the UUID returned by `imageInference` isn't always recognized by
// Runware's `referenceImages` pipeline, surfacing as `failedToTransferImage`.
// The URL is Runware's own CDN link — they can always fetch it. UUID is kept
// as a backstop. Returns undefined when no prior scene shares the sceneKey.
function pickPriorSceneReference(
  session: Session,
  currentSceneKey: string | undefined,
): { priorSceneReference?: string; priorSceneKey?: string } {
  if (!currentSceneKey) return {};
  for (let i = session.history.length - 1; i >= 0; i--) {
    const prior = session.history[i]!.scene;
    if (prior.sceneKey === currentSceneKey) {
      const ref = prior.imageUrl ?? prior.imageUuid;
      if (ref) {
        return { priorSceneReference: ref, priorSceneKey: prior.sceneKey };
      }
    }
  }
  return {};
}

export type SceneResult = {
  scene: Scene;
  sceneImageUrl: string;
  characters: Character[];
};

// ──────────────────────────────────────────────────────────────────────
//  directScene — the multi-agent pipeline. Used by orchestrator's
//  startSession and requestScene.
// ──────────────────────────────────────────────────────────────────────

export async function directScene(
  config: EngineConfig,
  session: Session,
): Promise<SceneResult> {
  const tTotal = Date.now();

  // Stage 1 — Writer (serial; everything downstream needs sceneSummary +
  // beats[] to know who's on stage and what to compose around).
  const tWriter = Date.now();
  const writerOut = await runWriter(config.text, session);
  tlog("[directScene] Writer", tWriter);

  // Identify NEW characters introduced by this scene that need to be
  // designed (LLM + portrait + voice). Existing characters in the registry
  // are skipped — their cards / portraits / voices persist across scenes.
  const allActiveNames = collectActiveCharacterNames(writerOut.beats);
  const newCharNames = allActiveNames.filter(
    (n) => !session.characters.some((c) => c.name === n),
  );

  // Find the entry beat for the Cinematographer (which characters are
  // on-screen in the establishing shot).
  const entryBeat = writerOut.beats.find((b) => b.id === writerOut.entryBeatId);
  const entryBeatActive = entryBeat?.activeCharacters ?? [];

  // For sceneKey-based visual continuity, look up the prior matching scene's
  // image to slot into Painter's referenceImages (max 4 of which include
  // character portraits too).
  const { priorSceneReference, priorSceneKey } = pickPriorSceneReference(
    session,
    writerOut.sceneKey,
  );

  // Stage 2 — parallel: CharacterDesigner(s) and Cinematographer.
  // Cinematographer doesn't need character visualDescriptions (those are
  // appended at Painter stage), so it runs concurrently with chardesign.
  const tParallel = Date.now();

  const designPromises = newCharNames.map((name) =>
    designCharacter(config, session, name).catch((err): Character => {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[directScene] designCharacter(${name}) failed: ${msg}`);
      // Last-resort fallback: register with name only so the speaker isn't
      // unknown. Caller may try voice provisioning later or skip.
      return {
        name,
        voiceDescription: `请根据角色名「${name}」推断其性别、年龄与气质。所属世界观：${session.worldSetting}`,
      };
    }),
  );

  const cinemaPromise = runCinematographer(config.text, {
    sceneSummary: writerOut.sceneSummary,
    styleGuide: session.styleGuide,
    entryBeatActive,
    entryBeatSpeaker: entryBeat?.speaker,
    priorSceneKey,
    currentSceneKey: writerOut.sceneKey,
  });

  const [designedChars, cinemaOut] = await Promise.all([
    Promise.all(designPromises),
    cinemaPromise,
  ]);
  tlog("[directScene] CharacterDesigner+Cinematographer parallel", tParallel);

  // Merge new chars into a working registry that we'll pass to the Painter.
  const characters = mergeCharacters(session.characters, designedChars);

  // Edge case: a speaker referenced by the Writer might not have been in
  // `activeCharacters` of any beat (LLM oversight), so they got skipped by
  // newCharNames. Catch them here and at least provision a voice so the
  // beat-audio path doesn't render silent. No portrait — they weren't
  // visible in the scene, so visual consistency doesn't matter for them.
  const speakerNames = new Set(
    writerOut.beats.map((b) => b.speaker).filter((n): n is string => Boolean(n)),
  );
  const orphanSpeakers = [...speakerNames].filter(
    // Pattern B: "你" (player) is a valid speaker but never gets a Character
    // record — TTS is intentionally skipped on the client. Filter POV out so
    // provisionVoiceForName isn't accidentally invoked for the player.
    (n) => !isPovName(n) && !characters.some((c) => c.name === n),
  );
  if (orphanSpeakers.length > 0) {
    const orphans = await Promise.all(
      orphanSpeakers.map((n) => provisionVoiceForName(config, session, n)),
    );
    const merged = mergeCharacters(characters, orphans);
    characters.splice(0, characters.length, ...merged);
  }

  // Stage 3 — Painter (depends on cinemaOut + characters).
  // On-stage characters for THIS scene are the ones in any beat — pass them
  // all so the archetype block covers anyone the player might encounter.
  const onStageCharacters = characters.filter((c) =>
    allActiveNames.includes(c.name),
  );

  const tPainter = Date.now();
  const painted = await runPainter(
    config,
    {
      integratedPrompt: cinemaOut.integratedPrompt,
      styleGuide: session.styleGuide,
      onStageCharacters,
      priorSceneImage: priorSceneReference,
    },
    entryBeat,
  );
  tlog("[directScene] Painter", tPainter);

  const scene: Scene = {
    id: newSceneId(),
    // scenePrompt is the cinematographer's English compositional output;
    // the Writer's sceneSummary stays in the session log via beats[]/
    // history. Keeping the original field name preserves compat with
    // anything that already reads scene.scenePrompt (e.g., insert-beat
    // user prompt).
    scenePrompt: cinemaOut.integratedPrompt,
    beats: writerOut.beats,
    entryBeatId: writerOut.entryBeatId,
    sceneKey: writerOut.sceneKey,
    imageUuid: painted.kind === "real" ? painted.imageUuid : undefined,
    imageUrl: painted.imageUrl,
  };

  tlog("[directScene] TOTAL", tTotal);

  return { scene, sceneImageUrl: painted.imageUrl, characters };
}

// ──────────────────────────────────────────────────────────────────────
//  directInsertBeat — single-agent path for vision-driven in-scene
//  exploration. Generates ONE transient beat with NO new image, NO new
//  characters. Multi-agent pipeline doesn't apply here (no rendering, no
//  character introduction allowed by the prompt).
// ──────────────────────────────────────────────────────────────────────

export async function directInsertBeat(
  config: ProviderConfig,
  session: Session,
  freeformAction: string,
): Promise<InsertBeatPartial> {
  const raw = await chat(
    config,
    [
      { role: "system", content: INSERT_BEAT_SYSTEM },
      {
        role: "user",
        content: buildInsertBeatUserMessage(session, freeformAction),
      },
    ],
    { temperature: 0.9, responseFormat: "json_object" },
  );

  const parsed = parseJsonLoose<InsertBeatPartial>(raw);

  const narration = parsed.narration?.trim() || undefined;
  const rawSpeaker = parsed.speaker?.trim() || undefined;
  // Pattern B (mirrors Writer): normalize POV variants → "你"; NPCs pass through.
  const speaker = rawSpeaker ? normalizeSpeakerName(rawSpeaker) : undefined;
  const line = parsed.line?.trim() || undefined;
  // lineDelivery is only meaningful for NPC speakers (TTS). For POV ("你")
  // TTS is intentionally skipped on the client, so lineDelivery is dropped.
  const lineDelivery =
    line && speaker !== POV_DISPLAY_NAME
      ? parsed.lineDelivery?.trim() || undefined
      : undefined;

  if (!narration && !speaker && !line) {
    return { narration: "（你停下脚步，环视片刻。）" };
  }
  return { narration, speaker, line, lineDelivery };
}
