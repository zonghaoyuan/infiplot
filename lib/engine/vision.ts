import { interpretClick } from "@infiplot/ai-client";
import type {
  ClickIntent,
  ProviderConfig,
  Scene,
  VisionClassify,
} from "@infiplot/types";
import { parseJsonLoose } from "./jsonParser";
import { VISION_SYSTEM_PROMPT, buildVisionUserPrompt } from "./prompts";

export type VisionInterpretation = {
  intent: ClickIntent;
  classify: VisionClassify;
};

export async function interpret(
  config: ProviderConfig,
  annotatedImageBase64: string,
  scene: Scene | null,
): Promise<VisionInterpretation> {
  const userPrompt = `${VISION_SYSTEM_PROMPT}\n\n${buildVisionUserPrompt(scene)}`;
  const raw = await interpretClick(config, annotatedImageBase64, userPrompt);
  const parsed = parseJsonLoose<{
    freeformAction?: string;
    classify?: string;
    reasoning?: string;
  }>(raw);

  const classify: VisionClassify =
    parsed.classify === "change-scene" ? "change-scene" : "insert-beat";

  return {
    intent: {
      freeformAction: parsed.freeformAction?.trim() || "玩家点了画面，但意图不明",
      reasoning: parsed.reasoning?.trim() || "",
    },
    classify,
  };
}
