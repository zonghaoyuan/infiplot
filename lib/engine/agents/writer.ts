import { chatStream } from "@infiplot/ai-client";
import type {
  Beat,
  BeatActiveCharacter,
  BeatChoice,
  BeatChoiceEffect,
  BeatNext,
  ChatStreamResult,
  ProviderConfig,
  Session,
  StoryStatePatch,
  WriterPlan,
  WriterScenePlan,
} from "@infiplot/types";
import { parseJsonLoose } from "../jsonParser";
import { buildWriterStreamMessages } from "../prompts";

// ──────────────────────────────────────────────────────────────────────
//  Writer agent — owns the narrative half of scene generation, in TWO phases.
//
//  Phase A — runWriterPlan: the scene skeleton (WriterPlan) the image pipeline
//    needs (sceneSummary + sceneKey + entry roster + full cast). No dialogue,
//    so it returns fast and unblocks the Cinematographer + character design.
//  Phase B — runWriterBeats: the full beats[] graph + storyStatePatch, written
//    to honor the plan and overlapped with the (longer) image pipeline.
//
//  Character DESIGN (visual + voice) is NOT this agent's job — it only NAMES
//  characters (Phase A's cast); the CharacterDesigner picks up unknown names.
// ──────────────────────────────────────────────────────────────────────

export type WriterBeatsOutput = {
  beats: Beat[];
  /** Rewritten volatile story memory — merged onto the carried StoryState by
   *  the director. Absent when the model omitted it (rare; bible just stales). */
  storyStatePatch?: StoryStatePatch;
};

// Raw shapes — what the LLM produces before validation / coercion.
type RawActiveCharacter = {
  name?: string;
  pose?: string;
};
type RawEffect = {
  kind?: string;
  targetBeatId?: string;
  nextSceneSeed?: string;
};
type RawChoice = {
  id?: string;
  label?: string;
  effect?: RawEffect;
};
type RawNext = {
  type?: string;
  nextBeatId?: string;
  choices?: RawChoice[];
};
type RawBeat = {
  id?: string;
  narration?: string;
  speaker?: string;
  line?: string;
  lineDelivery?: string;
  activeCharacters?: RawActiveCharacter[];
  next?: RawNext;
};
type RawStoryStatePatch = {
  synopsis?: unknown;
  openThreads?: unknown;
  relationships?: unknown;
  nextHook?: unknown;
};
// Phase A raw shape (skeleton only — no beats).
type RawPlan = {
  sceneSummary?: string;
  sceneKey?: string;
  entryBeatId?: string;
  cast?: unknown;
  entrySpeaker?: string;
  entryActiveCharacters?: RawActiveCharacter[];
};
// Phase B raw shape (beats + memory only — plan fields come from runWriterPlan).
type RawBeats = {
  beats?: RawBeat[];
  storyStatePatch?: RawStoryStatePatch;
};

// ──────────────────────────────────────────────────────────────────────
//  POV (player viewpoint) handling — Pattern B (galgame standard):
//    - speaker = "你"      → ALLOWED (renders as dialog box, never TTS'd)
//    - any other POV term  → normalized to "你" (LLM slip-up safety net)
//    - activeCharacters    → POV is NEVER allowed (player has no body in-scene)
//    - CharacterDesigner   → never invoked for "你" or POV variants
// ──────────────────────────────────────────────────────────────────────

const POV_DISPLAY_NAME = "你";
const POV_VARIANTS = new Set([
  "玩家",
  "我",
  "主角",
  "protagonist",
  "Protagonist",
  "player",
  "Player",
  "PLAYER",
  "MC",
  "mc",
  "Mc",
  "I",
  "i",
  "me",
  "Me",
  "ME",
]);

function isPovName(name: string): boolean {
  return name === POV_DISPLAY_NAME || POV_VARIANTS.has(name);
}

// Normalize a speaker name: any POV variant collapses to "你"; an NPC name
// passes through unchanged. Caller passes already-trimmed input.
function normalizeSpeakerName(name: string): string {
  return POV_VARIANTS.has(name) ? POV_DISPLAY_NAME : name;
}

