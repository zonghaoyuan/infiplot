export const BYO_STORAGE_KEY = "infiplot:byoApi";

const MAX_HEADER_SIZE = 2048;

export function getByoHeaders(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(BYO_STORAGE_KEY);
    if (raw && raw.length <= MAX_HEADER_SIZE) {
      const parsed = JSON.parse(raw);
      if (parsed.llm?.enabled || parsed.painter?.enabled) {
        return { "x-byo-api": raw };
      }
    }
  } catch {
    /* ignore */
  }
  return {};
}

export function isByoActive(): boolean {
  return Object.keys(getByoHeaders()).length > 0;
}
