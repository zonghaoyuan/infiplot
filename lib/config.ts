import "server-only";

import type {
  ByoLlmKeys,
  EngineConfig,
  ProviderConfig,
  ProviderProtocol,
  TtsConfig,
} from "@infiplot/types";
import { validateUpstreamUrl, normalizeBaseUrl } from "./byoProxy";

const VALID_PROTOCOLS = [
  "openai_compatible",
  "anthropic",
  "google",
  "openai",
  "runware",
] as const;

function readVar(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required environment variable: ${name}`);
  return v;
}

function readOptionalVar(name: string): string | undefined {
  const v = process.env[name];
  return v && v.length > 0 ? v : undefined;
}

// Optional *_PROVIDER selector. Unset → undefined, and each ai-client adapter
// applies its own default (text/vision → openai_compatible; image → inferred
// from the base URL). Validated eagerly so a typo fails fast at boot rather
// than mid-request.
function readProvider(name: string): ProviderProtocol | undefined {
  const v = readOptionalVar(name)?.trim().toLowerCase();
  if (!v) return undefined;
  if ((VALID_PROTOCOLS as readonly string[]).includes(v)) {
    return v as ProviderProtocol;
  }
  throw new Error(
    `Invalid ${name}: "${v}". Must be one of: ${VALID_PROTOCOLS.join(", ")}`,
  );
}

function loadTtsConfig(): TtsConfig | undefined {
  const baseUrl = readOptionalVar("TTS_BASE_URL");
  const apiKey = readOptionalVar("TTS_API_KEY");
  const speechModel = readOptionalVar("TTS_SPEECH_MODEL");

  // Missing any → TTS disabled (game runs silently).
  if (!baseUrl || !apiKey || !speechModel) return undefined;

  return { baseUrl, apiKey, speechModel };
}

export function loadEngineConfig(): EngineConfig {
  return {
    text: {
      baseUrl: readVar("TEXT_BASE_URL"),
      apiKey: readVar("TEXT_API_KEY"),
      model: readVar("TEXT_MODEL"),
      provider: readProvider("TEXT_PROVIDER"),
    },
    image: {
      baseUrl: readVar("IMAGE_BASE_URL"),
      apiKey: readVar("IMAGE_API_KEY"),
      model: readVar("IMAGE_MODEL"),
      provider: readProvider("IMAGE_PROVIDER"),
    },
    vision: {
      baseUrl: readVar("VISION_BASE_URL"),
      apiKey: readVar("VISION_API_KEY"),
      model: readVar("VISION_MODEL"),
      provider: readProvider("VISION_PROVIDER"),
    },
    tts: loadTtsConfig(),
    mockImage: readOptionalVar("MOCK_IMAGE") === "true",
  };
}

// ── BYOK (Bring Your Own Key) ────────────────────────────────────────────

/** Provider default base URLs when user doesn't specify one. */
const PROVIDER_DEFAULTS: Record<string, string> = {
  openai: "https://api.openai.com",
  claude: "https://api.anthropic.com",
  gemini: "https://generativelanguage.googleapis.com",
};

/** Provider default models when user doesn't specify one. */
const MODEL_DEFAULTS: Record<string, { text: string; image: string; vision: string }> = {
  openai: {
    text: "gpt-4o",
    image: "gpt-image-1", // CR-4: 支持任意尺寸，dall-e-3 不支持 1536x1024
    vision: "gpt-4o",
  },
  claude: {
    text: "claude-3-5-sonnet-20241022",
    image: "claude-3-5-sonnet-20241022", // Claude doesn't have native image gen
    vision: "claude-3-5-sonnet-20241022",
  },
  gemini: {
    text: "gemini-2.0-flash-exp",
    image: "imagen-3.0-generate-001",
    vision: "gemini-2.0-flash-exp",
  },
};

type ByoRole = "text" | "image" | "vision";
type ByoProviderConfig = { provider: string; apiKey: string; baseUrl?: string; model?: string };

/**
 * Build ProviderConfig from user-supplied BYOK credentials.
 * Validates upstream URL (SSRF protection), normalizes baseUrl, applies defaults.
 * Throws on validation failure so API route can return 400.
 */
function buildByoProviderConfig(
  role: ByoRole,
  byo: ByoProviderConfig,
  fallback: ProviderConfig,
): ProviderConfig {
  const { provider, apiKey, baseUrl } = byo;

  // Validate provider
  if (!["openai", "claude", "gemini"].includes(provider)) {
    throw new Error(`Invalid BYO provider for ${role}: ${provider}`);
  }

  // Claude/Gemini cannot generate images — only OpenAI supports image generation
  if (role === "image" && provider !== "openai") {
    throw new Error(
      `BYO provider "${provider}" does not support image generation. Use "openai" for the image role.`,
    );
  }

  // Validate apiKey
  if (!apiKey?.trim()) {
    throw new Error(`Missing BYO apiKey for ${role}`);
  }

  // Resolve baseUrl (user-provided or provider default)
  let resolvedBaseUrl = baseUrl?.trim() || PROVIDER_DEFAULTS[provider];
  if (!resolvedBaseUrl) {
    throw new Error(`No baseUrl for BYO ${role} provider: ${provider}`);
  }
  resolvedBaseUrl = normalizeBaseUrl(resolvedBaseUrl);

  // SSRF protection — validates the HOST portion of the URL.
  // SAFETY INVARIANT: ai-client/normalizeUrl.ts only appends PATH segments
  // (e.g. /v1) but never changes the host/authority. If that invariant ever
  // breaks, this check must be moved downstream or duplicated. (CR-9)
  const validation = validateUpstreamUrl(resolvedBaseUrl);
  if (!validation.valid) {
    throw new Error(`Invalid BYO baseUrl for ${role}: ${validation.error}`);
  }

  // Resolve model (user-provided > provider default > official model)
  const modelDefaults = MODEL_DEFAULTS[provider];
  const model = byo.model?.trim() || modelDefaults?.[role] || fallback.model;

  // Map provider string to ProviderProtocol
  let providerProtocol: ProviderProtocol;
  if (provider === "openai") {
    providerProtocol = "openai";
  } else if (provider === "claude") {
    providerProtocol = "anthropic";
  } else if (provider === "gemini") {
    providerProtocol = "google";
  } else {
    providerProtocol = "openai_compatible";
  }

  return {
    baseUrl: resolvedBaseUrl,
    apiKey: apiKey.trim(),
    model,
    provider: providerProtocol,
  };
}

/**
 * Build EngineConfig with BYOK (Bring Your Own Key) overrides.
 * - `byo` param contains user-provided keys from request body (StartRequest.byo / SceneRequest.byo)
 * - For each role (text/image/vision), if user provided BYO config, use it; otherwise fallback to official keys
 * - Validates all BYO baseUrls (SSRF protection) and throws on failure
 */
export function buildByoEngineConfig(
  byo: ByoLlmKeys,
  officialConfig: EngineConfig,
): EngineConfig {
  return {
    text: byo.text
      ? buildByoProviderConfig("text", byo.text, officialConfig.text)
      : officialConfig.text,
    image: byo.image
      ? buildByoProviderConfig("image", byo.image, officialConfig.image)
      : officialConfig.image,
    vision: byo.vision
      ? buildByoProviderConfig("vision", byo.vision, officialConfig.vision)
      : officialConfig.vision,
    tts: officialConfig.tts, // TTS BYOK stays client-side only (existing flow)
    mockImage: officialConfig.mockImage,
  };
}
