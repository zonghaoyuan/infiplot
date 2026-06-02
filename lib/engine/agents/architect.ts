import { chat } from "@infiplot/ai-client";
import type { ProviderConfig, Session, StoryState } from "@infiplot/types";
import { parseJsonLoose } from "../jsonParser";
import { ARCHITECT_SYSTEM, buildArchitectUserMessage } from "../prompts";

// ──────────────────────────────────────────────────────────────────────
//  Architect agent — ONE LLM call at session start.
//
//  Expands the user's (often terse) world + style prompt into a real story
//  bible: a second-person protagonist with a want and a flaw, a single
//  central dramatic question (logline), a genre frame that anchors the
//  爽点 rhythm, an engineered cold-open for scene 1 (nextHook), and a small
//  intentional cast. Seeds the StoryState that the Writer reads and updates
//  every scene — so the story has a spine from beat one instead of being
//  improvised cold.
//
//  Everything is best-effort coerced with fallbacks: a malformed LLM
//  response can never abort session start — worst case the Writer just gets
//  a thinner bible and improvises more.
// ──────────────────────────────────────────────────────────────────────

type RawStoryState = {
  logline?: unknown;
  genreTags?: unknown;
  protagonist?: unknown;
  castNotes?: unknown;
  synopsis?: unknown;
  openThreads?: unknown;
  relationships?: unknown;
  nextHook?: unknown;
};

function str(raw: unknown): string {
  return typeof raw === "string" ? raw.trim() : "";
}

function strArray(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out = raw
    .map((x) => (typeof x === "string" ? x.trim() : ""))
    .filter((x) => x.length > 0);
  return out.length > 0 ? out : undefined;
}

export async function runArchitect(
  config: ProviderConfig,
  session: Session,
): Promise<StoryState> {
  try {
    const raw = await chat(
      config,
      [
        { role: "system", content: ARCHITECT_SYSTEM },
        { role: "user", content: buildArchitectUserMessage(session) },
      ],
      { temperature: 0.85, responseFormat: "json_object" },
    );

    const parsed = parseJsonLoose<RawStoryState>(raw);

    return {
      // Stable spine — fall back to the raw world/style prompt so the bible is
      // never wholly empty even if the model returns garbage.
      logline: str(parsed.logline) || session.worldSetting,
      genreTags: str(parsed.genreTags),
      protagonist:
        str(parsed.protagonist) ||
        "你是这个故事的主角（第二人称视角，永不出现在画面里）。",
      castNotes: str(parsed.castNotes) || undefined,
      // Volatile seeds — the opening Writer will rewrite these via its patch.
      synopsis: str(parsed.synopsis) || "故事即将开始。",
      openThreads: strArray(parsed.openThreads),
      relationships: strArray(parsed.relationships),
      nextHook: str(parsed.nextHook) || undefined,
    };
  } catch (err) {
    // chat() or parseJsonLoose() can throw (network / unrepairable JSON).
    // The Architect is best-effort: never let it abort session start — return
    // a minimal bible seeded from the raw prompt and let the Writer improvise.
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[architect] failed, using minimal bible: ${msg}`);
    return {
      logline: session.worldSetting,
      genreTags: "",
      protagonist:
        "你是这个故事的主角（第二人称视角，永不出现在画面里）。",
      synopsis: "故事即将开始。",
    };
  }
}
