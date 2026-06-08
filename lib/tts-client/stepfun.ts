import type { CharacterVoice, TtsConfig } from "@infiplot/types";

// StepFun TTS uses an OpenAI-compatible /v1/audio/speech endpoint with PRESET
// voice IDs only — there is no "design a new voice from text description"
// equivalent to Xiaomi MiMo's voicedesign. We therefore translate the LLM's
// Chinese voiceDescription into a preset voice ID by keyword matching
// (gender + age + tone), with a deterministic hash-based spread across the
// top-N candidates so multiple similar characters don't collapse onto the
// same voice. Provision is a pure function — no network call needed.

const OUTPUT_FORMAT = "mp3";
const OUTPUT_MIME = "audio/mpeg";

type PresetVoice = {
  id: string;
  gender: "male" | "female";
  age: "teen" | "young" | "middle";
  /** Keywords (中文 or English) that, when present in the LLM's voice
   *  description, boost this preset's score. Drawn from StepFun's published
   *  voice name + recommended scenario. */
  tones: string[];
};

// Full catalog from StepFun's docs (32 presets across step-tts-mini /
// step-tts-2 / stepaudio-2.5-tts). Adding more later is safe — the scorer
// degrades gracefully when an unknown id is picked.
const PRESET_VOICES: PresetVoice[] = [
  { id: "cixingnansheng", gender: "male", age: "young", tones: ["磁性", "成熟", "narrative"] },
  { id: "wenrounansheng", gender: "male", age: "young", tones: ["温柔", "gentle", "supportive"] },
  { id: "wenrougongzi", gender: "male", age: "young", tones: ["温柔", "公子", "tender"] },
  { id: "yuanqinansheng", gender: "male", age: "teen", tones: ["元气", "energetic", "阳光"] },
  { id: "zhengpaiqingnian", gender: "male", age: "young", tones: ["正派", "正气", "earnest"] },
  { id: "shuangkuainansheng", gender: "male", age: "young", tones: ["爽快", "干脆", "brisk"] },
  { id: "boyinnansheng", gender: "male", age: "middle", tones: ["播音", "broadcast", "稳重"] },
  { id: "ruyananshi", gender: "male", age: "middle", tones: ["儒雅", "斯文", "refined"] },
  { id: "shenchennanyin", gender: "male", age: "middle", tones: ["深沉", "低沉", "deep"] },
  { id: "qingniandaxuesheng", gender: "male", age: "young", tones: ["大学生", "青年", "student"] },
  { id: "zixinnansheng", gender: "male", age: "young", tones: ["自信", "confident"] },
  { id: "elegantgentle-female", gender: "female", age: "young", tones: ["气质", "温婉", "professional"] },
  { id: "livelybreezy-female", gender: "female", age: "teen", tones: ["活力", "轻快", "upbeat"] },
  { id: "jingdiannvsheng", gender: "female", age: "middle", tones: ["经典", "classic", "成熟"] },
  { id: "wenroushunv", gender: "female", age: "middle", tones: ["温柔", "熟女", "mature"] },
  { id: "tianmeinvsheng", gender: "female", age: "young", tones: ["甜美", "sweet"] },
  { id: "qingchunshaonv", gender: "female", age: "teen", tones: ["清纯", "少女", "pure"] },
  { id: "yuanqishaonv", gender: "female", age: "teen", tones: ["元气", "少女", "活力", "energetic"] },
  { id: "linjiajiejie", gender: "female", age: "young", tones: ["邻家", "姐姐"] },
  { id: "jilingshaonv", gender: "female", age: "teen", tones: ["机灵", "灵动", "少女"] },
  { id: "ruanmengnvsheng", gender: "female", age: "teen", tones: ["软萌", "可爱", "稚嫩", "甜软"] },
  { id: "youyanvsheng", gender: "female", age: "young", tones: ["优雅", "elegant"] },
  { id: "lengyanyujie", gender: "female", age: "middle", tones: ["冷艳", "御姐", "高冷"] },
  { id: "shuangkuaijiejie", gender: "female", age: "young", tones: ["爽快", "姐姐", "干脆"] },
  { id: "wenjingxuejie", gender: "female", age: "young", tones: ["文静", "学姐", "安静"] },
  { id: "linjiameimei", gender: "female", age: "teen", tones: ["邻家", "妹妹"] },
  { id: "zhixingjiejie", gender: "female", age: "young", tones: ["知性", "姐姐", "聪慧"] },
  { id: "ganliannvsheng", gender: "female", age: "middle", tones: ["干练", "sharp", "professional"] },
  { id: "qinhenvsheng", gender: "female", age: "young", tones: ["亲和", "warm", "亲切"] },
  { id: "huolinvsheng", gender: "female", age: "young", tones: ["活力", "lively", "活泼"] },
  { id: "qinqienvsheng", gender: "female", age: "middle", tones: ["亲切", "温暖"] },
  { id: "wenrounvsheng", gender: "female", age: "young", tones: ["温柔", "tender", "柔和"] },
];

