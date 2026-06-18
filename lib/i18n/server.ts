import type { Locale } from "./config";
import { DEFAULT_LOCALE, LOCALES } from "./config";
import { getNestedValue, formatTranslation } from "./utils";

// Server-side translation cache (functions stripped for client serialization)
const translationCache = new Map<Locale, Record<string, unknown>>();

// Make translations serializable for the server→client boundary.
// Functions are pre-evaluated with empty params so the SSR HTML contains
// real text (the base variant without optional auth/analytics additions).
// The client loads the full locale (with live functions) via useEffect.
function makeSerializable(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === "function") {
      try { out[k] = (v as (p: Record<string, never>) => string)({}); } catch { /* skip */ }
    } else if (v && typeof v === "object" && !Array.isArray(v)) {
      out[k] = makeSerializable(v as Record<string, unknown>);
    } else {
      out[k] = v;
    }
  }
  return out;
}

// Get locale from request headers
export function getLocaleFromHeaders(headers: Headers): Locale {
  // Check for custom locale header
  const customLocale = headers.get("x-locale");
  if (customLocale && (LOCALES as readonly string[]).includes(customLocale)) {
    return customLocale as Locale;
  }

  // Check Accept-Language header
  const acceptLanguage = headers.get("accept-language");
  if (acceptLanguage) {
    const localeMap: Record<string, Locale> = {
      en: "en",
      zh: "zh-CN",
      ja: "ja",
    };

    const browserLangBase = acceptLanguage.split(",")[0]?.split("-")[0];
    if (browserLangBase) {
      const matched = localeMap[browserLangBase];
      if (matched) return matched;
    }
  }

  return DEFAULT_LOCALE;
}

// Load translations for server-side
export async function loadTranslations(locale: Locale): Promise<Record<string, unknown>> {
  // Check cache first
  if (translationCache.has(locale)) {
    return translationCache.get(locale)!;
  }

  try {
    let translations;
    switch (locale) {
      case "zh-CN":
        translations = (await import("./locales/zh-CN")).zhCN;
        break;
      case "en":
        translations = (await import("./locales/en")).en;
        break;
      case "ja":
        translations = (await import("./locales/ja")).ja;
        break;
      default:
        translations = (await import("./locales/zh-CN")).zhCN;
        break;
    }

    const serializable = makeSerializable(translations as Record<string, unknown>);
    translationCache.set(locale, serializable);
    return serializable;
  } catch (error) {
    console.error(`Failed to load translations for ${locale}:`, error);
    const fallback = await import("./locales/zh-CN");
    return fallback.zhCN as Record<string, unknown>;
  }
}

// Server-side translation function
export async function getTranslations(locale: Locale): Promise<Record<string, unknown>> {
  return loadTranslations(locale);
}

// Create a translation function for server components
export function createTranslator(translations: Record<string, unknown>) {
  return function t(key: string, params: Record<string, string | number | boolean> = {}): string {
    const value = getNestedValue(translations, key);

    if (value === undefined) {
      console.warn(`Translation missing for key: ${key}`);
      return key;
    }

    if (typeof value === "function") {
      return (value as (params: Record<string, string | number | boolean>) => string)(params);
    }

    if (typeof value === "string") {
      return formatTranslation(value, params);
    }

    return String(value);
  };
}

// Get initial locale for server components
export function getServerLocale(): Locale {
  return DEFAULT_LOCALE;
}
