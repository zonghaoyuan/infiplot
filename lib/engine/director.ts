import { chat } from "@infiplot/ai-client";
import type {
  Character,
  EngineConfig,
  InsertBeatPartial,
  ProviderConfig,
  Scene,
  Session,
  StoryState,
  StoryStatePatch,
} from "@infiplot/types";
import type { CharacterCard } from "./agents/characterDesigner";
import {
  designCharacterCard,
  provisionCharacterVoice,
  provisionVoiceForName,
  renderCharacterPortrait,
} from "./agents/characterDesigner";
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
//      ├─ CharacterCard LLM × N        (parallel per new char — TEXT only)
//      ├─ Cinematographer LLM          (parallel with the cards)
//      │
//      └─ wait for cards + cinema
//      │
//      ├─ entry-beat portraits   ──┐  (block the Painter — its refs)
//      ▼                           │
//    Painter — generateImage       │  (overlapped, NOT on the paint path):
//      with referenceImages        ├─ non-entry-beat portraits
//      │                           └─ ALL voice provisioning + orphan voices
//      ▼
//    await the overlapped work, fold into the registry
//      │
//      ▼
//    return { scene, sceneImageUrl, characters, storyState }
//
//  Two deliberate decouplings unlock the parallelism:
//   1. The Cinematographer only POSITIONS named characters, so it needs no
//      visualDescription and runs alongside the card LLMs.
//   2. The Painter only needs visualDescription TEXT (all on-stage) + the
//      entry-beat characters' PORTRAITS (its referenceImages). Voices are
//      never needed to paint, and non-entry portraits are never referenced —
//      so both overlap the (longest) paint call instead of blocking it.
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

// Merge the Writer's volatile story-memory patch onto the carried StoryState.
// The stable spine (logline/genreTags/protagonist/castNotes) is preserved;
// only the volatile fields the Writer is allowed to rewrite are overwritten,
// and only when the patch actually provided them. A missing carried state
// (legacy session from before the Architect existed) degrades to an empty
// spine rather than throwing.
function applyStoryStatePatch(
  base: StoryState | undefined,
  patch: StoryStatePatch | undefined,
): StoryState {
  const start: StoryState =
    base ?? { logline: "", genreTags: "", protagonist: "", synopsis: "" };
  if (!patch) return start;
  return {
    ...start,
    synopsis: patch.synopsis ?? start.synopsis,
    openThreads: patch.openThreads ?? start.openThreads,
    relationships: patch.relationships ?? start.relationships,
    nextHook: patch.nextHook ?? start.nextHook,
  };
}

