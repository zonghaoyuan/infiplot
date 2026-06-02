import type { CharacterVoice, TtsConfig } from "@infiplot/types";

// Xiaomi MiMo currently outputs wav / pcm16 only (mp3 not supported for output).
// The reference clip we persist is therefore wav. Kept as a single switch so we
// can flip to mp3 the day the API supports it.
const OUTPUT_FORMAT = "wav";
const OUTPUT_MIME = "audio/wav";

function buildHeaders(cfg: TtsConfig): HeadersInit {
  return {
    "Content-Type": "application/json",
    "api-key": cfg.apiKey,
  };
}

function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/$/, "")}${path}`;
}

function designModel(cfg: TtsConfig): string {
  return `${cfg.speechModel}-voicedesign`;
}

function cloneModel(cfg: TtsConfig): string {
  return `${cfg.speechModel}-voiceclone`;
}

type ChatAudioResponse = {
  choices?: Array<{ message?: { audio?: { data?: string } } }>;
  error?: { message?: string };
  message?: string;
};

function extractAudio(json: ChatAudioResponse, where: string): string {
  const data = json.choices?.[0]?.message?.audio?.data;
  if (!data) {
    const err = json.error?.message ?? json.message ?? JSON.stringify(json);
    throw new Error(`Xiaomi ${where} returned no audio: ${err.slice(0, 300)}`);
  }
  return data;
}

export async function xiaomiProvision(
  cfg: TtsConfig,
  description: string,
): Promise<CharacterVoice> {
  const url = joinUrl(cfg.baseUrl, "/chat/completions");

  const body = {
    model: designModel(cfg),
    messages: [
      { role: "user", content: description },
      { role: "assistant", content: "你好，这是音色试听样本。" },
    ],
    audio: { format: OUTPUT_FORMAT },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: buildHeaders(cfg),
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Xiaomi voicedesign ${res.status}: ${text.slice(0, 300)}`);
  }

  const json = (await res.json()) as ChatAudioResponse;
  const referenceAudioBase64 = extractAudio(json, "voicedesign");

  return { provider: "xiaomi", referenceAudioBase64, mimeType: OUTPUT_MIME };
}

export async function xiaomiSynthesize(
  cfg: TtsConfig,
  voice: CharacterVoice,
  text: string,
  delivery?: string,
  signal?: AbortSignal,
): Promise<{ audioBase64: string; mimeType: string }> {
  const url = joinUrl(cfg.baseUrl, "/chat/completions");

  // The free-form delivery direction rides in the `user` (director) message,
  // so it shapes the performance without ever being read aloud. The spoken
  // text stays in the `assistant` message, clean.
  const body = {
    model: cloneModel(cfg),
    messages: [
      { role: "user", content: delivery?.trim() ?? "" },
      { role: "assistant", content: text },
    ],
    audio: {
      format: OUTPUT_FORMAT,
      voice: `data:${voice.mimeType};base64,${voice.referenceAudioBase64}`,
    },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: buildHeaders(cfg),
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Xiaomi voiceclone ${res.status}: ${txt.slice(0, 300)}`);
  }

  const json = (await res.json()) as ChatAudioResponse;
  const audioBase64 = extractAudio(json, "voiceclone");

  return { audioBase64, mimeType: OUTPUT_MIME };
}
