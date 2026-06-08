import type { CharacterVoice, TtsConfig } from "@infiplot/types";
import { stepfunProvision, stepfunSynthesize } from "./stepfun";
import { xiaomiProvision, xiaomiSynthesize } from "./xiaomi";

// Provider auto-detection by base URL — mirrors the image client convention
// of inferring Runware from *.runware.ai and falling back otherwise. Keeps
// the BYO client flow unchanged: TTS_PROVIDER env var stays unused, and
// browser-side keys (Xiaomi only today) keep working through the xiaomi path.
function isStepfun(cfg: TtsConfig): boolean {
  return /(^|[./])stepfun\.com\b/i.test(cfg.baseUrl);
}

export async function provisionVoice(
  cfg: TtsConfig,
  description: string,
): Promise<CharacterVoice> {
  return isStepfun(cfg)
    ? stepfunProvision(cfg, description)
    : xiaomiProvision(cfg, description);
}

// Dispatch by the voice's own provider tag, not by the current config. A
// session can outlive a provider switch (e.g. .env.local flip mid-game), and
// each voice must be synthesized via the protocol that minted it. The cfg
// still needs to point at the matching provider's endpoint; mismatch surfaces
// as a transparent network error, which `synthesizeBeat` already swallows.
export async function synthesize(
  cfg: TtsConfig,
  voice: CharacterVoice,
  text: string,
  delivery?: string,
  signal?: AbortSignal,
): Promise<{ audioBase64: string; mimeType: string }> {
  if (voice.provider === "stepfun") {
    return stepfunSynthesize(cfg, voice, text, delivery, signal);
  }
  return xiaomiSynthesize(cfg, voice, text, delivery, signal);
}
