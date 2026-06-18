"use client";

import { useI18n } from "./client";
import { localePath } from "./navigation";

/**
 * Returns a function that prepends the current locale prefix to a path.
 * zh-CN paths stay bare; en/ja paths get /{locale} prepended.
 */
export function useLocalePath() {
  const { locale } = useI18n();
  return (path: string) => localePath(path, locale);
}