function coerceEffect(raw: RawEffect | undefined): BeatChoiceEffect {
  if (raw?.kind === "advance-beat" && raw.targetBeatId?.trim()) {
    return { kind: "advance-beat", targetBeatId: raw.targetBeatId.trim() };
  }
  return {
    kind: "change-scene",
    nextSceneSeed: raw?.nextSceneSeed?.trim() || "未指定",
  };
}

function coerceChoice(raw: RawChoice, idx: number): BeatChoice {
  return {
    id: raw.id?.trim() || `c${idx + 1}`,
    label: raw.label?.trim() || `选项 ${idx + 1}`,
    effect: coerceEffect(raw.effect),
  };
}

function coerceNext(raw: RawNext | undefined, fallbackBeatId: string): BeatNext {
  if (raw?.type === "choice" && Array.isArray(raw.choices) && raw.choices.length) {
    return {
      type: "choice",
      choices: raw.choices.map((c, i) => coerceChoice(c, i)),
    };
  }
  return {
    type: "continue",
    nextBeatId: raw?.nextBeatId?.trim() || fallbackBeatId,
  };
}

function coerceActiveCharacters(
  raw: RawActiveCharacter[] | undefined,
): BeatActiveCharacter[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out = raw
    .map((c): BeatActiveCharacter | null => {
      const name = c.name?.trim();
      if (!name) return null;
      // POV is never IN the picture — strip the LLM's slip-up silently so
      // CharacterDesigner doesn't end up generating a portrait for the player.
      if (isPovName(name)) return null;
      const pose = c.pose?.trim();
      return pose ? { name, pose } : { name };
    })
    .filter((c): c is BeatActiveCharacter => Boolean(c));
  return out.length > 0 ? out : undefined;
}

function coerceBeat(raw: RawBeat, idx: number, totalBeats: number): Beat {
  const id = raw.id?.trim() || `b${idx + 1}`;
  // Non-last beats default their `continue` target to the following beat.
  // The last beat gets an empty fallback on purpose: repairBeats() turns a
  // last/dangling continue into a real scene-change exit so the player can
  // never get stuck self-looping on it.
  const fallback = idx + 1 < totalBeats ? `b${idx + 2}` : "";

  const rawSpeaker = raw.speaker?.trim() || undefined;
  // Normalize any POV variant (玩家/我/主角/protagonist/...) to "你".
  // NPC names pass through unchanged. This means the LLM can slip and
  // write "玩家" or "I" and we still render the dialog box correctly with
  // speaker="你" — and TTS is automatically skipped because no Character
  // record exists for "你".
  const speaker = rawSpeaker ? normalizeSpeakerName(rawSpeaker) : undefined;

  const line = raw.line?.trim() || undefined;
  return {
    id,
    narration: raw.narration?.trim() || undefined,
    speaker,
    line,
    // lineDelivery is meaningful only for NPC speakers (TTS). For POV
    // speaker ("你") TTS is skipped, so lineDelivery would never be used.
    lineDelivery:
      line && speaker !== POV_DISPLAY_NAME
        ? raw.lineDelivery?.trim() || undefined
        : undefined,
    activeCharacters: coerceActiveCharacters(raw.activeCharacters),
    next: coerceNext(raw.next, fallback),
  };
}

const FALLBACK_SEED = "故事继续推进";

function fallbackExitChoice(beatId: string): BeatChoice {
  return {
    id: `${beatId}__exit`,
    label: "继续",
    effect: { kind: "change-scene", nextSceneSeed: FALLBACK_SEED },
  };
}

// Beat ids are graph keys (the front-end's `beats.find(b => b.id === ...)`,
// the session's `visitedBeatIds`, and `continue`/`advance-beat` targets). If
// the model reuses an id across beats, the second occurrence becomes silently
// unreachable and external references collapse to the first beat. Rename
// duplicates; rewrite the renamed beat's OWN self-references. External
// references stay pointing at the first occurrence.
function ensureUniqueBeatIds(beats: Beat[]): Beat[] {
  const seen = new Set<string>();
  return beats.map((b): Beat => {
    if (!seen.has(b.id)) {
      seen.add(b.id);
      return b;
    }
    const oldId = b.id;
    let n = 2;
    while (seen.has(`${oldId}_${n}`)) n += 1;
    const newId = `${oldId}_${n}`;
    seen.add(newId);

    let next = b.next;
    if (next.type === "continue" && next.nextBeatId === oldId) {
      next = { type: "continue", nextBeatId: newId };
    } else if (next.type === "choice") {
      next = {
        type: "choice",
        choices: next.choices.map((c) =>
          c.effect.kind === "advance-beat" && c.effect.targetBeatId === oldId
            ? {
                ...c,
                effect: { kind: "advance-beat" as const, targetBeatId: newId },
              }
            : c,
        ),
      };
    }
    return { ...b, id: newId, next };
  });
}

