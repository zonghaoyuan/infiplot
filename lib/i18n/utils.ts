import { LOCALES } from "./config";
import type { Locale } from "./config";

/**
 * Get a nested value from an object using a dot-notation path
 * @example getNestedValue({ a: { b: "c" } }, "a.b") // "c"
 */
export function getNestedValue<T>(obj: T, path: string): unknown {
  return path.split(".").reduce<unknown>((current, key) => {
    if (current && typeof current === "object" && key in current) {
      return (current as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
}

/**
 * Format a translation string with parameters
 * Supports both {{key}} syntax and simple function-based interpolation
 */
export function formatTranslation(
  template: string,
  params: Record<string, string | number | boolean>,
): string {
  if (Object.keys(params).length === 0) return template;

  return template.replace(/\{{1,2}(\w+)\}{1,2}/g, (_match, key) => {
    return params[key]?.toString() ?? `{${key}}`;
  });
}

/**
 * Deep merge two objects
 */
export function deepMerge<T extends Record<string, unknown>>(
  target: T,
  source: Partial<T>,
): T {
  const result = { ...target };

  for (const key in source) {
    if (source[key] && typeof source[key] === "object" && !Array.isArray(source[key])) {
      if (result[key] && typeof result[key] === "object" && !Array.isArray(result[key])) {
        result[key] = deepMerge(
          result[key] as Record<string, unknown>,
          source[key] as Record<string, unknown>,
        ) as T[Extract<keyof T, string>];
      } else {
        result[key] = source[key] as T[Extract<keyof T, string>];
      }
    } else {
      result[key] = source[key] as T[Extract<keyof T, string>];
    }
  }

  return result;
}

/**
 * Validate locale string
 */
export function isValidLocale(locale: string): locale is Locale {
  return (LOCALES as readonly string[]).includes(locale);
}
