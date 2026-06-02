import { chat } from "@infiplot/ai-client";
import type {
  Beat,
  BeatActiveCharacter,
  BeatChoice,
  BeatChoiceEffect,
  BeatNext,
  ProviderConfig,
  Session,
  StoryStatePatch,
} from "@infiplot/types";
import { parseJsonLoose } from "../jsonParser";
import { WRITER_SYSTEM, buildWriterUserMessage } from "../prompts";

// ──────────────────────────────────────────────────────────────────────
//  Writer agent — owns the narrative half of scene generation.
//
//  Output: { sceneSummary, sceneKey, entryBeatId, beats[] }
//  Each beat carries activeCharacters[] (names + poses) the
//  Cinematographer reads when composing the establishing shot.
//
//  Character DESIGN (visual + voice) is NOT this agent's job —
//  it only names characters; the CharacterDesigner picks up any
//  unknown name from beats[].activeCharacters.
// ──────────────────────────────────────────────────────────────────────

export type WriterOutput = {
  sceneSummary: string;
  sceneKey?: string;
  entryBeatId: string;
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
type RawScene = {
  sceneSummary?: string;
  sceneKey?: string;
  entryBeatId?: string;
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
// the director leaves the carried StoryState untouched.
function coerceStoryStatePatch(
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

export async function runWriter(
  config: ProviderConfig,
  session: Session,
): Promise<WriterOutput> {
  const raw = await chat(
    config,
    [
      { role: "system", content: WRITER_SYSTEM },
      { role: "user", content: buildWriterUserMessage(session) },
    ],
    { temperature: 0.9, responseFormat: "json_object" },
  );

  const parsed = parseJsonLoose<RawScene>(raw);
  const rawBeats = Array.isArray(parsed.beats) ? parsed.beats : [];
  if (rawBeats.length === 0) {
    throw new Error("Writer returned no beats");
  }

  const beats = ensureUniqueChoiceIds(
    repairBeats(
      ensureUniqueBeatIds(
        rawBeats.map((b, i) => coerceBeat(b, i, rawBeats.length)),
      ),
    ),
  );

  const declaredEntry = parsed.entryBeatId?.trim();
  const entryBeatId =
    declaredEntry && beats.some((b) => b.id === declaredEntry)
      ? declaredEntry
      : beats[0]!.id;

  return {
    sceneSummary: parsed.sceneSummary?.trim() || "未指定场景概要",
    sceneKey: normalizeSceneKey(parsed.sceneKey),
    entryBeatId,
    beats,
    storyStatePatch: coerceStoryStatePatch(parsed.storyStatePatch),
  };
}

// Surface the set of character names introduced by this scene's beats,
// so the orchestrator can decide which ones need the CharacterDesigner to
// fire. Pulls names from both `speaker` fields AND `activeCharacters`
// (a character can be on-screen without speaking).
//
// Excludes POV ("你" / 玩家 / 主角 / ...) entirely — the player is never
// designed (no portrait, no voice, no archetype).
export function collectActiveCharacterNames(beats: Beat[]): string[] {
  const seen = new Set<string>();
  for (const b of beats) {
    if (b.speaker && !isPovName(b.speaker)) seen.add(b.speaker);
    if (b.activeCharacters) {
      for (const c of b.activeCharacters) {
        if (!isPovName(c.name)) seen.add(c.name);
      }
    }
  }
  return Array.from(seen);
}

// Re-export POV constants for downstream filters (director's orphanSpeakers).
export { POV_DISPLAY_NAME, POV_VARIANTS, isPovName, normalizeSpeakerName };