// Cheap deterministic 32-bit hash — used only to spread similar descriptions
// across the top-N candidate voices so two "温柔女声" characters don't collide.
function hashStr(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function detectGender(desc: string): "male" | "female" {
  // Female signals (broader cast — galgame skews toward female NPCs).
  if (/女性|女声|少女|姐姐|妹妹|熟女|御姐|阿姨|奶奶|女孩|姑娘|大妈|女子|女生|女士|她|小姐/.test(desc)) {
    return "female";
  }
  if (/男性|男声|少年|青年|大叔|哥哥|弟弟|男人|男孩|大爷|爷爷|男子|男生|先生|他|公子|师傅/.test(desc)) {
    return "male";
  }
  // No strong signal: default female (matches the catalog's center of mass).
  return "female";
}

function detectAge(desc: string): "teen" | "young" | "middle" {
  if (/中年|熟女|大叔|大妈|阿姨|奶奶|爷爷|老师|师傅|御姐|经理|总监|教授|博士|总裁|长辈|父亲|母亲|爸爸|妈妈/.test(desc)) {
    return "middle";
  }
  if (/少女|少年|学生|高中|初中|妹妹|弟弟|小学|童年|稚嫩|十几岁|十六|十七|十八|未成年/.test(desc)) {
    return "teen";
  }
  return "young";
}

/** Map an LLM-written 中文 voice description to a StepFun preset voice ID.
 *  Pure function — exported for tests and for the synthesis-time sanity log.
 */
export function pickStepfunVoiceId(description: string, salt = ""): string {
  const desc = description.toLowerCase();
  const gender = detectGender(desc);
  const age = detectAge(desc);

  const scored = PRESET_VOICES
    .filter((v) => v.gender === gender)
    .map((v) => {
      let score = 0;
      if (v.age === age) score += 4;
      for (const tone of v.tones) {
        if (desc.includes(tone.toLowerCase())) score += 2;
      }
      return { v, score };
    })
    .sort((a, b) => b.score - a.score);

  // Catalog can't be filtered to zero; this guards against a future edit
  // that prunes the table too aggressively.
  if (scored.length === 0) return PRESET_VOICES[0]!.id;

  // Pick from the top 3 (or fewer) deterministically by hashing the
  // description + an optional salt (charName) so two characters that share
  // archetype keywords don't collapse onto the identical preset.
  const top = scored.slice(0, Math.min(3, scored.length));
  const idx = hashStr(description + "|" + salt) % top.length;
  return top[idx]!.v.id;
}

// Provision is synchronous / no network — StepFun has no voicedesign equivalent.
// We mirror xiaomiProvision's async signature so the router stays uniform.
export async function stepfunProvision(
  cfg: TtsConfig,
  description: string,
): Promise<CharacterVoice> {
  const voiceId = pickStepfunVoiceId(description);
  return {
    provider: "stepfun",
    voiceId,
    model: cfg.speechModel,
    mimeType: OUTPUT_MIME,
  };
}

export async function stepfunSynthesize(
  cfg: TtsConfig,
  voice: CharacterVoice,
  text: string,
  _delivery?: string,
  signal?: AbortSignal,
): Promise<{ audioBase64: string; mimeType: string }> {
  if (voice.provider !== "stepfun") {
    throw new Error(
      `stepfunSynthesize received non-stepfun voice (provider="${voice.provider}")`,
    );
  }

  // Strip trailing slash so /v1 + /audio/speech doesn't double up.
  const base = cfg.baseUrl.replace(/\/$/, "");
  const url = `${base}/audio/speech`;

  const body = {
    model: voice.model || cfg.speechModel,
    input: text,
    voice: voice.voiceId,
    response_format: OUTPUT_FORMAT,
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`StepFun TTS ${res.status}: ${txt.slice(0, 300)}`);
  }

  const ab = await res.arrayBuffer();
  // Buffer is fine here — TTS routes run on runtime="nodejs". Falls back to
  // btoa+chunks if we ever target Edge.
  const audioBase64 = Buffer.from(ab).toString("base64");
  return { audioBase64, mimeType: OUTPUT_MIME };
}
