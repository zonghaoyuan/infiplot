import { type NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

// Locale prefixes that appear in the URL (default zh-CN has no prefix).
const LOCALE_PREFIXES = ["en", "ja"] as const;
const DEFAULT_LOCALE = "zh-CN";

function detectLocaleFromPath(pathname: string): { locale: string; stripped: string } | null {
  for (const prefix of LOCALE_PREFIXES) {
    if (pathname === `/${prefix}` || pathname.startsWith(`/${prefix}/`)) {
      const stripped = pathname.slice(prefix.length + 1) || "/";
      return { locale: prefix, stripped };
    }
  }
  return null;
}

// Next.js 16 deprecated `middleware` in favor of `proxy`, but `proxy` is locked
// to the Node.js runtime. OpenNext for Cloudflare rejects Node.js middleware at
// build time ("Node.js middleware is not currently supported"), so we keep the
// `middleware` convention with an explicit edge runtime to stay deployable to
// both Vercel and Cloudflare Workers. Revisit once OpenNext supports Node.js
// middleware or `proxy` allows the edge runtime.
export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // ── Locale routing ─────────────────────────────────────────────────
  // Skip locale logic for API routes, auth, and static assets.
  const skipLocale =
    pathname.startsWith("/api/") ||
    pathname.startsWith("/auth/") ||
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/home/") ||
    pathname.startsWith("/docs/") ||
    /\.(?:svg|png|jpe?g|gif|webp|avif|ico|css|js|mjs|woff2?|ttf|otf|json|xml|txt|map)$/i.test(pathname);

  let locale = DEFAULT_LOCALE;
  let response: NextResponse;

  if (!skipLocale) {
    // If someone visits /zh-CN/... explicitly, redirect to bare path (keep clean URLs).
    if (pathname === "/zh-CN" || pathname.startsWith("/zh-CN/")) {
      const bare = pathname.slice(6) || "/";
      const url = request.nextUrl.clone();
      url.pathname = bare;
      return NextResponse.redirect(url);
    }

    const detected = detectLocaleFromPath(pathname);
    if (detected) {
      // URL has a locale prefix (e.g. /en/play) — pass through with locale header.
      locale = detected.locale;
      response = NextResponse.next({ request });
    } else {
      // No locale prefix — rewrite to /zh-CN/... internally (URL stays clean).
      const url = request.nextUrl.clone();
      url.pathname = `/${DEFAULT_LOCALE}${pathname}`;
      response = NextResponse.rewrite(url);
    }
  } else {
    response = NextResponse.next({ request });
  }

  // Set locale + pathname headers so root layout can read them for
  // <html lang> and <link rel="alternate" hreflang>.
  response.headers.set("x-locale", locale);
  response.headers.set("x-pathname", pathname);

  // ── Supabase auth token refresh ────────────────────────────────────
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!supabaseUrl || !supabaseKey) return response;

  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet) => {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  try {
    await supabase.auth.getUser();
  } catch {
    return response;
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icon.svg|.*\\.(?:svg|png|jpe?g|gif|webp|avif|ico|css|js|mjs|woff2?|ttf|otf|html|xml|txt|map)).*)",
  ],
  runtime: "experimental-edge",
};
