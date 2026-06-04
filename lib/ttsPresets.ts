// Xiaomi MiMo TTS endpoint presets.
//
// Xiaomi issues two independent key types, each with its own base URL:
//   - Token Plan (套餐, `tp-` key): per-region endpoints token-plan-{sgp,cn,ams}.
//   - Pay-as-you-go (按量, `sk-` key): the single unified endpoint api.xiaomimimo.com.
//
// Used CLIENT-SIDE ONLY: when a user supplies their own key, the browser calls
// one of these endpoints directly (all return permissive CORS allowing the
// `api-key` header), so the key never transits our server. Every endpoint
// serves the same `mimo-v2.5-tts` family; Token Plan users pick the region
// matching their subscription (also the closest hop → lower synth latency),
// pay-as-you-go users have no region to choose. See docs/xiaomi-tts-key.md.

export type TtsPreset = {
  id: string;
  /** Which key family this endpoint serves — drives the two-step picker UI. */
  kind: "token-plan" | "payg";
  /** Human label shown in the picker (region for Token Plan, type for payg). */
  label: string;
  /** OpenAI-style base; the TTS adapter appends `/chat/completions`. */
  baseUrl: string;
};

/** Base model name; the adapter derives `-voicedesign` / `-voiceclone`. */
export const DEFAULT_TTS_SPEECH_MODEL = "mimo-v2.5-tts";

/**
 * In-repo tutorial for getting a free Xiaomi MiMo key + picking a region.
 * Points at the default branch so it resolves once this lands on main (which
 * is what production serves). Linked from the homepage BYO modal, the play
 * page's silence nudge, and the README.
 */
export const TTS_KEY_DOC_URL =
  "https://github.com/zonghaoyuan/infiplot/blob/main/docs/xiaomi-tts-key.md";

export const TTS_PRESETS: TtsPreset[] = [
  {
    id: "sgp",
    kind: "token-plan",
    label: "新加坡 · Singapore",
    baseUrl: "https://token-plan-sgp.xiaomimimo.com/v1",
  },
  {
    id: "cn",
    kind: "token-plan",
    label: "中国大陆 · China",
    baseUrl: "https://token-plan-cn.xiaomimimo.com/v1",
  },
  {
    id: "ams",
    kind: "token-plan",
    label: "欧洲 · Amsterdam",
    baseUrl: "https://token-plan-ams.xiaomimimo.com/v1",
  },
  {
    id: "payg",
    kind: "payg",
    label: "按量付费 · Pay-as-you-go",
    baseUrl: "https://api.xiaomimimo.com/v1",
  },
];

/** Token Plan endpoints only — the region sub-options shown once the user
 *  picks the "套餐" key type. */
export const TTS_REGION_PRESETS = TTS_PRESETS.filter(
  (p) => p.kind === "token-plan",
);

/** The single pay-as-you-go preset id (`sk-` keys have no region). */
export const PAYG_PRESET_ID = "payg";

export function findTtsPreset(
  id: string | null | undefined,
): TtsPreset | undefined {
  if (!id) return undefined;
  return TTS_PRESETS.find((p) => p.id === id);
}
