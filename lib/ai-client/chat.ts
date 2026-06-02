import type { ProviderConfig } from "@infiplot/types";
import { fetchWithRetry } from "./fetchWithRetry";

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export async function chat(
  config: ProviderConfig,
  messages: ChatMessage[],
  opts?: { temperature?: number; responseFormat?: "json_object" | "text" },
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

  let json: { choices: { message: { content: string } }[] };
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

  return content;
}