export type SceneResult = {
  scene: Scene;
  sceneImageUrl: string;
  characters: Character[];
  storyState: StoryState;
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

  // ── Stage 2 — character cards (LLM) ∥ Cinematographer ──────────────────
  // Both are cheap LLM calls and neither needs the other's output, so they
  // run concurrently. The cards give us each new character's visualDescription
  // TEXT; portraits + voices are deferred to Stage 3 so they can overlap the
  // paint instead of blocking it.
  const tParallel = Date.now();

  const cardPromises = newCharNames.map((name) =>
    designCharacterCard(config, session, name).catch((err): CharacterCard => {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[directScene] designCharacterCard(${name}) failed: ${msg}`);
      // Last-resort fallback: a name + generic voice card so the speaker isn't
      // unknown. No visualDescription → no portrait is attempted for them.
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

  const [cards, cinemaOut] = await Promise.all([
    Promise.all(cardPromises),
    cinemaPromise,
  ]);
  tlog("[directScene] CharacterCards+Cinematographer parallel", tParallel);

  // Working registry: existing characters + new cards. visualDescription text
  // is present now; portraits + voices fill in over the next two phases.
  let characters = mergeCharacters(
    session.characters,
    cards.map((c) => ({
      name: c.name,
      voiceDescription: c.voiceDescription,
      visualDescription: c.visualDescription,
    })),
  );

  // ── Stage 3 — portraits + voices, scheduled around the Painter ─────────
  const tProvision = Date.now();

  // Entry-beat character names: the ONLY portraits the Painter references
  // (collectReferenceImages slots in the entry beat's speaker + activeChars).
  const entryNames = new Set<string>();
  if (entryBeat?.speaker && !isPovName(entryBeat.speaker)) {
    entryNames.add(entryBeat.speaker);
  }
  for (const c of entryBeatActive) {
    if (!isPovName(c.name)) entryNames.add(c.name);
  }

  type NamedPortrait = {
    name: string;
    basePortraitUrl?: string;
    basePortraitUuid?: string;
  };
  // Kick off portrait gen for every NEW char that has a visualDescription.
  // Entry-beat portraits block the Painter; the rest overlap it.
  const entryPortraitPromises: Promise<NamedPortrait>[] = [];
  const restPortraitPromises: Promise<NamedPortrait>[] = [];
  for (const card of cards) {
    const vd = card.visualDescription;
    if (!vd) continue;
    const p = renderCharacterPortrait(
      config,
      card.name,
      vd,
      session.styleGuide,
    ).then((res): NamedPortrait => ({ name: card.name, ...res }));
    (entryNames.has(card.name) ? entryPortraitPromises : restPortraitPromises).push(p);
  }

  // Kick off voice provisioning for every NEW char (never on the paint path).
  const voicePromises = cards.map((card) =>
    provisionCharacterVoice(config, card.voiceDescription, card.name).then(
      (voice): Character => ({
        name: card.name,
        voiceDescription: card.voiceDescription,
        voice,
      }),
    ),
  );

  // Edge case: a speaker the Writer referenced without listing in any beat's
  // activeCharacters. collectActiveCharacterNames already includes speakers,
  // so this is a rare defensive net. Provision a voice only (never on-screen).
  const speakerNames = new Set(
    writerOut.beats.map((b) => b.speaker).filter((n): n is string => Boolean(n)),
  );
  const orphanSpeakers = [...speakerNames].filter(
    // Pattern B: "你" (player) is a valid speaker but never gets a Character
    // record — TTS is intentionally skipped on the client.
    (n) =>
      !isPovName(n) &&
      !characters.some((c) => c.name === n) &&
      !cards.some((c) => c.name === n),
  );
  const orphanPromises = orphanSpeakers.map((n) =>
    provisionVoiceForName(config, session, n),
  );

  // Block the Painter ONLY on entry-beat portraits (its referenceImages).
  const entryPortraits = await Promise.all(entryPortraitPromises);
  characters = mergeCharacters(
    characters,
    entryPortraits.map((p) => ({
      name: p.name,
      voiceDescription: "", // preserved from the card by mergeCharacters
      basePortraitUrl: p.basePortraitUrl,
      basePortraitUuid: p.basePortraitUuid,
    })),
  );
  tlog("[directScene] entry-beat portraits", tProvision);

  // ── Stage 4 — Painter (depends on cinemaOut + on-stage visual cards +
  // entry portraits). On-stage = everyone named in any beat, so the archetype
  // block covers anyone the player might encounter in this scene.
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

  // Fold in the work that overlapped the paint: remaining portraits, all
  // voices, and any orphan-speaker voices. Awaited before returning so the
  // session the client persists is fully provisioned for later scenes.
  const tOverlap = Date.now();
  const [restPortraits, voicedChars, orphanChars] = await Promise.all([
    Promise.all(restPortraitPromises),
    Promise.all(voicePromises),
    Promise.all(orphanPromises),
  ]);
  characters = mergeCharacters(
    characters,
    restPortraits.map((p) => ({
      name: p.name,
      voiceDescription: "",
      basePortraitUrl: p.basePortraitUrl,
      basePortraitUuid: p.basePortraitUuid,
    })),
  );
  characters = mergeCharacters(characters, voicedChars);
  if (orphanChars.length > 0) {
    characters = mergeCharacters(characters, orphanChars);
  }
  tlog("[directScene] overlapped portraits+voices", tOverlap);

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

  // Merge the Writer's volatile memory rewrite onto the carried bible so the
  // throughline survives the next scene cut (orchestrator returns it; the
  // client persists it back into the session).
  const storyState = applyStoryStatePatch(
    session.storyState,
    writerOut.storyStatePatch,
  );

  tlog("[directScene] TOTAL", tTotal);

  return { scene, sceneImageUrl: painted.imageUrl, characters, storyState };
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
    { temperature: 0.9, responseFormat: "json_object", tag: "insert-beat" },
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
