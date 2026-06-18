import type {
  WriterScenePlan,
} from "@infiplot/types";
import type { WriterBeatsOutput } from "../agents/writer";
import {
  coerceBeatsFromRaw,
  coerceStoryStatePatch,
  normalizeSpeakerName,
  synthesizeFallbackBeats,
} from "../agents/writer";
import { parseJsonLoose } from "../jsonParser";

// ──────────────────────────────────────────────────────────────────────
//  proseSplitter — rule-based prose → Beat[] splitter.
//
//  The Writer now outputs continuous prose in the <story> segment instead
//  of JSON beats. This module splits prose into RawBeat[] using lightweight
//  markers (blank-line delimited paragraphs, <i> for inner monologue,
//  「speaker：quote」 for NPC dialogue), then feeds the result through the
//  existing coerceBeatsFromRaw pipeline to get fully validated Beat[].
//
//  Zero extra LLM calls. Multiple degradation layers — never throws.
// ──────────────────────────────────────────────────────────────────────

type RawBeat = {
  narration?: string;
  speaker?: string;
  line?: string;
  lineDelivery?: string;
};

// Match inner-monologue blocks: <i>...</i> (possibly multiline)
const INNER_RE = /^\s*<i>([\s\S]+?)<\/i>\s*$/;

// Match NPC dialogue: Speaker：「dialogue」 or Speaker:「dialogue」
// Supports 「」『』"" quote pairs. Speaker name is 1-20 non-whitespace chars.
const DIALOGUE_RE =
  /^\s*(\S{1,20})\s*[：:]\s*(?:[「『"]([\s\S]+?)[」』"])\s*$/;

// Match <memory>{...}</memory> block anywhere in the story segment.
const MEMORY_RE = /<memory>([\s\S]+?)<\/memory>/;

/**
 * Extract and strip the <memory> JSON block from raw story prose.
 * Returns the parsed StoryStatePatch (or undefined) plus the cleaned prose.
 */
function extractMemoryBlock(rawStory: string): {
  patch: ReturnType<typeof coerceStoryStatePatch>;
  cleanedProse: string;
} {
  const match = MEMORY_RE.exec(rawStory);
  if (!match) return { patch: undefined, cleanedProse: rawStory };

  const jsonStr = match[1]!;
  const cleanedProse = rawStory.replace(MEMORY_RE, "").trim();

  try {
    const parsed = parseJsonLoose<Record<string, unknown>>(jsonStr);
    return {
      patch: coerceStoryStatePatch(
        parsed as Parameters<typeof coerceStoryStatePatch>[0],
      ),
      cleanedProse,
    };
  } catch {
    console.warn("[proseSplitter] failed to parse <memory> block, skipping");
    return { patch: undefined, cleanedProse };
  }
}

/**
 * Classify a single prose paragraph into one of three beat forms.
 */
function classifyBlock(
  block: string,
  plan: WriterScenePlan,
): RawBeat {
  const trimmed = block.trim();

  // Inner monologue: <i>text</i> → speaker="你"
  const innerMatch = INNER_RE.exec(trimmed);
  if (innerMatch) {
    return {
      speaker: "你",
      line: innerMatch[1]!.trim(),
    };
  }

  // NPC dialogue: Speaker：「quote」
  const dialogueMatch = DIALOGUE_RE.exec(trimmed);
  if (dialogueMatch) {
    const rawSpeaker = dialogueMatch[1]!.trim();
    const speaker = normalizeSpeakerName(rawSpeaker);
    const line = dialogueMatch[2]!.trim();
    const intent = plan.characterIntents?.find((ci) => ci.name === speaker);
    return {
      speaker,
      line,
      lineDelivery: intent?.speakingTone || undefined,
    };
  }

  // Default: pure narration
  return { narration: trimmed };
}

/**
 * Split continuous prose into Beat[], reusing the full coerce→repair→fallback
 * pipeline. Zero extra LLM calls. Never throws.
 *
 * @param rawStory - The raw prose from the <story> segment.
 * @param plan - The parsed WriterScenePlan (from <plan> segment).
 * @returns WriterBeatsOutput with Beat[] + optional StoryStatePatch.
 */
export function splitProseToBeats(
  rawStory: string,
  plan: WriterScenePlan,
): WriterBeatsOutput {
  try {
    // 1. Extract <memory> block (story-state volatile patch)
    const { patch, cleanedProse } = extractMemoryBlock(rawStory);

    // 2. Split by blank lines into paragraphs
    const blocks = cleanedProse
      .split(/\n\s*\n/)
      .map((b) => b.trim())
      .filter((b) => b.length > 0);

    if (blocks.length === 0) {
      console.warn("[proseSplitter] empty prose after cleanup, using fallback");
      return {
        beats: synthesizeFallbackBeats(plan),
        storyStatePatch: patch,
      };
    }

    // 3. Classify each block into a RawBeat
    const rawBeats: RawBeat[] = blocks.map((block) => {
      try {
        return classifyBlock(block, plan);
      } catch {
        return { narration: block };
      }
    });

    // 4. Feed through existing coerce pipeline (id assignment, POV
    //    normalization, entry alignment, exit guarantee, uniqueness)
    const coerced = coerceBeatsFromRaw(rawBeats, plan);
    return {
      beats: coerced.beats,
      storyStatePatch: patch ?? coerced.storyStatePatch,
    };
  } catch (err) {
    console.error("[proseSplitter] unexpected error, using fallback:", err);
    return {
      beats: synthesizeFallbackBeats(plan),
      storyStatePatch: undefined,
    };
  }
}
