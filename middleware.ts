import { type NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

// Next.js 16 deprecated `middleware` in favor of `proxy`, but `proxy` is locked
// to the Node.js runtime. OpenNext for Cloudflare rejects Node.js middleware at
// build time ("Node.js middleware is not currently supported"), so we keep the
// `middleware` convention with an explicit edge runtime to stay deployable to
// both Vercel and Cloudflare Workers. Revisit once OpenNext supports Node.js
// middleware or `proxy` allows the edge runtime.
export async function middleware(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!supabaseUrl || !supabaseKey) return NextResponse.next();

  let response = NextResponse.next({ request });
  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet) => {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // Must await: getUser() triggers the token refresh, and the refreshed
  // cookies are written to `response` via the setAll callback above. Returning
  // before it resolves can drop the refreshed session cookie.
  // getUser() returns auth errors (expired/invalid token) as { error } but
  // rethrows non-auth errors (e.g. fetch failures when Supabase is
  // unreachable). Swallow those so a transient network blip doesn't 500 or
  // crash the whole page request — the cookie simply isn't refreshed this
  // round and retries on the next request.
  try {
    await supabase.auth.getUser();
  } catch {
    return response;
  }

  return response;
}

export const config = {
  // edge runtime is required for Cloudflare Workers via OpenNext; the Node.js
  // middleware path is rejected by its build. Supabase SSR uses only Web APIs
  // (fetch, cookies), so it is edge-compatible.
  matcher: [
    // Match everything except static assets. We exclude by known file
    // extensions rather than "path contains a dot" so that future dotted
    // dynamic routes (e.g. /u/john.doe) still get the Supabase cookie refresh.
    "/((?!_next/static|_next/image|favicon.ico|icon.svg|.*\\.(?:svg|png|jpe?g|gif|webp|avif|ico|css|js|mjs|woff2?|ttf|otf|html|xml|txt|map)).*)",
  ],
  // NOTE: must be "experimental-edge", NOT "edge". Next.js 16 routes the
  // root middleware file through the pages-router static-info path, where
  // runtime "edge" throws "edge runtime for rendering is currently
  // experimental. Use runtime 'experimental-edge' instead." (E1015) at build.
  // "experimental-edge" only warns. Both are treated as edge by isEdgeRuntime().
  runtime: "experimental-edge",
};
