import { generateText } from "ai";
import type { ModelMessage } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { ProviderConfig, ProviderProtocol } from "@infiplot/types";
import { fetchWithRetry } from "./fetchWithRetry";
import { normalizeBaseUrl } from "./normalizeUrl";

const VISION_TIMEOUT_MS = 60_000;

export async function interpretClick(
  config: ProviderConfig,
  imageBase64: string,
  prompt: string,
): Promise<string> {
  // Wrap the raw base64 in a PNG data URL — the Canvas annotator on the
  // client encodes as PNG. analyzeImageDataUrl handles the actual request.
  return analyzeImageDataUrl(
    config,
    `data:image/png;base64,${imageBase64}`,
    prompt,
    { responseFormat: "json_object" },
  );
}

// text/vision default to the OpenAI-compatible wire protocol when unset.
function resolveVisionProtocol(config: ProviderConfig): ProviderProtocol {
  return config.provider ?? "openai_compatible";
}

/**
 * General single-image vision call. Accepts a complete data URL (preserves
 * the source mime type, e.g. webp/jpeg) and lets the caller opt out of
 * `response_format: json_object` for free-form text responses.
 */
export async function analyzeImageDataUrl(
  config: ProviderConfig,
  imageDataUrl: string,
  prompt: string,
  opts: { responseFormat?: "json_object" | "text" } = {},
): Promise<string> {
  const protocol = resolveVisionProtocol(config);
  if (protocol === "anthropic" || protocol === "google") {
    return analyzeViaAiSdk(config, imageDataUrl, prompt, protocol);
  }
  return analyzeOpenAiCompatible(config, imageDataUrl, prompt, opts);
}

// Native Anthropic / Gemini multimodal via the AI SDK. The image part takes
// the full data URL directly; the SDK decodes it. response_format is not sent
// (no JSON mode on Anthropic) — the engine's parseJsonLoose handles output.
async function analyzeViaAiSdk(
  config: ProviderConfig,
  imageDataUrl: string,
  prompt: string,
  protocol: "anthropic" | "google",
): Promise<string> {
  const baseURL = normalizeBaseUrl(config.baseUrl, protocol);
  const model =
    protocol === "anthropic"
      ? createAnthropic({ apiKey: config.apiKey, baseURL })(config.model)
      : createGoogleGenerativeAI({ apiKey: config.apiKey, baseURL })(
          config.model,
        );

  const messages: ModelMessage[] = [
    {
      role: "user",
      content: [
        { type: "text", text: prompt },
        { type: "image", image: imageDataUrl },
      ],
    },
  ];

  const timeoutCtrl = new AbortController();
  const timeoutId = setTimeout(() => timeoutCtrl.abort(), VISION_TIMEOUT_MS);
  try {
    const { text } = await generateText({
      model,
      messages,
      temperature: 0.2,
      abortSignal: timeoutCtrl.signal,
    });
    if (typeof text !== "string" || text.length === 0) {
      throw new Error(`Vision API (AI SDK ${protocol}) returned no content.`);
    }
    return text;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function analyzeOpenAiCompatible(
  config: ProviderConfig,
  imageDataUrl: string,
  prompt: string,
  opts: { responseFormat?: "json_object" | "text" } = {},
): Promise<string> {
  const url = `${normalizeBaseUrl(config.baseUrl, "openai_compatible")}/chat/completions`;

  const body: Record<string, unknown> = {
    model: config.model,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          { type: "image_url", image_url: { url: imageDataUrl } },
        ],
      },
    ],
    temperature: 0.2,
  };
  if (opts.responseFormat === "json_object") {
    body.response_format = { type: "json_object" };
  }

  const timeoutCtrl = new AbortController();
  const timeoutId = setTimeout(() => timeoutCtrl.abort(), VISION_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetchWithRetry(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: timeoutCtrl.signal,
      retries: 0,
    });
  } finally {
    clearTimeout(timeoutId);
  }

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Vision API error ${res.status}: ${text}`);
  }

  let json: { choices: { message: { content: string } }[] };
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Vision API returned invalid JSON: ${text.slice(0, 500)}`);
  }

  // Guard against empty choices array or missing message/content fields
  const content = json.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    throw new Error(
      `Vision API returned no content. Response: ${text.slice(0, 500)}`
    );
  }

  return content;
}
