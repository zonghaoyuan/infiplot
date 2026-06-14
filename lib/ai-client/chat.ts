import OpenAI from "openai";
import type { ProviderConfig } from "@infiplot/types";
import { normalizeBaseUrl } from "./normalizeUrl";

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

// Cache observability for the prompt-prefix caching that the Writer stable
// prefix relies on. The OpenAI usage object reports only cached READS
// (prompt_tokens_details.cached_tokens) and has no field for cache WRITES
// (tokens written to the cache on a cold pass), so unlike the old AI SDK
// path we can show the hit rate but not the create cost. cached_tokens lives
// directly on the SDK's CompletionUsage type — no cast needed.
function summarizeSdkUsage(
  tag: string,
  usage: OpenAI.Completions.CompletionUsage | undefined,
): string {
  if (!usage) return `[cache] ${tag} no-usage`;
  const input = usage.prompt_tokens ?? 0;
  const output = usage.completion_tokens ?? 0;
  const cached = usage.prompt_tokens_details?.cached_tokens;
  if (typeof cached === "number") {
    const rate = input > 0 ? ((cached / input) * 100).toFixed(1) : "n/a";
    return `[cache] ${tag} hit=${cached} input=${input} rate=${rate}% completion=${output}`;
  }
  return `[cache] ${tag} input=${input} completion=${output} (provider didn't report cache stats)`;
}

export async function chat(
  config: ProviderConfig,
  messages: ChatMessage[],
  opts?: {
    temperature?: number;
    tag?: string;
  },
): Promise<string> {
  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: normalizeBaseUrl(config.baseUrl, "openai_compatible"),
    maxRetries: 0,
    dangerouslyAllowBrowser: true,
  });

  const completion = await client.chat.completions.create({
    model: config.model,
    messages: messages.map((m) => ({
      role: m.role as "system" | "user" | "assistant",
      content: m.content,
    })),
    temperature: opts?.temperature ?? 0.9,
    stream: false,
  });

  const text = completion.choices[0]?.message?.content ?? "";
  console.log(summarizeSdkUsage(opts?.tag ?? "chat", completion.usage ?? undefined));

  if (text.length === 0) {
    throw new Error(`Chat API returned no content.`);
  }
  return text;
}
