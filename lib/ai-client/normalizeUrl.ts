import type { ProviderProtocol } from "@infiplot/types";

// ──────────────────────────────────────────────────────────────────────
//  Base-URL normalization — tolerate whatever shape the user pastes.
//
//  The README never specified whether the base URL needs a `/v1` suffix,
//  so users provide all of these for the same endpoint:
//      https://api.deepseek.com
//      https://api.deepseek.com/v1
//      https://api.deepseek.com/v1/chat/completions
//  We normalize to a canonical base the adapter can safely append its own
//  endpoint path to. This also fixes the pre-existing double-suffix bug
//  where a pasted `.../chat/completions` became `.../chat/completions/chat/completions`.
//
//  Strategy (bare-host-only version append):
//    1. strip trailing slashes
//    2. strip a trailing known endpoint suffix (chat/completions, messages, …)
//    3. only when the URL the user gave is a BARE host (scheme://host[:port]
//       with no path) do we append the protocol's default version segment.
//       Any path the user wrote (/v1, /beta, /zen/go, /chat/completions, …) is
//       treated as an explicit location and left intact — so we never turn
//       `/beta` into `/beta/v1`, and a version-less `/chat/completions`
//       endpoint is preserved.
// ──────────────────────────────────────────────────────────────────────

// Endpoint paths an adapter appends itself — stripped so we keep only the base.
const ENDPOINT_SUFFIX =
  /\/(chat\/completions|completions|responses|messages|images\/(generations|edits))\/?$/i;

// Default version segment to append per protocol for a bare host.
const DEFAULT_VERSION_SEGMENT: Record<ProviderProtocol, string | null> = {
  openai_compatible: "v1",
  openai: "v1",
  // Runware posts to the bare base URL with no version-pathed sub-resource,
  // so never inject a segment for it.
  runware: null,
};

// True when `raw` is just scheme://host[:port] with no meaningful path — the
// only shape where we infer a default version segment. A lone "/" counts as
// bare. Falls back to a scheme-anchored regex if the URL can't be parsed.
function isBareHost(raw: string): boolean {
  try {
    const { pathname } = new URL(raw);
    return pathname === "" || pathname === "/";
  } catch {
    return !/^[a-z][a-z0-9+.-]*:\/\/[^/]+\/.+/i.test(raw);
  }
}

export function normalizeBaseUrl(
  raw: string,
  protocol: ProviderProtocol,
): string {
  const trimmed = raw.trim();
  let u = trimmed.replace(/\/+$/, "");
  u = u.replace(ENDPOINT_SUFFIX, "").replace(/\/+$/, "");

  const seg = DEFAULT_VERSION_SEGMENT[protocol];
  if (seg && isBareHost(trimmed)) {
    u = `${u}/${seg}`;
  }
  return u;
}
