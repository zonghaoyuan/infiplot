import "server-only";

/**
 * BYOK (Bring Your Own Key) LLM Proxy
 * Core logic for proxying user-provided API keys to upstream LLM providers.
 * Handles SSRF防护, base URL normalization, and SSE streaming.
 */

// ── SSRF Protection ──────────────────────────────────────────────────────

const INTERNAL_IP_PATTERNS = [
  /^127\./,           // localhost
  /^10\./,            // 10.0.0.0/8
  /^172\.(1[6-9]|2\d|3[01])\./, // 172.16.0.0/12
  /^192\.168\./,      // 192.168.0.0/16
  /^169\.254\./,      // link-local
  /^::1$/,            // IPv6 localhost
  /^fe80:/,           // IPv6 link-local
  /^fc00:/,           // IPv6 private
];

/**
 * Validate upstream URL to prevent SSRF attacks.
 * Only allows https:// and rejects internal IPs.
 */
export function validateUpstreamUrl(url: string): { valid: boolean; error?: string } {
  try {
    const parsed = new URL(url);

    // Only https allowed (no http, file, etc.)
    if (parsed.protocol !== "https:") {
      return { valid: false, error: "Only https:// URLs are allowed" };
    }

    // Reject internal IPs
    const hostname = parsed.hostname.toLowerCase();
    if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1") {
      return { valid: false, error: "Localhost not allowed" };
    }

    // Check IP patterns
    for (const pattern of INTERNAL_IP_PATTERNS) {
      if (pattern.test(hostname)) {
        return { valid: false, error: "Internal IP ranges not allowed" };
      }
    }

    return { valid: true };
  } catch {
    return { valid: false, error: "Invalid URL" };
  }
}

// ── Base URL Normalization ───────────────────────────────────────────────

/**
 * Normalize base URL: add https:// prefix if missing, strip trailing slashes.
 */
export function normalizeBaseUrl(url: string): string {
  let cleaned = url.trim().replace(/\/+$/, "");
  if (cleaned && !/^https?:\/\//i.test(cleaned)) {
    cleaned = `https://${cleaned}`;
  }
  return cleaned;
}

/**
 * Strip known API path suffixes from base URL (longest match first).
 */
function stripSuffixes(url: string, suffixes: string[]): string {
  let cleaned = url.replace(/\/+$/, "");
  for (const s of [...suffixes].sort((a, b) => b.length - a.length)) {
    if (cleaned.endsWith(s)) {
      cleaned = cleaned.slice(0, -s.length);
      break;
    }
  }
  return cleaned.replace(/\/+$/, "");
}

const OPENAI_SUFFIXES = ["/v1/chat/completions", "/v1/models", "/v1"];
const CLAUDE_SUFFIXES = ["/v1/messages", "/v1/models", "/v1"];
const GEMINI_SUFFIXES = ["/v1beta/models", "/v1beta", "/v1/models", "/v1"];

// ── Proxy Core ───────────────────────────────────────────────────────────

export interface ProxyLLMParams {
  provider: "openai" | "claude" | "gemini";
  apiKey: string;
  baseUrl: string;
  body: Record<string, unknown>;
  model?: string; // Required for Gemini (model name in URL)
  stream?: boolean; // Default true
}

/**
 * Proxy LLM request to upstream provider.
 * Transparently forwards both streaming (SSE) and non-streaming responses.
 */
export async function proxyLLM(params: ProxyLLMParams): Promise<Response> {
  const { provider, apiKey, baseUrl, body, model, stream = true } = params;

  // Validate base URL
  const validation = validateUpstreamUrl(baseUrl);
  if (!validation.valid) {
    return new Response(
      JSON.stringify({ error: validation.error }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  // Build upstream URL and headers
  let upstreamUrl: string;
  const headers: Record<string, string> = { "Content-Type": "application/json" };

  switch (provider) {
    case "openai": {
      const base = stripSuffixes(baseUrl, OPENAI_SUFFIXES);
      upstreamUrl = `${base}/v1/chat/completions`;
      headers["Authorization"] = `Bearer ${apiKey}`;
      break;
    }
    case "claude": {
      const base = stripSuffixes(baseUrl, CLAUDE_SUFFIXES);
      upstreamUrl = `${base}/v1/messages`;
      headers["x-api-key"] = apiKey;
      headers["anthropic-version"] = "2023-06-01";
      break;
    }
    case "gemini": {
      const base = stripSuffixes(baseUrl, GEMINI_SUFFIXES);
      const modelName = model || "gemini-2.0-flash";
      const action = stream ? "streamGenerateContent" : "generateContent";
      const streamParam = stream ? "&alt=sse" : "";
      upstreamUrl = `${base}/v1beta/models/${modelName}:${action}?key=${apiKey}${streamParam}`;
      break;
    }
    default:
      return new Response(
        JSON.stringify({ error: `Unsupported provider: ${provider}` }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
  }

  // Forward to upstream
  try {
    const upstreamResponse = await fetch(upstreamUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    // Transparent proxy: strip content-encoding/length, forward body as-is
    const responseHeaders = new Headers(upstreamResponse.headers);
    responseHeaders.delete("content-encoding");
    responseHeaders.delete("content-length");

    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      headers: responseHeaders,
    });
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Proxy error" }),
      { status: 502, headers: { "Content-Type": "application/json" } },
    );
  }
}
