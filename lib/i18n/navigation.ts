import { DEFAULT_LOCALE, type Locale } from "./config";

/**
 * Build a locale-prefixed path. For the default locale (zh-CN), returns the
 * bare path so the URL stays clean (middleware rewrites internally).
 * For en/ja, prepends the locale segment.
 */
export function localePath(path: string, locale: Locale): string {
  if (locale === DEFAULT_LOCALE) return path;
  return `/${locale}${path.startsWith("/") ? "" : "/"}${path}`;
}

/**
 * Strip any locale prefix from a pathname, returning the bare path.
 * "/en/play" → "/play", "/ja" → "/", "/play" → "/play"
 */
export function stripLocalePrefix(pathname: string): string {
  const match = pathname.match(/^\/(en|ja)(\/|$)/);
  if (!match) return pathname;
  const rest = pathname.slice(match[0].length - (match[2] === "/" ? 1 : 0));
  return rest || "/";
}
