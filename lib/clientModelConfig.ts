import type { EngineConfig, ProviderProtocol } from "@infiplot/types";

// Bring-your-own model keys — stored CLIENT-SIDE ONLY.
//
// When a user supplies their own text/image/vision API credentials, we persist
// them in localStorage and the browser talks to providers directly. The keys
// are therefore never sent to our server: no request body, no header, no log.

const STORAGE_KEY = "infiplot:model";

const VALID_PROTOCOLS: ProviderProtocol[] = [
  "openai_compatible",
  "openai",
  "runware",
];

export type StoredModelConfig = {
  textBaseUrl: string;
  textApiKey: string;
  textModel: string;
  textProvider?: ProviderProtocol;
  imageBaseUrl: string;
  imageApiKey: string;
  imageModel: string;
  imageProvider?: ProviderProtocol;
  visionBaseUrl: string;
  visionApiKey: string;
  visionModel: string;
  visionProvider?: ProviderProtocol;
};

function isValidProtocol(p: string): p is ProviderProtocol {
  return (VALID_PROTOCOLS as readonly string[]).includes(p);
}

function readProtocol(raw: unknown): ProviderProtocol | undefined {
  if (typeof raw === "string" && isValidProtocol(raw)) return raw;
  return undefined;
}

/** Read + validate the persisted model config. Returns null when running on the
 *  server, when nothing is stored, on parse failure, or when required fields are
 *  missing. */
export function readStoredModelConfig(): StoredModelConfig | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredModelConfig>;

    const textBaseUrl = typeof parsed.textBaseUrl === "string" ? parsed.textBaseUrl.trim() : "";
    const textApiKey = typeof parsed.textApiKey === "string" ? parsed.textApiKey.trim() : "";
    const textModel = typeof parsed.textModel === "string" ? parsed.textModel.trim() : "";
    const imageBaseUrl = typeof parsed.imageBaseUrl === "string" ? parsed.imageBaseUrl.trim() : "";
    const imageApiKey = typeof parsed.imageApiKey === "string" ? parsed.imageApiKey.trim() : "";
    const imageModel = typeof parsed.imageModel === "string" ? parsed.imageModel.trim() : "";
    const visionBaseUrl = typeof parsed.visionBaseUrl === "string" ? parsed.visionBaseUrl.trim() : "";
    const visionApiKey = typeof parsed.visionApiKey === "string" ? parsed.visionApiKey.trim() : "";
    const visionModel = typeof parsed.visionModel === "string" ? parsed.visionModel.trim() : "";

    if (
      !textBaseUrl ||
      !textApiKey ||
      !textModel ||
      !imageBaseUrl ||
      !imageApiKey ||
      !imageModel ||
      !visionBaseUrl ||
      !visionApiKey ||
      !visionModel
    ) {
      return null;
    }

    return {
      textBaseUrl,
      textApiKey,
      textModel,
      textProvider: readProtocol(parsed.textProvider),
      imageBaseUrl,
      imageApiKey,
      imageModel,
      imageProvider: readProtocol(parsed.imageProvider),
      visionBaseUrl,
      visionApiKey,
      visionModel,
      visionProvider: readProtocol(parsed.visionProvider),
    };
  } catch {
    return null;
  }
}

/** Persist the model config. Trims all string fields so trailing whitespace
 *  from pastes never breaks headers. */
export function writeStoredModelConfig(config: StoredModelConfig): void {
  if (typeof window === "undefined") return;
  try {
    const payload: StoredModelConfig = {
      textBaseUrl: config.textBaseUrl.trim(),
      textApiKey: config.textApiKey.trim(),
      textModel: config.textModel.trim(),
      textProvider: config.textProvider,
      imageBaseUrl: config.imageBaseUrl.trim(),
      imageApiKey: config.imageApiKey.trim(),
      imageModel: config.imageModel.trim(),
      imageProvider: config.imageProvider,
      visionBaseUrl: config.visionBaseUrl.trim(),
      visionApiKey: config.visionApiKey.trim(),
      visionModel: config.visionModel.trim(),
      visionProvider: config.visionProvider,
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Storage disabled / quota / private mode — BYO simply stays off.
  }
}

export function clearStoredModelConfig(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

/** Build a full EngineConfig from stored model config + optional TTS config.
 *  Throws when model config is missing so callers can surface a friendly
 *  "please configure" message. */
export function resolveEngineConfig(
  model: StoredModelConfig | null,
  tts: import("@infiplot/types").TtsConfig | null,
): EngineConfig {
  if (!model) {
    throw new Error("模型配置未设置。请返回首页，点击「模型设置」配置 API 参数。");
  }
  return {
    text: {
      baseUrl: model.textBaseUrl,
      apiKey: model.textApiKey,
      model: model.textModel,
      provider: model.textProvider,
    },
    image: {
      baseUrl: model.imageBaseUrl,
      apiKey: model.imageApiKey,
      model: model.imageModel,
      provider: model.imageProvider,
    },
    vision: {
      baseUrl: model.visionBaseUrl,
      apiKey: model.visionApiKey,
      model: model.visionModel,
      provider: model.visionProvider,
    },
    tts: tts ?? undefined,
    mockImage: false,
  };
}
