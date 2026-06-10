import { proxyLLM, type ProxyLLMParams } from "@/lib/byoProxy";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * BYOK (Bring Your Own Key) LLM User Proxy
 * POST /api/llm/user-proxy
 *
 * Accepts user-provided API keys and transparently proxies requests to
 * upstream LLM providers (OpenAI, Claude, Gemini), solving CORS and privacy.
 *
 * Request Body:
 *   {
 *     provider: "openai" | "claude" | "gemini",
 *     apiKey: string,
 *     baseUrl: string,
 *     body: object,          // upstream request body
 *     model?: string,        // required for Gemini
 *     stream?: boolean       // default true
 *   }
 *
 * Response: Transparent proxy (SSE stream or JSON)
 * Errors: 400 (validation), 502 (upstream error)
 */
export async function POST(req: Request): Promise<Response> {
  let parsed: Partial<ProxyLLMParams>;
  try {
    parsed = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Validate required fields
  const { provider, apiKey, baseUrl, body } = parsed;
  if (!provider || !apiKey || !baseUrl || !body) {
    return NextResponse.json(
      { error: "Missing required fields: provider, apiKey, baseUrl, body" },
      { status: 400 },
    );
  }

  // Validate provider
  if (!["openai", "claude", "gemini"].includes(provider)) {
    return NextResponse.json(
      { error: `Unsupported provider: ${provider}` },
      { status: 400 },
    );
  }

  // Forward to proxy core
  return proxyLLM({
    provider: provider as "openai" | "claude" | "gemini",
    apiKey,
    baseUrl,
    body,
    model: parsed.model,
    stream: parsed.stream,
  });
}
