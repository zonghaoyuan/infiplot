"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import type { Locale } from "./config";
import {
  DEFAULT_LOCALE,
  LOCALE_STORAGE_KEY,
  getInitialLocale,
  setLocale as saveLocale,
} from "./config";
import { getNestedValue, formatTranslation } from "./utils";

// Translation function type
export type TranslationFunction = (
  key: string,
  params?: Record<string, string | number | boolean>,
) => string;

// Context type
interface I18nContextType {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: TranslationFunction;
  // Returns an array of strings stored under the key (e.g. the typewriter
  // example phrases). Falls back to the key wrapped in an array so callers
  // can safely index.
  tArray: (key: string) => string[];
}

const I18nContext = createContext<I18nContextType | undefined>(undefined);

// Provider props
interface I18nProviderProps {
  children: ReactNode;
  initialLocale?: Locale;
  initialTranslations?: Record<string, unknown>;
}

// Dynamic import of locale files
async function importLocale(locale: Locale) {
  switch (locale) {
    case "zh-CN":
      return (await import("./locales/zh-CN")).zhCN;
    case "en":
      return (await import("./locales/en")).en;
    case "ja":
      return (await import("./locales/ja")).ja;
    default:
      return (await import("./locales/zh-CN")).zhCN;
  }
}

// Provider component
export function I18nProvider({ children, initialLocale, initialTranslations }: I18nProviderProps) {
  const [locale, setLocaleState] = useState<Locale>(() => initialLocale ?? getInitialLocale());
  const [translations, setTranslations] = useState<Record<string, unknown>>(initialTranslations ?? {});
  const [isLoading, setIsLoading] = useState(!initialTranslations);

  // Load full translations (including functions that can't be serialized from
  // the server). On first mount with SSR initialTranslations we load silently
  // (no isLoading flash) to backfill function-valued entries. On locale change
  // we set isLoading so the UI can show a loading state.
  const mountedRef = useRef(false);
  useEffect(() => {
    const isFirstMount = !mountedRef.current;
    mountedRef.current = true;
    const silent = isFirstMount && !!initialTranslations;

    let cancelled = false;

    async function load() {
      if (!silent) setIsLoading(true);
      try {
        const localeData = await importLocale(locale);
        if (!cancelled) {
          setTranslations(localeData as Record<string, unknown>);
          setIsLoading(false);
        }
      } catch (error) {
        console.error(`Failed to load translations for ${locale}:`, error);
        if (!cancelled) {
          if (locale !== DEFAULT_LOCALE) {
            const fallback = await importLocale(DEFAULT_LOCALE);
            setTranslations(fallback as Record<string, unknown>);
          }
          setIsLoading(false);
        }
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [locale]);

  // Keep <html lang="..."> in sync with the active locale for a11y / SEO.
  useEffect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.lang = locale;
    }
  }, [locale]);

  // Set locale function
  const setLocale = (newLocale: Locale) => {
    saveLocale(newLocale);
    setLocaleState(newLocale);
  };

  // Translation function
  const t: TranslationFunction = (key, params = {}) => {
    if (isLoading) {
      return key; // Return key during loading
    }

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

  const tArray: I18nContextType["tArray"] = (key) => {
    if (isLoading) return [];
    const value = getNestedValue(translations, key);
    if (Array.isArray(value)) {
      return value.map((v) => (typeof v === "string" ? v : String(v)));
    }
    if (value === undefined) {
      console.warn(`Translation array missing for key: ${key}`);
    }
    return [];
  };

  return (
    <I18nContext.Provider value={{ locale, setLocale, t, tArray }}>
      {children}
    </I18nContext.Provider>
  );
}

// Hook to use i18n
export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error("useI18n must be used within I18nProvider");
  }
  return context;
}

// Hook to get just the translation function (for server-side or non-provider contexts)
export function useTranslation(locale?: Locale) {
  const { t: clientT, locale: currentLocale } = useI18n();

  return {
    t: clientT,
    locale: locale ?? currentLocale,
  };
}
