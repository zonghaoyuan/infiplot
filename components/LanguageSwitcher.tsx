"use client";

import { useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useI18n } from "@/lib/i18n/client";
import { LOCALES, LOCALE_NAMES, type Locale } from "@/lib/i18n/config";
import { localePath, stripLocalePrefix } from "@/lib/i18n/navigation";

interface LanguageSwitcherProps {
  className?: string;
  /** "compact" = icon + short label, fits a header next to other icons.
   *  "full" = icon + full label + chevron, for a settings panel row. */
  variant?: "compact" | "full";
}

const SHORT_LOCALE_NAMES: Record<Locale, string> = {
  "zh-CN": "中文",
  en: "EN",
  ja: "日本語",
};

export function LanguageSwitcher({ className = "", variant = "full" }: LanguageSwitcherProps) {
  const { locale, setLocale, t } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);

  const currentLocaleName = LOCALE_NAMES[locale] || locale;
  const currentShortName = SHORT_LOCALE_NAMES[locale] || locale;

  function switchTo(newLocale: Locale) {
    const basePath = stripLocalePrefix(pathname);
    const newPath = localePath(basePath, newLocale);
    setLocale(newLocale);
    setIsOpen(false);
    router.push(newPath);
  }

  return (
    <div className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={
          variant === "compact"
            ? "inline-flex items-center gap-1.5 text-base text-clay-500 hover:text-ember-500 transition-colors"
            : "flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-clay-100 transition-colors text-clay-700"
        }
        aria-label={t("language.select")}
        title={t("language.select")}
        aria-expanded={isOpen}
      >
        <i className="fa-solid fa-globe" />
        <span className={variant === "compact" ? "text-[12px] font-sans" : "text-sm"}>
          {variant === "compact" ? currentShortName : currentLocaleName}
        </span>
        {variant === "full" && (
          <i
            className={`fa-solid fa-chevron-down text-[9px] transition-transform ${isOpen ? "rotate-180" : ""}`}
          />
        )}
      </button>

      {isOpen && (
        <>
          <div
            className="fixed inset-0 z-10"
            onClick={() => setIsOpen(false)}
            aria-hidden="true"
          />
          <div className="absolute right-0 top-full mt-1 w-44 overflow-hidden rounded-sm border border-clay-900/15 bg-cream-50 shadow-xl shadow-clay-900/10 z-20">
            <div className="py-1">
              {LOCALES.map((loc) => (
                <button
                  key={loc}
                  type="button"
                  onClick={() => switchTo(loc)}
                  className={`flex w-full items-center justify-between px-3 py-1.5 text-sm font-serif transition-colors hover:bg-cream-100 ${
                    locale === loc ? "text-ember-500" : "text-clay-700"
                  }`}
                >
                  {LOCALE_NAMES[loc]}
                  {locale === loc && <i className="fa-solid fa-check text-[10px]" />}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
