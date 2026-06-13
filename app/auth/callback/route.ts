import { type NextRequest, NextResponse } from "next/server";
import { AUTH_ENABLED } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";

// Only allow same-origin relative paths. Rejects `//evil.com`, `/\evil.com`,
// and absolute URLs that would otherwise turn `${origin}${next}` into an
// open redirect (CWE-601).
function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith("/")) return "/";
  if (raw.startsWith("//") || raw.startsWith("/\\")) return "/";
  // Reject control chars (CR/LF etc.) — defense-in-depth against header
  // injection if `next` ever reaches a context that doesn't re-encode it.
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return "/";
  }
  return raw;
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;

  // Auth not configured: nothing can legitimately hit this route, so just
  // bounce home instead of constructing a Supabase client from blank env vars.
  if (!AUTH_ENABLED) {
    return NextResponse.redirect(`${origin}/`);
  }

  const code = searchParams.get("code");
  const next = safeNext(searchParams.get("next"));

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }
  return NextResponse.redirect(`${origin}/?auth_error=1`);
}