// Repairs referential integrity AND guarantees the scene is escapable:
// - a `continue` to a missing/self id is repointed to the next beat in order;
//   a last/dangling continue with nowhere to go becomes a scene-change exit
// - an `advance-beat` to a missing id is downgraded to a scene change
// - if no change-scene exit exists anywhere, one is appended to the last beat
function repairBeats(beats: Beat[]): Beat[] {
  const ids = new Set(beats.map((b) => b.id));

  const fixed: Beat[] = beats.map((b, idx): Beat => {
    if (b.next.type === "continue") {
      const target = b.next.nextBeatId;
      if (ids.has(target) && target !== b.id) return b;
      const nextByIndex = beats[idx + 1]?.id;
      if (nextByIndex) {
        return { ...b, next: { type: "continue", nextBeatId: nextByIndex } };
      }
      return { ...b, next: { type: "choice", choices: [fallbackExitChoice(b.id)] } };
    }

    const patched = b.next.choices.map((c) =>
      c.effect.kind === "advance-beat" && !ids.has(c.effect.targetBeatId)
        ? {
            ...c,
            effect: {
              kind: "change-scene" as const,
              nextSceneSeed: "未指定（导演引用不存在的 beat，已降级为换场）",
            },
          }
        : c,
    );
    return { ...b, next: { type: "choice", choices: patched } };
  });

  const hasExit = fixed.some(
    (b) =>
      b.next.type === "choice" &&
      b.next.choices.some((c) => c.effect.kind === "change-scene"),
  );
  if (!hasExit && fixed.length > 0) {
    const lastIdx = fixed.length - 1;
    const last = fixed[lastIdx]!;
    const existing = last.next.type === "choice" ? last.next.choices : [];
    fixed[lastIdx] = {
      ...last,
      next: { type: "choice", choices: [...existing, fallbackExitChoice(last.id)] },
    };
  }

  return fixed;
}

// Choice ids are keys the front-end uses to cache + consume prefetched
// scenes. Two beats both defaulting to c1/c2 would make a transition reuse
// the WRONG prefetched scene — so force every choice id to be unique within
// the scene.
function ensureUniqueChoiceIds(beats: Beat[]): Beat[] {
  const seen = new Set<string>();
  for (const b of beats) {
    if (b.next.type !== "choice") continue;
    for (const c of b.next.choices) {
      if (seen.has(c.id)) {
        let n = 2;
        while (seen.has(`${c.id}_${n}`)) n += 1;
        c.id = `${c.id}_${n}`;
      }
      seen.add(c.id);
    }
  }
  return beats;
}

// Normalize sceneKey to a safe lowercase-with-dashes English slug. If the
// model returns something weird (中文 / spaces / mixed case), best-effort
// fix; if it ends up empty, return undefined (the scene just won't be
// considered for img2img reuse).
function normalizeSceneKey(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const slug = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return slug.length > 0 ? slug : undefined;
}

function coerceStringArray(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out = raw
    .map((x) => (typeof x === "string" ? x.trim() : ""))
    .filter((x) => x.length > 0);
  return out.length > 0 ? out : undefined;
}

