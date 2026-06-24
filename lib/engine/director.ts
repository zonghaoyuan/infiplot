import { chat } from "@infiplot/ai-client";
import { coerceOrientation } from "@infiplot/types";
import type {
  Beat,
  BeatChoice,
  Character,
  CharacterIntent,
  EngineConfig,
  InsertBeatMulti,
  InsertBeatPartial,
  ProviderConfig,
  Scene,
  SceneStreamEvent,
  Session,
  StoryState,
  StoryStatePatch,
  WriterScenePlan,
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
import type { WriterBeatsOutput } from "./agents/writer";
import {
  coercePlanFromRaw,
  isPovName,
  normalizeSpeakerName,
  POV_DISPLAY_NAME,
  runWriterStream,
} from "./agents/writer";
import { routeTaggedStream } from "./stream";
import { splitProseToBeats } from "./stream/proseSplitter";
import { parseJsonLoose } from "./jsonParser";
import { INSERT_BEAT_SYSTEM, buildInsertBeatUserMessage } from "./prompts";

// ══════════════════════════════════════════════════════════════════════
//  director.ts — multi-agent orchestrator for one full Scene generation.
//
//  Critical path (per Scene call):
//
//    Writer PHASE A — plan LLM (scene skeleton only, serial)
//      │
//      ├──────────────────────────┬───────────────────────────────────────┐
//      ▼                           ▼                                       │
//    Writer PHASE B            image pipeline (concurrent):                 │
//    beats LLM                   CharacterCard LLM × N ∥ Cinematographer    │
//    (full dialogue,             → entry-beat portraits (block Painter)     │
//     overlapped)                → Painter (generateImage w/ refs)          │
//      │                         → await overlapped: rest portraits+voices  │
//      └──────────────────────────► await Phase B ◄────────────────────────┘
//      ▼
//    assemble Scene → { scene, sceneImageUrl, characters, storyState }
//
//  Why split the Writer (the latency win): the image pipeline only needs the
//  scene SUMMARY + entry roster + cast (Phase A) — NOT the dialogue (Phase B).
//  Writing beats used to sit serially in FRONT of the image; now it overlaps
//  it, so the floor is max(beats, image) instead of beats + image.
//
//  The decouplings that unlock the rest of the parallelism:
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
      // Paradigm D: preserve persona fields when later designs omit them
      // (same logic as portrait/voice preservation).
      persona: u.persona ?? prev.persona,
      personalityTraits: u.personalityTraits ?? prev.personalityTraits,
      speakingStyle: u.speakingStyle ?? prev.speakingStyle,
      sampleDialogue: u.sampleDialogue ?? prev.sampleDialogue,
      relationshipToPlayer: u.relationshipToPlayer ?? prev.relationshipToPlayer,
      secrets: u.secrets ?? prev.secrets,
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

// Absolute-worst-case plan when the stream produced no usable <plan> at all
// (StreamRouter degraded with no extractable plan). Keeps the pipeline alive.
function minimalFallbackPlan(): WriterScenePlan {
  return {
    sceneSummary: "未指定场景概要",
    sceneKey: undefined,
    entryBeatId: "b1",
    cast: [],
    entryActiveCharacters: [],
    entrySpeaker: undefined,
  };
}

// ──────────────────────────────────────────────────────────────────────
//  directScene — the multi-agent pipeline. Used by orchestrator's
//  startSession and requestScene.
// ──────────────────────────────────────────────────────────────────────

export async function directScene(
  config: EngineConfig,
  session: Session,
  emit?: (event: SceneStreamEvent) => void,
): Promise<SceneResult> {
  const tTotal = Date.now();

  // ══════════════════════════════════════════════════════════════════════
  //  Paradigm D — single Writer stream + StreamRouter dispatch
  //
  //  One LLM call produces <plan> → <story> → <choices>. StreamRouter
  //  cuts the tags; </plan> closure resolves the plan deferred, unlocking
  //  the downstream image pipeline IN PARALLEL with the still-streaming
  //  <story>. Prose is split into Beat[] after routing completes.
  // ══════════════════════════════════════════════════════════════════════

  // ── Step 1 — kick off the Writer stream + routing ─────────────────
  const tStream = Date.now();
  const writerResult = runWriterStream(config.text, session);

  // Deferred that settles when onPlan fires (or when routing completes
  // without a plan — degraded fallback).
  let planSettled = false;
  let resolvePlan!: (p: WriterScenePlan) => void;
  const planPromise = new Promise<WriterScenePlan>((res) => {
    resolvePlan = res;
  });

  // Closure-captured coerced plan so onStoryComplete can split+emit beats
  // DURING streaming (before painter finishes → text-first progressive play).
  let coercedPlanRef: WriterScenePlan | undefined;
  let earlyBeatsOut: WriterBeatsOutput | undefined;
  // Opening-scene story bible from the Writer's <plan> (replaces the old
  // Architect). Undefined on subsequent scenes (carried StoryState wins).
  let bibleFromPlan: WriterScenePlan["storyBible"];

  const routingPromise = routeTaggedStream(writerResult.textStream, {
    onPlan: (rawPlan) => {
      try {
        const coerced = coercePlanFromRaw(rawPlan as unknown as Record<string, unknown>);
        coercedPlanRef = coerced;
        if (coerced.storyBible) bibleFromPlan = coerced.storyBible;
        planSettled = true;
        emit?.({ type: "plan", plan: coerced });
        resolvePlan(coerced);
      } catch {
        planSettled = true;
        resolvePlan(minimalFallbackPlan());
      }
    },
    onStoryComplete: (rawStory) => {
      // Tags are ordered (plan before story), so the plan is already coerced.
      const p = coercedPlanRef ?? minimalFallbackPlan();
      try {
        const out = splitProseToBeats(rawStory, p);
        earlyBeatsOut = out;
        for (const b of out.beats) emit?.({ type: "beat", beat: b });
      } catch {
        // split failure → Step 6 re-splits from rawStorySegment
      }
    },
  }).then((result) => {
    // If plan never fired (stream error / no plan tag), settle the deferred
    // from the degraded extraction or a minimal fallback.
    if (!planSettled) {
      const extracted = result.plan
        ? coercePlanFromRaw(result.plan as unknown as Record<string, unknown>)
        : minimalFallbackPlan();
      if (extracted.storyBible) bibleFromPlan = extracted.storyBible;
      resolvePlan(extracted);
    }
    return result;
  });

  // ── Step 2 — await plan (settles at </plan> close — EARLY) ────────
  const plan = await planPromise;
  tlog("[directScene] plan (stream → </plan>)", tStream);

  // From here the pipeline is structurally identical to the old Phase A
  // flow: plan drives character design + cinematographer + painter, all
  // overlapping with the Writer's still-streaming <story>.

  const newCharNames = plan.cast.filter(
    (n) => !session.characters.some((c) => c.name === n),
  );

  const entryBeatActive = plan.entryActiveCharacters;
  const entryBeatSpeaker = plan.entrySpeaker;
  const entryBeatForPaint: Beat = {
    id: plan.entryBeatId,
    speaker: entryBeatSpeaker,
    activeCharacters: entryBeatActive.length > 0 ? entryBeatActive : undefined,
    next: { type: "continue", nextBeatId: plan.entryBeatId },
  };

  const { priorSceneReference, priorSceneKey } = pickPriorSceneReference(
    session,
    plan.sceneKey,
  );

  // ── Step 3 — character cards (LLM) ∥ Cinematographer (parallel) ───
  // CharacterDesigner now receives the Writer's intent for each character
  // (paradigm D: media translator, not inventor).
  const tParallel = Date.now();

  const findIntent = (name: string): CharacterIntent | undefined =>
    plan.characterIntents?.find((ci) => ci.name === name);

  const cardPromises = newCharNames.map((name) =>
    designCharacterCard(config, session, name, findIntent(name)).catch(
      (err): CharacterCard => {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[directScene] designCharacterCard(${name}) failed: ${msg}`);
        return {
          name,
          voiceDescription: `请根据角色名「${name}」推断其性别、年龄与气质。所属世界观：${session.worldSetting}`,
        };
      },
    ),
  );

  const cinemaPromise = runCinematographer(config.text, {
    sceneSummary: plan.sceneSummary,
    styleGuide: session.styleGuide,
    entryBeatActive,
    entryBeatSpeaker,
    priorSceneKey,
    currentSceneKey: plan.sceneKey,
  });

  const [cards, cinemaOut] = await Promise.all([
    Promise.all(cardPromises),
    cinemaPromise,
  ]);
  tlog("[directScene] CharacterCards+Cinematographer parallel", tParallel);

  let characters = mergeCharacters(
    session.characters,
    cards.map((c) => ({
      name: c.name,
      voiceDescription: c.voiceDescription,
      visualDescription: c.visualDescription,
    })),
  );

  // ── Step 4 — portraits + voices, scheduled around Painter ─────────
  const tProvision = Date.now();

  const entryNames = new Set<string>();
  if (entryBeatSpeaker && !isPovName(entryBeatSpeaker)) {
    entryNames.add(entryBeatSpeaker);
  }
  for (const c of entryBeatActive) {
    if (!isPovName(c.name)) entryNames.add(c.name);
  }

  type NamedPortrait = {
    name: string;
    basePortraitUrl?: string;
    basePortraitUuid?: string;
  };
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
  // On the StepFun path, thread the LLM-selected stepfunVoiceId from the card
  // into provision — it lets stepfunProvision honor the catalog pick instead
  // of falling back to the keyword scorer (same network cost: still zero).
  const voicePromises = cards.map((card) =>
    provisionCharacterVoice(config, card.voiceDescription, card.name, {
      stepfunVoiceId: card.stepfunVoiceId,
    }).then(
      (voice): Character => {
        const result: Character = {
          name: card.name,
          voiceDescription: card.voiceDescription,
          voice,
          stepfunVoiceId: card.stepfunVoiceId,
        };
        if (voice) emit?.({ type: "voice", name: card.name, voice });
        return result;
      },
    ),
  );

  const entryPortraits = await Promise.all(entryPortraitPromises);
  characters = mergeCharacters(
    characters,
    entryPortraits.map((p) => ({
      name: p.name,
      voiceDescription: "",
      basePortraitUrl: p.basePortraitUrl,
      basePortraitUuid: p.basePortraitUuid,
    })),
  );
  tlog("[directScene] entry-beat portraits", tProvision);

  // ── Step 5 — Painter ──────────────────────────────────────────────
  const onStageCharacters = characters.filter((c) => plan.cast.includes(c.name));
  const orientation = coerceOrientation(session.orientation);

  const tPainter = Date.now();
  const painted = await runPainter(
    config,
    {
      integratedPrompt: cinemaOut.integratedPrompt,
      styleGuide: session.styleGuide,
      onStageCharacters,
      priorSceneImage: priorSceneReference,
      styleReferenceImage: session.styleReferenceImage,
      orientation,
    },
    entryBeatForPaint,
  );
  tlog("[directScene] Painter", tPainter);

  // Emit background as soon as it's painted — the client can swap the
  // placeholder for the real scene image while beats/voices are still settling.
  emit?.({ type: "background", imageUrl: painted.imageUrl, sceneKey: plan.sceneKey });

  // Overlapped: rest portraits + voices
  const tOverlap = Date.now();
  const [restPortraits, voicedChars] = await Promise.all([
    Promise.all(restPortraitPromises),
    Promise.all(voicePromises),
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
  tlog("[directScene] overlapped portraits+voices", tOverlap);

  // ── Step 6 — await routing completion + split prose into beats ────
  // routeTaggedStream ran concurrently with the entire image pipeline.
  // onStoryComplete likely already fired (splitting + emitting beats for
  // progressive playback); this await retrieves the final result + rawStorySegment.
  const streamResult = await routingPromise;

  // Reuse early-split beats when available (onStoryComplete path); otherwise
  // split from rawStorySegment (degrade / onStoryComplete missed).
  const beatsOut: WriterBeatsOutput = earlyBeatsOut
    ?? splitProseToBeats(streamResult.rawStorySegment ?? "", plan);
  let beats = beatsOut.beats;

  // If earlyBeatsOut was missed but rawStorySegment is available, emit beats
  // now (late but still before done — the client gets them for rendering).
  if (!earlyBeatsOut && beats.length > 0) {
    for (const b of beats) emit?.({ type: "beat", beat: b });
  }

  // Emit choices (from streamResult or from the last beat's choice exits).
  if (streamResult.choices?.length) {
    emit?.({ type: "choices", choices: streamResult.choices });
  }

  // ── C1-ext: merge <choices> segment into the last beat's `next` ────
  // The Writer's <choices> segment produces scene-level exits that are NOT
  // embedded in the beats graph. Attach them to the final beat so the player
  // can actually pick them.
  //
  // IMPORTANT: Only change-scene exits are valid here. The prose paradigm
  // assigns beat ids automatically (b1, b2, ...) in proseSplitter — the LLM
  // has no knowledge of these ids, so any advance-beat targetBeatId it emits
  // in <choices> will point at the wrong beat, causing a loop.
  if (streamResult.choices?.length && beats.length > 0) {
    const validChoices = streamResult.choices.filter(
      (c): c is BeatChoice =>
        typeof c.label === "string" &&
        c.label.length > 0 &&
        c.effect != null &&
        c.effect.kind === "change-scene",
    );
    if (validChoices.length > 0) {
      const withIds = validChoices.map((c, i) => ({
        ...c,
        id: c.id || `sc${i + 1}`,
      }));
      const lastIdx = beats.length - 1;
      const last = beats[lastIdx]!;
      const existing =
        last.next.type === "choice" ? last.next.choices : [];
      const isFallbackOnly =
        existing.length <= 1 &&
        existing.every((c) => c.label === "继续");
      const merged = isFallbackOnly ? withIds : [...existing, ...withIds];
      const seen = new Set<string>();
      const deduped = merged.filter((c) => {
        if (seen.has(c.label)) return false;
        seen.add(c.label);
        return true;
      });
      beats = beats.map((b, i) =>
        i === lastIdx
          ? { ...b, next: { type: "choice" as const, choices: deduped } }
          : b,
      );
    }
  }

  if (streamResult.degraded) {
    console.warn("[directScene] Writer stream was degraded — beats may be fallback");
  }

  const entryBeatId = beats.some((b) => b.id === plan.entryBeatId)
    ? plan.entryBeatId
    : beats[0]!.id;

  // Orphan-speaker voices (defensive net — should be rare).
  const orphanSpeakers = [
    ...new Set(beats.map((b) => b.speaker).filter((n): n is string => Boolean(n))),
  ].filter((n) => !isPovName(n) && !characters.some((c) => c.name === n));
  if (orphanSpeakers.length > 0) {
    const orphanChars = await Promise.all(
      orphanSpeakers.map((n) => provisionVoiceForName(config, session, n)),
    );
    characters = mergeCharacters(characters, orphanChars);
    // Emit orphan voices so the client can preload their audio.
    for (const oc of orphanChars) {
      if (oc.voice) emit?.({ type: "voice", name: oc.name, voice: oc.voice });
    }
  }

  const scene: Scene = {
    id: newSceneId(),
    scenePrompt: cinemaOut.integratedPrompt,
    beats,
    entryBeatId,
    sceneKey: plan.sceneKey,
    imageUuid: painted.kind === "real" ? painted.imageUuid : undefined,
    imageUrl: painted.imageUrl,
    orientation,
  };

  // storyState: opening scene seeds the stable spine from the Writer's
  // storyBible (replacing the old Architect); subsequent scenes carry the
  // existing spine. Volatile fields always come from this scene's patch.
  const baseStoryState: StoryState | undefined = session.storyState
    ?? (bibleFromPlan
      ? {
          logline: bibleFromPlan.logline,
          genreTags: bibleFromPlan.genreTags,
          protagonist: bibleFromPlan.protagonist,
          castNotes: bibleFromPlan.castNotes,
          synopsis: "",
        }
      : undefined);

  const storyState = applyStoryStatePatch(
    baseStoryState,
    beatsOut.storyStatePatch,
  );

  tlog("[directScene] TOTAL", tTotal);

  return { scene, sceneImageUrl: painted.imageUrl, characters, storyState };
}

// ──────────────────────────────────────────────────────────────────────
//  directInsertBeat — single-agent path for in-scene exploration.
//  Generates 1-3 beats with NO new image, NO new characters, plus
//  follow-up choices so the player isn't dumped back to the old options.
// ──────────────────────────────────────────────────────────────────────

function coerceBeatPartial(raw: Record<string, unknown>): InsertBeatPartial | null {
  const narration = (typeof raw.narration === "string" ? raw.narration.trim() : undefined) || undefined;
  const rawSpeaker = (typeof raw.speaker === "string" ? raw.speaker.trim() : undefined) || undefined;
  const speaker = rawSpeaker ? normalizeSpeakerName(rawSpeaker) : undefined;
  const line = (typeof raw.line === "string" ? raw.line.trim() : undefined) || undefined;
  const lineDelivery =
    line && speaker !== POV_DISPLAY_NAME
      ? ((typeof raw.lineDelivery === "string" ? raw.lineDelivery.trim() : undefined) || undefined)
      : undefined;
  if (!narration && !speaker && !line) return null;
  if (line && !speaker) {
    return { narration: [narration, line].filter(Boolean).join("\n") || undefined };
  }
  return { narration, speaker, line, lineDelivery };
}

export async function directInsertBeat(
  config: ProviderConfig,
  session: Session,
  freeformAction: string,
): Promise<InsertBeatPartial[]> {
  const raw = await chat(
    config,
    [
      { role: "system", content: INSERT_BEAT_SYSTEM },
      {
        role: "user",
        content: buildInsertBeatUserMessage(session, freeformAction),
      },
    ],
    { temperature: 0.9, tag: "insert-beat" },
  );

  const parsed = parseJsonLoose<InsertBeatMulti & InsertBeatPartial>(raw);

  // Multi-beat format: { beats: [...] }
  if (Array.isArray(parsed.beats) && parsed.beats.length > 0) {
    const beats = parsed.beats
      .slice(0, 3)
      .map((b) =>
        b && typeof b === "object"
          ? coerceBeatPartial(b as Record<string, unknown>)
          : null,
      )
      .filter((b): b is InsertBeatPartial => b !== null);
    if (beats.length === 0) {
      beats.push({ narration: "（你停下脚步，环视片刻。）" });
    }
    return beats;
  }

  // Legacy single-beat fallback
  const single = coerceBeatPartial(parsed as Record<string, unknown>);
  return [single ?? { narration: "（你停下脚步，环视片刻。）" }];
}
