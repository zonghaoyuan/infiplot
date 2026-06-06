import { chat } from "@infiplot/ai-client";
import type { ProviderConfig } from "@infiplot/types";
import { STYLE_MAP } from "@/lib/options";

const STYLE_NAMES = Object.keys(STYLE_MAP);

const SYSTEM = `You are an art director for a visual novel. Given the story premise, pick the single best-matching art style from the list below. Consider the genre, mood, setting, and target audience.

Available styles:
${STYLE_NAMES.map((s) => `- ${s}`).join("\n")}

Reply with ONLY the style name, nothing else. If uncertain, default to 吉卜力.`;

export async function selectStyle(
  textConfig: ProviderConfig,
  worldSetting: string,
): Promise<string> {
  const result = await chat(
    textConfig,
    [
      { role: "system", content: SYSTEM },
      { role: "user", content: worldSetting },
    ],
    { temperature: 0, tag: "styleSelector" },
  );

  const picked = result.trim();
  if (STYLE_MAP[picked]) {
    return STYLE_MAP[picked];
  }
  const fuzzy = STYLE_NAMES.find((s) => picked.includes(s) || s.includes(picked));
  if (fuzzy) {
    return STYLE_MAP[fuzzy]!;
  }
  console.warn(`[styleSelector] unrecognized style "${picked}", falling back to 吉卜力`);
  return STYLE_MAP["吉卜力"]!;
}
