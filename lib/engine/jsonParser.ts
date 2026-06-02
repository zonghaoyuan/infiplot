import { jsonrepair, JSONRepairError } from "jsonrepair";

// Strict-then-forgiving JSON parser for LLM output. Tries in order:
//   1. Direct JSON.parse on the trimmed text.
//   2. Extract from ```json``` fenced block.
//   3. Slice between first { and last } and parse.
//   4. Apply targeted regex pre-repairs (see preRepair) and try jsonrepair.
//
// On final failure, logs the first 800 chars of the raw model output so we
// can diagnose the actual syntax error without flooding logs or leaking
// sensitive content.
//
// jsonrepair (npm package josdejong/jsonrepair — 2.3k+ stars) handles the
// broad LLM-output failure modes: truncated JSON, missing commas/brackets,
// single quotes, Python None/True/False, JS comments. We layer a small set
// of targeted pre-repairs in front of it for failure modes jsonrepair can't
// disambiguate on its own (see preRepair).

// ──────────────────────────────────────────────────────────────────────
//  preRepair — fix specific LLM error patterns before handing to jsonrepair.
//
//  Pattern 1: missing closing quote on a key.
//     Broken:  "lineDelivery: "语速稍快...",
//     Correct: "lineDelivery": "语速稍快...",
//
//  jsonrepair fails on this because it's ambiguous — "lineDelivery: " could
//  be a complete string value, leaving "语速稍快..." as a syntax error. But
//  if we see  "<key-like>:<whitespace>"  we know structurally it should be
//  a key-colon-value triplet.
//
//  Match constraints:
//    - The key match excludes  "  \n  :  so we can't overrun into adjacent
//      fields or absorb the colon as part of the key name.
//    - The colon must be followed by whitespace and another  "  (the value
//      string's opening quote). This is what disambiguates from a value
//      string that happens to contain a colon.
// ──────────────────────────────────────────────────────────────────────

function preRepair(s: string): string {
  return s.replace(/"([^"\n:]+):(\s+)"/g, '"$1":$2"');
}

export function parseJsonLoose<T>(raw: string): T {
  const trimmed = raw.trim();

  try {
    return JSON.parse(trimmed) as T;
  } catch {
    // fall through
  }

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fenced?.[1]) {
    try {
      return JSON.parse(fenced[1]) as T;
    } catch {
      // fall through
    }
  }

  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  const slice =
    first !== -1 && last > first ? trimmed.slice(first, last + 1) : trimmed;

  // Try the brace-sliced version first; if there were no braces at all
  // (slice === trimmed), this is just a second attempt at the raw text.
  try {
    return JSON.parse(slice) as T;
  } catch {
    // Targeted pre-repair (no-op on already-valid JSON) → jsonrepair.
    const prefixed = preRepair(slice);

    // If preRepair changed something, give the cheap path another shot —
    // the input might already be valid now without needing jsonrepair.
    if (prefixed !== slice) {
      try {
        return JSON.parse(prefixed) as T;
      } catch {
        // fall through to jsonrepair
      }
    }

    try {
      const repaired = jsonrepair(prefixed);
      return JSON.parse(repaired) as T;
    } catch (err) {
      const isRepairErr = err instanceof JSONRepairError;
      console.error(
        `[parseJsonLoose] jsonrepair ${isRepairErr ? "could not repair" : "succeeded but JSON.parse rejected its output"}. Raw output (first 800 chars):\n${raw.slice(0, 800)}`,
      );
      throw err;
    }
  }
}