// Pull the volatile story-memory rewrite out of the Writer's JSON. Only
// non-empty fields are kept; an all-empty/absent patch returns undefined so
// the director leaves the carried StoryState untouched. Exported so the
// prose splitter can reuse it to parse the <story> segment's <memory> block.
export function coerceStoryStatePatch(
  raw: RawStoryStatePatch | undefined,
): StoryStatePatch | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const patch: StoryStatePatch = {};
  const synopsis = typeof raw.synopsis === "string" ? raw.synopsis.trim() : "";
  if (synopsis) patch.synopsis = synopsis;
  const openThreads = coerceStringArray(raw.openThreads);
  if (openThreads) patch.openThreads = openThreads;
  const relationships = coerceStringArray(raw.relationships);
  if (relationships) patch.relationships = relationships;
  const nextHook = typeof raw.nextHook === "string" ? raw.nextHook.trim() : "";
  if (nextHook) patch.nextHook = nextHook;
  return Object.keys(patch).length > 0 ? patch : undefined;
}

// Phase A — dedupe + clean the planned cast. Drops the POV player (never
// designed) and any blank/duplicate name. Order is preserved.
function coerceCast(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of raw) {
    const name = typeof x === "string" ? x.trim() : "";
    if (!name || isPovName(name) || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

// Rename one beat's id and repoint every INTERNAL reference (continue targets,
// advance-beat targets) so the graph stays intact. Only called when `to` is
// absent from the scene, so it can't introduce a duplicate id.
function renameBeatId(beats: Beat[], from: string, to: string): Beat[] {
  if (from === to) return beats;
  return beats.map((b): Beat => {
    const id = b.id === from ? to : b.id;
    let next = b.next;
    if (next.type === "continue" && next.nextBeatId === from) {
      next = { type: "continue", nextBeatId: to };
    } else if (next.type === "choice") {
      next = {
        type: "choice",
        choices: next.choices.map((c) =>
          c.effect.kind === "advance-beat" && c.effect.targetBeatId === from
            ? { ...c, effect: { kind: "advance-beat" as const, targetBeatId: to } }
            : c,
        ),
      };
    }
    return { ...b, id, next };
  });
}

// Fallback — when the Writer stream fails to yield usable beats, keep the scene
// playable with a single entry beat synthesized from the plan: narrate the
// planned summary and offer one change-scene exit so the player can advance.
export function synthesizeFallbackBeats(plan: WriterPlan): Beat[] {
  const id = plan.entryBeatId || "b1";
  return [
    {
      id,
      narration: plan.sceneSummary,
      activeCharacters:
        plan.entryActiveCharacters.length > 0
          ? plan.entryActiveCharacters
          : undefined,
      next: { type: "choice", choices: [fallbackExitChoice(id)] },
    },
  ];
}

// Re-export POV constants for downstream filters (director's orphan voices).
export { POV_DISPLAY_NAME, POV_VARIANTS, isPovName, normalizeSpeakerName };

// ──────────────────────────────────────────────────────────────────────
//  Paradigm D — single-pass streaming Writer
// ──────────────────────────────────────────────────────────────────────

/**
 * Streaming Writer: single LLM call producing `<plan>/<story>/<choices>`
 * tagged output. The caller (director) feeds the textStream to StreamRouter
 * which dispatches downstream agents as tags close.
 *
 * Uses `chatStream` (Task 2) + `buildWriterStreamUserMessage` (ContextProvider).
 * Temperature and tag mirror the existing chat() calls.
 */
export function runWriterStream(
  config: ProviderConfig,
  session: Session,
): ChatStreamResult {
  return chatStream(
    config,
    buildWriterStreamMessages(session),
    { temperature: 0.9, tag: "writer-stream" },
  );
}

/**
 * Coerce a raw parsed plan (from StreamRouter's `<plan>` segment) into a
 * clean WriterScenePlan. Reuses the existing Phase A coercion pipeline.
 */
export function coercePlanFromRaw(raw: Record<string, unknown>): WriterScenePlan {
  const entryActiveCharacters =
    coerceActiveCharacters(raw.entryActiveCharacters as RawActiveCharacter[]) ?? [];

  const rawEntrySpeaker =
    typeof raw.entrySpeaker === "string" ? raw.entrySpeaker.trim() : undefined;
  const entrySpeaker = rawEntrySpeaker
    ? normalizeSpeakerName(rawEntrySpeaker)
    : undefined;

  const cast = coerceCast(raw.cast);
  const castSet = new Set(cast);
  const addToCast = (name: string): void => {
    if (!isPovName(name) && !castSet.has(name)) {
      castSet.add(name);
      cast.push(name);
    }
  };
  for (const c of entryActiveCharacters) addToCast(c.name);
  if (entrySpeaker) addToCast(entrySpeaker);

  const characterIntents = Array.isArray(raw.characterIntents)
    ? (raw.characterIntents as Array<Record<string, unknown>>)
        .filter((ci) => typeof ci.name === "string" && (ci.name as string).trim())
        .map((ci) => ({
          name: (ci.name as string).trim(),
          mood: typeof ci.mood === "string" ? ci.mood.trim() || undefined : undefined,
          motivation:
            typeof ci.motivation === "string"
              ? ci.motivation.trim() || undefined
              : undefined,
          speakingTone:
            typeof ci.speakingTone === "string"
              ? ci.speakingTone.trim() || undefined
              : undefined,
        }))
    : undefined;

  // Story bible — first scene only. The Writer's <plan> includes a storyBible
  // sub-object on the opening scene (replacing the old Architect call). Absent
  // on subsequent scenes (the carried StoryState stays authoritative).
  const rawBible = raw.storyBible as Record<string, unknown> | undefined;
  let storyBible: WriterScenePlan["storyBible"];
  if (rawBible && typeof rawBible === "object") {
    const logline = typeof rawBible.logline === "string" ? rawBible.logline.trim() : "";
    const genreTags = typeof rawBible.genreTags === "string" ? rawBible.genreTags.trim() : "";
    const protagonist =
      typeof rawBible.protagonist === "string" ? rawBible.protagonist.trim() : "";
    const castNotes =
      typeof rawBible.castNotes === "string" ? rawBible.castNotes.trim() || undefined : undefined;
    // Only treat it as a real bible if at least one core field is present.
    if (logline || genreTags || protagonist) {
      storyBible = { logline, genreTags, protagonist, castNotes };
    }
  }

  return {
    sceneSummary:
      typeof raw.sceneSummary === "string"
        ? raw.sceneSummary.trim() || "未指定场景概要"
        : "未指定场景概要",
    sceneKey: normalizeSceneKey(
      typeof raw.sceneKey === "string" ? raw.sceneKey : undefined,
    ),
    entryBeatId:
      typeof raw.entryBeatId === "string"
        ? raw.entryBeatId.trim() || "b1"
        : "b1",
    cast,
    entryActiveCharacters,
    entrySpeaker,
    characterIntents,
    storyBible,
  };
}

/**
 * Coerce raw beats into clean Beat[] + optional StoryStatePatch. Called by
 * proseSplitter (散文→RawBeat[]) and as fallback for degraded streams.
 * Reuses the full pipeline: coerceBeat → ensureUniqueBeatIds → repairBeats →
 * ensureUniqueChoiceIds → entry-id pinning.
 */
export function coerceBeatsFromRaw(
  raw: unknown,
  plan: WriterScenePlan,
): WriterBeatsOutput {
  // Input can be a bare RawBeat[] or { beats, storyStatePatch } wrapper.
  let rawBeats: RawBeat[] = [];
  let rawPatch: RawStoryStatePatch | undefined;

  if (Array.isArray(raw)) {
    rawBeats = raw;
  } else if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    rawBeats = Array.isArray(obj.beats) ? (obj.beats as RawBeat[]) : [];
    rawPatch = obj.storyStatePatch as RawStoryStatePatch | undefined;
  }

  if (rawBeats.length === 0) {
    return { beats: synthesizeFallbackBeats(plan), storyStatePatch: undefined };
  }

  let beats = ensureUniqueChoiceIds(
    repairBeats(
      ensureUniqueBeatIds(
        rawBeats.map((b, i) => coerceBeat(b, i, rawBeats.length)),
      ),
    ),
  );

  if (!beats.some((b) => b.id === plan.entryBeatId)) {
    beats = renameBeatId(beats, beats[0]!.id, plan.entryBeatId);
  }

  const entryRoster =
    plan.entryActiveCharacters.length > 0 ? plan.entryActiveCharacters : undefined;
  beats = beats.map((b) =>
    b.id === plan.entryBeatId ? { ...b, activeCharacters: entryRoster } : b,
  );

  return {
    beats,
    storyStatePatch: coerceStoryStatePatch(rawPatch),
  };
}
