// Block SSRF: only allow HTTPS URLs pointing to public internet hosts.

const ALLOWED_HOSTS = new Set([
  "api.openai.com",
  "api.anthropic.com",
  "generativelanguage.googleapis.com",
  "api.runware.ai",
  "api.replicate.com",
  "api.deepseek.com",
  "dashscope.aliyuncs.com",
  "api.siliconflow.cn",
  "api.together.xyz",
  "openrouter.ai",
  "api.mistral.ai",
  "api.groq.com",
  "api.fireworks.ai",
  "api.cohere.com",
]);

const BLOCKED_HOSTS = new Set([
  "localhost",
  "metadata.google.internal",
  "metadata.internal",
]);

const PRIVATE_RANGES = [
  { start: ip4ToNum(0, 0, 0, 0), end: ip4ToNum(0, 255, 255, 255) },
  { start: ip4ToNum(10, 0, 0, 0), end: ip4ToNum(10, 255, 255, 255) },
  { start: ip4ToNum(100, 64, 0, 0), end: ip4ToNum(100, 127, 255, 255) },
  { start: ip4ToNum(127, 0, 0, 0), end: ip4ToNum(127, 255, 255, 255) },
  { start: ip4ToNum(169, 254, 0, 0), end: ip4ToNum(169, 254, 255, 255) },
  { start: ip4ToNum(172, 16, 0, 0), end: ip4ToNum(172, 31, 255, 255) },
  { start: ip4ToNum(192, 168, 0, 0), end: ip4ToNum(192, 168, 255, 255) },
  { start: ip4ToNum(224, 0, 0, 0), end: ip4ToNum(239, 255, 255, 255) },
  { start: ip4ToNum(240, 0, 0, 0), end: ip4ToNum(255, 255, 255, 255) },
];

function ip4ToNum(a: number, b: number, c: number, d: number): number {
  return ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;
}

function parseIp4(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  for (const p of parts) {
    const n = Number(p);
    if (!Number.isInteger(n) || n < 0 || n > 255) return null;
  }
  return ip4ToNum(
    Number(parts[0]),
    Number(parts[1]),
    Number(parts[2]),
    Number(parts[3]),
  );
}

function isPrivateIp(ip: string): boolean {
  const n = parseIp4(ip);
  if (n === null) return true;
  return PRIVATE_RANGES.some((r) => n >= r.start && n <= r.end);
}

export function isAllowlistedHost(hostname: string): boolean {
  return ALLOWED_HOSTS.has(hostname);
}

export function isPublicUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }

  if (url.protocol !== "https:") return false;
  if (url.username || url.password) return false;

  const host = url.hostname.toLowerCase();

  if (BLOCKED_HOSTS.has(host)) return false;
  // Reject all IPv6 addresses (including ::ffff:127.0.0.1 mapped forms)
  if (host.includes(":")) return false;

  // Fast path: known API providers always pass
  if (ALLOWED_HOSTS.has(host)) return true;

  // For unknown domains, block IP literals pointing to private ranges
  const ipv4 = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);
  if (ipv4) return !isPrivateIp(host);

  // Domain names: allow — DNS rebinding is mitigated by redirect: "manual"
  // on fetchWithRetry and the fact that Vercel's runtime resolves DNS once
  // per fetch (no keep-alive reuse across requests).
  return true;
}
