// Bring-your-own Xiaomi MiMo TTS key — stored CLIENT-SIDE ONLY.
//
// When a user supplies their own key, we persist {presetId, apiKey} in
// localStorage and the browser talks to Xiaomi directly (see lib/tts-client).
// The key is therefore never sent to our server: no request body, no header,
// no log. resolveTtsConfig() turns the stored pair into the TtsConfig shape the
// tts-client adapter expects, mapping the chosen endpoint preset to its baseUrl.

import type { TtsConfig } from "@infiplot/types";
import { DEFAULT_TTS_SPEECH_MODEL, findTtsPreset } from "./ttsPresets";

const STORAGE_KEY = "infiplot:tts";

/** Exactly what we persist — endpoint choice + raw key. Resolved to a full
 *  TtsConfig (with baseUrl + model) at read time so a renamed/removed preset
 *  can't leave a stale baseUrl baked into storage. */
export type StoredTtsConfig = {
  presetId: string;
  apiKey: string;
};

/** Read + validate the persisted BYO config. Returns null when running on the
 *  server, when nothing is stored, on parse failure, or when the stored shape
 *  is no longer valid (unknown preset / empty key). */
export function readStoredTtsConfig(): StoredTtsConfig | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredTtsConfig>;
    const presetId = typeof parsed.presetId === "string" ? parsed.presetId : "";
    const apiKey = typeof parsed.apiKey === "string" ? parsed.apiKey : "";
    if (!findTtsPreset(presetId)) return null;
    if (!apiKey.trim()) return null;
    return { presetId, apiKey };
  } catch {
    return null;
  }
}

/** Persist the BYO config. Trims the key so trailing whitespace from a paste
 *  never breaks the `api-key` header. */
export function writeStoredTtsConfig(config: StoredTtsConfig): void {
  if (typeof window === "undefined") return;
  try {
    const payload: StoredTtsConfig = {
      presetId: config.presetId,
      apiKey: config.apiKey.trim(),
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Storage disabled / quota / private mode — BYO simply stays off.
  }
}

export function clearStoredTtsConfig(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

/** Map a stored pair to the adapter-ready TtsConfig, resolving the endpoint
 *  preset to its baseUrl. Returns null when the preset is unknown or the key
 *  is blank — callers treat null as "no BYO; use server default / silent". */
export function resolveTtsConfig(
  stored: StoredTtsConfig | null,
): TtsConfig | null {
  if (!stored) return null;
  const preset = findTtsPreset(stored.presetId);
  if (!preset) return null;
  const apiKey = stored.apiKey.trim();
  if (!apiKey) return null;
  return {
    baseUrl: preset.baseUrl,
    apiKey,
    speechModel: DEFAULT_TTS_SPEECH_MODEL,
  };
}

/** Convenience: read storage and resolve in one step. */
export function loadClientTtsConfig(): TtsConfig | null {
  return resolveTtsConfig(readStoredTtsConfig());
}
