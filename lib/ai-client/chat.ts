import { generateText } from "ai";
import type { LanguageModelUsage, ModelMessage } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { ProviderConfig, ProviderProtocol } from "@infiplot/types";
import { fetchWithRetry } from "./fetchWithRetry";
import { normalizeBaseUrl } from "./normalizeUrl";

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

// Different providers expose prompt-cache stats under different keys. We probe
// for the three forms we've seen in the wild and fall back to total tokens
// when no cache field exists.
//
//   DeepSeek (v3+)    usage.prompt_cache_hit_tokens / prompt_cache_miss_tokens
//   OpenAI / o-series usage.prompt_tokens_details.cached_tokens
//   Anthropic / others  usage.cache_read_input_tokens / cache_creation_input_tokens
//   No-cache (MiMo,
//     local Ollama, …) only prompt_tokens / completion_tokens — print those
//                       so we still get a rough cost baseline.
type Usage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  prompt_cache_hit_tokens?: number;
  prompt_cache_miss_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number };
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
};

function summarizeUsage(tag: string, usage: Usage | undefined): string {
  if (!usage) return `[cache] ${tag} no-usage`;
  const prompt = usage.prompt_tokens ?? 0;
  const completion = usage.completion_tokens ?? 0;
  // DeepSeek-style
  if (typeof usage.prompt_cache_hit_tokens === "number") {
    const hit = usage.prompt_cache_hit_tokens;
    const miss = usage.prompt_cache_miss_tokens ?? Math.max(0, prompt - hit);
    const denom = hit + miss;
    const rate = denom > 0 ? ((hit / denom) * 100).toFixed(1) : "n/a";
    return `[cache] ${tag} hit=${hit} miss=${miss} rate=${rate}% completion=${completion}`;
  }
  // OpenAI-style
  const oaiCached = usage.prompt_tokens_details?.cached_tokens;
  if (typeof oaiCached === "number") {
    const miss = Math.max(0, prompt - oaiCached);
    const rate = prompt > 0 ? ((oaiCached / prompt) * 100).toFixed(1) : "n/a";
    return `[cache] ${tag} hit=${oaiCached} miss=${miss} rate=${rate}% completion=${completion}`;
  }
  // Anthropic-style
  if (typeof usage.cache_read_input_tokens === "number") {
    const hit = usage.cache_read_input_tokens;
    const create = usage.cache_creation_input_tokens ?? 0;
    const denom = hit + create + prompt;
    const rate = denom > 0 ? ((hit / denom) * 100).toFixed(1) : "n/a";
    return `[cache] ${tag} hit=${hit} create=${create} miss=${prompt} rate=${rate}% completion=${completion}`;
  }
  // No cache field at all
  return `[cache] ${tag} prompt=${prompt} completion=${completion} (provider didn't report cache stats)`;
}

// AI SDK 6 unifies cache stats across providers into usage.inputTokenDetails,
// so a single shape covers Anthropic + Gemini (no per-provider probing).
function summarizeSdkUsage(
  tag: string,
  usage: LanguageModelUsage | undefined,
): string {
  if (!usage) return `[cache] ${tag} no-usage`;
  const input = usage.inputTokens ?? 0;
  const output = usage.outputTokens ?? 0;
  const read = usage.inputTokenDetails?.cacheReadTokens;
  const write = usage.inputTokenDetails?.cacheWriteTokens;
  if (typeof read === "number" || typeof write === "number") {
    const hit = read ?? 0;
    const create = write ?? 0;
    const rate = input > 0 ? ((hit / input) * 100).toFixed(1) : "n/a";
    return `[cache] ${tag} hit=${hit} create=${create} input=${input} rate=${rate}% completion=${output}`;
  }
  return `[cache] ${tag} input=${input} completion=${output} (provider didn't report cache stats)`;
}

// text/vision default to the OpenAI-compatible wire protocol when unset.
function resolveTextProtocol(config: ProviderConfig): ProviderProtocol {
  return config.provider ?? "openai_compatible";
}

export async function chat(
  config: ProviderConfig,
  messages: ChatMessage[],
  opts?: {
    temperature?: number;
    responseFormat?: "json_object" | "text";
    tag?: string;
  },
): Promise<string> {
  const protocol = resolveTextProtocol(config);
  if (protocol === "anthropic" || protocol === "google") {
    return chatViaAiSdk(config, messages, opts, protocol);
  }
  return chatOpenAiCompatible(config, messages, opts);
}

// Native Anthropic / Gemini via the Vercel AI SDK. response_format is not sent
// (Anthropic has no JSON mode); the engine relies on parseJsonLoose downstream,
// matching how it already tolerates loose JSON from every provider.
async function chatViaAiSdk(
  config: ProviderConfig,
  messages: ChatMessage[],
  opts: { temperature?: number; tag?: string } | undefined,
  protocol: "anthropic" | "google",
): Promise<string> {
  const baseURL = normalizeBaseUrl(config.baseUrl, protocol);
  const model =
    protocol === "anthropic"
      ? createAnthropic({ apiKey: config.apiKey, baseURL })(config.model)
      : createGoogleGenerativeAI({ apiKey: config.apiKey, baseURL })(
          config.model,
        );

  const system = messages.find((m) => m.role === "system")?.content;
  const convo: ModelMessage[] = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

  const { text, usage } = await generateText({
    model,
    system,
    messages: convo,
    temperature: opts?.temperature ?? 0.9,
  });

  console.log(summarizeSdkUsage(opts?.tag ?? "chat", usage));

  if (typeof text !== "string" || text.length === 0) {
    throw new Error(`Chat API (AI SDK ${protocol}) returned no content.`);
  }
  return text;
}

async function chatOpenAiCompatible(
  config: ProviderConfig,
  messages: ChatMessage[],
  opts?: {
    temperature?: number;
    responseFormat?: "json_object" | "text";
    tag?: string;
  },
): Promise<string> {
  const url = `${normalizeBaseUrl(config.baseUrl, "openai_compatible")}/chat/completions`;
  const body: Record<string, unknown> = {
    model: config.model,
    messages,
    temperature: opts?.temperature ?? 0.9,
  };
  if (opts?.responseFormat === "json_object") {
    body.response_format = { type: "json_object" };
  }

  const res = await fetchWithRetry(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Chat API error ${res.status}: ${text}`);
  }

  let json: {
    choices: { message: { content: string } }[];
    usage?: Usage;
  };
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Chat API returned invalid JSON: ${text.slice(0, 500)}`);
  }

  // Guard against empty choices array or missing message/content fields
  const content = json.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    throw new Error(
      `Chat API returned no content. Response: ${text.slice(0, 500)}`
    );
  }

  console.log(summarizeUsage(opts?.tag ?? "chat", json.usage));

  return content;
}
