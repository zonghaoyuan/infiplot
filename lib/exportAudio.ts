// ──────────────────────────────────────────────────────────────────────
//  Audio collection for the gallery / .infiplot share exports.
//
//  Walks every speaking beat across `session.history` and produces a
//  Record keyed by `${sceneId}:${beatId}` whose values are inline
//  data: URIs (base64). Data URIs are the only audio form that survives
//  transport through localStorage, AES-GCM ciphertext, and a fresh
//  browser tab — blob: URLs from /api/beat-audio are tied to the document
//  that created them.
//
//  Three sources, in priority order:
//    1. prebaked  — audio that came in through a .infiplot share file.
//                   Already a data URI, so just copied through.
//    2. current beatAudioMap — the play page's per-beat audio for the
//                   scene the player is on right now. Blob URLs get
//                   converted to data URIs; data URIs pass through.
//    3. fresh synth — BYO client TTS (browser-direct Xiaomi/StepFun) when
//                   a key is configured, otherwise /api/beat-audio.
//
//  Concurrency 4 to keep TTS providers happy when a long session has
//  dozens of speaking beats. Errors are silently skipped — a missing beat
//  just plays without voice; we never block the export on a TTS hiccup.
// ──────────────────────────────────────────────────────────────────────

import { provisionVoice, synthesize } from "@infiplot/tts-client";
import type {
  Beat,
  Character,
  CharacterVoice,
  Session,
  TtsConfig,
} from "@infiplot/types";

const CONCURRENCY = 4;

export type CollectBeatAudioOptions = {
  session: Session;
  /** Current-scene audio already loaded by the play page (keyed by bare beat id). */
  beatAudioMap: Record<string, string>;
  /** Scene id `beatAudioMap` belongs to (so we can promote its entries into the full key). */
  currentSceneId: string | null;
  /** BYO TTS config when the user supplied their own key; null for server-side TTS. */
  byoTts: TtsConfig | null;
  /** Cache of in-flight BYO voice provisions, keyed by character name. Reused across calls. */
  byoVoiceCache: Map<string, Promise<CharacterVoice>>;
  /** Audio carried in from a `.infiplot` share file (already keyed by `sceneId:beatId`). */
  prebakedAudio?: Record<string, string>;
  /** Progress callback (done/total). Fired after every beat (success or failure). */
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
};

type Job = {
  key: string;
  scene: Session["history"][number]["scene"];
  beat: Beat;
};

export async function collectBeatAudioForExport(
  opts: CollectBeatAudioOptions,
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};

  if (opts.prebakedAudio) {
    for (const [k, v] of Object.entries(opts.prebakedAudio)) {
      if (typeof v === "string" && v.startsWith("data:")) out[k] = v;
    }
  }

  const jobs: Job[] = [];
  for (const entry of opts.session.history) {
    const scene = entry.scene;
    for (const beat of scene.beats) {
      if (!beat.speaker || !beat.line) continue;
      const key = `${scene.id}:${beat.id}`;
      if (out[key]) continue;
      jobs.push({ key, scene, beat });
    }
  }

  // Hoist current-scene blob/data URLs first so the play page's already-
  // synthesized audio is reused instead of re-billed. Blob URLs are local to
  // this document — convert to base64 so they survive export.
  if (opts.currentSceneId) {
    for (const job of jobs) {
      if (job.scene.id !== opts.currentSceneId) continue;
      const local = opts.beatAudioMap[job.beat.id];
      if (!local) continue;
      try {
        out[job.key] = await urlToDataUri(local);
      } catch {
        // ignore — falls through to synth below
      }
    }
  }

  const remaining = jobs.filter((j) => !out[j.key]);
  const total = jobs.length;
  let done = jobs.length - remaining.length;
  opts.onProgress?.(done, total);

  const charByName = new Map(opts.session.characters.map((c) => [c.name, c]));

  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < remaining.length) {
      if (opts.signal?.aborted) return;
      const job = remaining[cursor++]!;
      try {
        const audio = await synthesizeBeatForExport(
          job.beat,
          charByName.get(job.beat.speaker!),
          opts.byoTts,
          opts.byoVoiceCache,
          opts.signal,
        );
        if (audio) out[job.key] = audio;
      } catch {
        // silent — beat will play without voice
      }
      done++;
      opts.onProgress?.(done, total);
    }
  }

  const workers = Array.from(
    { length: Math.min(CONCURRENCY, Math.max(1, remaining.length)) },
    () => worker(),
  );
  await Promise.all(workers);
  return out;
}

async function synthesizeBeatForExport(
  beat: Beat,
  speaker: Character | undefined,
  byo: TtsConfig | null,
  voiceCache: Map<string, Promise<CharacterVoice>>,
  signal?: AbortSignal,
): Promise<string | null> {
  if (!speaker || !beat.line) return null;

  if (byo) {
    let voiceP = voiceCache.get(speaker.name);
    if (!voiceP) {
      if (speaker.voice) {
        voiceP = Promise.resolve(speaker.voice);
      } else if (speaker.voiceDescription) {
        voiceP = provisionVoice(byo, speaker.voiceDescription, speaker.name);
      } else {
        return null;
      }
      voiceCache.set(speaker.name, voiceP);
    }
    let voice: CharacterVoice;
    try {
      voice = await voiceP;
    } catch {
      voiceCache.delete(speaker.name);
      return null;
    }
    const out = await synthesize(byo, voice, beat.line, beat.lineDelivery, signal);
    return `data:${out.mimeType};base64,${out.audioBase64}`;
  }

  if (!speaker.voice) return null;
  const res = await fetch("/api/beat-audio", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      beat: { id: beat.id, line: beat.line, lineDelivery: beat.lineDelivery },
      voice: speaker.voice,
    }),
    signal,
  });
  if (res.status === 204 || !res.ok) return null;
  const blob = await res.blob();
  return await blobToDataUri(blob);
}

async function urlToDataUri(url: string): Promise<string> {
  if (url.startsWith("data:")) return url;
  const res = await fetch(url);
  const blob = await res.blob();
  return await blobToDataUri(blob);
}

function blobToDataUri(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const v = reader.result;
      if (typeof v === "string") resolve(v);
      else reject(new Error("FileReader produced non-string result"));
    };
    reader.onerror = () => reject(reader.error ?? new Error("FileReader failed"));
    reader.readAsDataURL(blob);
  });
}
