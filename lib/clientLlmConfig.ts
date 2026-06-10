// Bring-your-own LLM API keys — stored CLIENT-SIDE ONLY.
//
// When a user supplies their own keys, we persist {provider, baseUrl, apiKey}
// in localStorage and send them with each /api/start and /api/scene request.
// Keys never leak to server logs or persistence — they only pass through the
// request→config construction path.

const STORAGE_KEY = "infiplot:llm";

/** Provider types matching byoProxy and ProviderProtocol */
export type LlmProvider = "openai" | "claude" | "gemini";

/** Stored BYO LLM config — exactly what we persist. */
export type StoredLlmConfig = {
  /** Which provider API to use */
  provider: LlmProvider;
  /** User's API key */
  apiKey: string;
  /** Optional custom base URL (empty = use provider default) */
  baseUrl?: string;
  /** Optional model name (empty = use server-side default for this provider/role) */
  model?: string;
};

/** Per-role LLM config the user can independently configure */
export type ByoLlmSettings = {
  text?: StoredLlmConfig;
  image?: StoredLlmConfig;
  vision?: StoredLlmConfig;
};

/**
 * Read persisted BYO LLM config. Returns null when running on the server,
 * when nothing is stored, on parse failure, or when the stored shape is invalid.
 */
export function readStoredLlmConfig(): ByoLlmSettings | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ByoLlmSettings>;

    // Validate each role config
    const result: ByoLlmSettings = {};
    for (const role of ["text", "image", "vision"] as const) {
      const cfg = parsed[role];
      if (cfg && typeof cfg === "object") {
        const provider = cfg.provider as string;
        const apiKey = cfg.apiKey as string;
        if (["openai", "claude", "gemini"].includes(provider) && apiKey?.trim()) {
          result[role] = {
            provider: provider as LlmProvider,
            apiKey: apiKey.trim(),
            baseUrl: typeof cfg.baseUrl === "string" ? cfg.baseUrl.trim() : undefined,
            model: typeof cfg.model === "string" ? cfg.model.trim() : undefined,
          };
        }
      }
    }

    return Object.keys(result).length > 0 ? result : null;
  } catch {
    return null;
  }
}

/**
 * Persist BYO LLM config. Trims keys and baseUrls so trailing whitespace
 * from paste never breaks headers.
 */
export function writeStoredLlmConfig(config: ByoLlmSettings): void {
  if (typeof window === "undefined") return;
  try {
    const payload: ByoLlmSettings = {};
    for (const role of ["text", "image", "vision"] as const) {
      const cfg = config[role];
      if (cfg) {
        payload[role] = {
          provider: cfg.provider,
          apiKey: cfg.apiKey.trim(),
          baseUrl: cfg.baseUrl?.trim() || undefined,
          model: cfg.model?.trim() || undefined,
        };
      }
    }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Storage disabled / quota / private mode — BYO simply stays off.
  }
}

export function clearStoredLlmConfig(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
