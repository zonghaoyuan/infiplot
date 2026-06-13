import { generateText, streamText } from "ai";
import type { LanguageModelUsage, ModelMessage } from "ai";
import type { ChatStreamResult, ProviderConfig } from "@infiplot/types";
import { createLanguageModel, resolveProtocol } from "./model";

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

// AI SDK 6 unifies cache stats across providers into usage.inputTokenDetails,
// so a single shape covers Anthropic, Gemini, and OpenAI-compatible providers.
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

/** Split a ChatMessage[] into the single `system` string + the user/assistant
 *  conversation the AI SDK expects. Shared by chat() and chatStream(). */
function splitMessages(messages: ChatMessage[]): {
  system: string | undefined;
  convo: ModelMessage[];
} {
  const system = messages.find((m) => m.role === "system")?.content;
  const convo: ModelMessage[] = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));
  return { system, convo };
}

export async function chat(
  config: ProviderConfig,
  messages: ChatMessage[],
  opts?: {
    temperature?: number;
    tag?: string;
  },
): Promise<string> {
  const protocol = resolveProtocol(config);
  const model = createLanguageModel(config, protocol);

  const { system, convo } = splitMessages(messages);

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

/**
 * Streaming variant of {@link chat} — the AIGatewayPort streaming primitive
 * behind paradigm D. Returns incremental `textStream` chunks plus an
 * end-of-stream `usage` promise (so `summarizeSdkUsage` keeps doing cache
 * accounting on the output-side stream exactly as the non-streaming path does).
 *
 * Reuses the same protocol/model resolution as {@link chat}; the only new
 * dependency is AI SDK `streamText`. The returned `usage` settles after the
 * stream drains, so callers should `await result.usage` once iteration ends.
 *
 * Degrade path (Req 1.5): if `streamText` itself throws synchronously (provider
 * doesn't support streaming, bad config), fall back to a single `generateText`
 * call wrapped as a one-chunk stream so downstream tag-routing still works —
 * the player loses progressive playback but the scene generates normally.
 */
export function chatStream(
  config: ProviderConfig,
  messages: ChatMessage[],
  opts?: {
    temperature?: number;
    tag?: string;
  },
): ChatStreamResult {
  const protocol = resolveProtocol(config);
  const model = createLanguageModel(config, protocol);
  const { system, convo } = splitMessages(messages);
  const tag = opts?.tag ?? "chatStream";

  try {
    const result = streamText({
      model,
      system,
      messages: convo,
      temperature: opts?.temperature ?? 0.9,
    });

    // Log cache stats once usage settles, mirroring chat(); never let a usage
    // read reject the caller's flow. result.usage is PromiseLike (no .catch),
    // so wrap with Promise.resolve() for a full Promise.
    const usage = Promise.resolve(result.usage)
      .then((u: LanguageModelUsage) => {
        console.log(summarizeSdkUsage(tag, u));
        return u;
      })
      .catch((err: unknown) => {
        console.warn(`[cache] ${tag} usage unavailable:`, err);
        return undefined;
      });

    return { textStream: result.textStream, usage };
  } catch (err) {
    // Synchronous streamText failure → degrade to ONE buffered generateText
    // call, shared between textStream and usage (never call the model twice).
    console.warn(
      `[chatStream] streaming unavailable (AI SDK ${protocol}), degrading to generateText:`,
      err,
    );
    const buffered = generateText({
      model,
      system,
      messages: convo,
      temperature: opts?.temperature ?? 0.9,
    });
    const textStream = (async function* (): AsyncIterable<string> {
      const { text } = await buffered;
      if (typeof text === "string" && text.length > 0) {
        yield text;
      }
    })();
    const usage = buffered
      .then(({ usage: u }) => {
        console.log(summarizeSdkUsage(`${tag}:degraded`, u));
        return u;
      })
      .catch((e) => {
        console.warn(`[cache] ${tag}:degraded usage unavailable:`, e);
        return undefined;
      });
    return { textStream, usage };
  }
}
