import type { ProviderConfig } from "@infiplot/types";
import { fetchWithRetry } from "./fetchWithRetry";

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

export async function chat(
  config: ProviderConfig,
  messages: ChatMessage[],
  opts?: {
    temperature?: number;
    responseFormat?: "json_object" | "text";
    tag?: string;
  },
): Promise<string> {
  const url = `${config.baseUrl.replace(/\/$/, "")}/chat/completions`;
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
