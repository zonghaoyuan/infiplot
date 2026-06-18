import { proxyLLM, type ProxyLLMParams } from "@/lib/byoProxy";
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/supabase/guard";

export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
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
