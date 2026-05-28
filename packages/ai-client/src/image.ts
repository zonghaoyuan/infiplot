import type { ProviderConfig } from "@yume/types";
import { fetchWithRetry } from "./fetchWithRetry";

// Runware uses its own task-array protocol (not OpenAI-compatible).
// POST <baseUrl> with [{ taskType: "imageInference", ... }]; errors come
// back as a 200 with `errors[]`, so we have to inspect the body either way.
type RunwareImageResult = {
  imageBase64Data?: string;
};
type RunwareError = {
  code?: string;
  message?: string;
  parameter?: string;
};
type RunwareResponse = {
  data?: RunwareImageResult[];
  errors?: RunwareError[];
};

export async function generateImage(
  config: ProviderConfig,
  prompt: string,
): Promise<string> {
  const url = config.baseUrl.replace(/\/$/, "");

  const body = [
    {
      taskType: "imageInference",
      taskUUID: crypto.randomUUID(),
      model: config.model,
      positivePrompt: prompt,
      width: 1792,
      height: 1024,
      steps: 4,
      CFGScale: 3.5,
      numberResults: 1,
      outputType: "base64Data",
      outputFormat: "PNG",
    },
  ];

  const res = await fetchWithRetry(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  let json: RunwareResponse;
  try {
    json = JSON.parse(text) as RunwareResponse;
  } catch {
    throw new Error(`Image API error ${res.status}: ${text.slice(0, 500)}`);
  }

  if (json.errors?.length) {
    const e = json.errors[0]!;
    throw new Error(
      `Runware error [${e.code ?? "unknown"}]: ${e.message ?? "no message"}` +
        (e.parameter ? ` (parameter: ${e.parameter})` : ""),
    );
  }

  const b64 = json.data?.[0]?.imageBase64Data;
  if (!b64) {
    throw new Error(
      `No image in Runware response: ${text.slice(0, 300)}`,
    );
  }
  return b64;
}
