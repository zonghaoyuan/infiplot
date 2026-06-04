"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { PlayCanvas, type Phase } from "@/components/PlayCanvas";
import { TtsKeyModal } from "@/components/TtsKeyModal";
import { annotateClick } from "@/lib/annotateClient";
import { loadClientTtsConfig } from "@/lib/clientTtsConfig";
import { PRESETS } from "@/lib/presets";
import { provisionVoice, synthesize } from "@infiplot/tts-client";
import type {
  Beat,
  BeatChoice,
  Character,
  CharacterVoice,
  InsertBeatResponse,
  Orientation,
  Scene,
  SceneExit,
  SceneResponse,
  Session,
  StartResponse,
  TtsConfig,
  VisionResponse,
} from "@infiplot/types";
import { track } from "@/lib/analytics";
import { getByoHeaders, isByoActive } from "@/lib/byoHeaders";

const MUTED_STORAGE_KEY = "infiplot:muted";

// ── FOT reduction helpers ──────────────────────────────────────────────
// Strip bulky voice.referenceAudioBase64 from the session before sending it to
// the server. The engine only needs character names + visualDescriptions for
// scene generation; voice data is only used by /api/beat-audio (which receives
// the voice directly, not via session). The client retains voices locally and
// re-merges them from the response via mergeCharactersPreserveVoice.
function stripVoicesForTransport(session: Session): Session {
  return {
    ...session,
    characters: session.characters.map((c) => ({ ...c, voice: undefined })),
  };
}

// Merge server-returned characters with locally-held voices. The server strips
// voice from already-known characters (P0), so only NEW characters carry voice.
// For existing characters, re-attach the voice the client already holds.
function mergeCharactersPreserveVoice(
  local: Character[],
  remote: Character[],
): Character[] {
  const localByName = new Map(local.map((c) => [c.name, c]));
  return remote.map((c) => {
    const prev = localByName.get(c.name);
    if (!prev) return c;
    return { ...c, voice: c.voice ?? prev.voice };
  });
}

// Consecutive silent (no-audio) beats before we surface the BYO-key nudge to a
// non-BYO, unmuted player. Set high enough that one transient miss won't trip
// it, low enough to catch a scene that's clearly being rate-limited.
const SILENCE_NUDGE_THRESHOLD = 3;

// Mobile-portrait users get a 9:16 scene image painted for them; everyone else
// (desktop, tablet, mobile-landscape) keeps the 16:9 landscape image. Only a
// touch device (coarse pointer) held upright counts as "portrait" — a mouse
// device is always landscape. Detected once and locked for the whole session.
function detectOrientation(): Orientation {
  if (typeof window === "undefined") return "landscape";
  const portrait = window.matchMedia("(orientation: portrait)").matches;
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  return portrait && coarse ? "portrait" : "landscape";
}

// Runs before the browser paints (so it can correct first-frame state without a
// visible flash), but useLayoutEffect warns when called during SSR. PlayInner
// only ever renders on the client (/play prerenders the Suspense fallback), yet
// fall back to useEffect on the server anyway to keep the warning out.
const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

// Cap how long we wait for the browser to download + decode a scene image
// before giving up and rendering anyway. Runware's CDN is usually <2s for a
// 1792×1024 PNG, but over slow links / VPN / strict corp networks the same
// download can stretch to 10-20s. The previous 8s ceiling fired in that
// window, and because the rendered <img> has no aspect-ratio occupation, the
// layout collapsed to a one-pixel-tall sliver until the bytes actually
// finished arriving — "等了很久 → 一根线 → 突然出图" of the original report.
// 20s + the <img> aspect-video fallback together remove that failure mode.
const IMAGE_PRELOAD_TIMEOUT_MS = 20000;

// ──────────────────────────────────────────────────────────────────────
//  Two ways an <img> gets its pixels, picked per-URL by shouldProxy():
//
//  1. DIRECT (default — no proxy configured): preload the URL with an
//     Image() + decode() so the HTTP cache is warm and the bitmap decoded
//     before React commits, then hand the ORIGINAL URL to <img>. This is the
//     long-standing behavior; deployers who set no env var get exactly this
//     and are completely unaffected by the proxy machinery below.
//
//  2. PROXY (opt-in — NEXT_PUBLIC_IMAGE_PROXY_URL set, host allow-listed):
//     fetch the bytes through the Cloudflare Worker (which adds CORS and
//     serves over stable HTTP/2), await the FULL body via .blob(), materialize
//     a blob: URL over that local copy, and hand THAT to <img>. The <img>
//     never sees a network-backed src, so there's no "字节还在路上" middle
//     state and no progressive paint.
//     Why it matters: Chrome's direct fetch of im.runware.ai sometimes hits
//     ERR_QUIC_PROTOCOL_ERROR mid-stream, leaving partial PNG bytes that
//     paint row-by-row. The Worker re-fetches server-to-server (no QUIC
//     fragility) and serves over HTTP/2 — atomic and reliable. Trade-off:
//     callers MUST revoke the blob URL when swapping it out (revokeBlobUrlFor)
//     or the bytes leak in the JS heap.
//
//  Data URIs (MOCK_IMAGE mode) are already local; passed through unchanged
//  on both paths. blobUrlCache is keyed by the ORIGINAL URL either way.
// ──────────────────────────────────────────────────────────────────────

// Direct-path preload: decode the URL in memory before committing to React
// state, so when the <img> mounts the cache is warm and first paint is
// instant. Errors / timeouts resolve quietly — better a broken <img> than a
// hung play loop. (im.runware.ai sends no CORS header, so we can't fetch()
// its bytes here; warming + decoding is the most the direct path can do.)
function preloadImage(url: string): Promise<void> {
  return new Promise<void>((resolve) => {
    const img = new Image();
    let timer: ReturnType<typeof setTimeout>;
    // Single exit: clear the timeout and resolve. resolve() is idempotent, so
    // whichever path fires first (load+decode, error, timeout) wins.
    const done = () => {
      clearTimeout(timer);
      resolve();
    };
    // Armed across BOTH network load and decode, so a hung decode still
    // resolves quietly — better a broken <img> than a stuck play loop.
    timer = setTimeout(done, IMAGE_PRELOAD_TIMEOUT_MS);
    img.onload = () => {
      // .decode() forces the bitmap to be fully decoded before we proceed —
      // without it, a slow decode could still cause a flash on first paint.
      img.decode().then(done, done);
    };
    img.onerror = done;
    img.src = url;
  });
}

// Opt-in Cloudflare Workers proxy (deploy your own — see the link in README).
// Inlined by Next.js at build time. Empty / unset → no proxy → every URL takes
// the direct path above, exactly as if this feature didn't exist.
const IMAGE_PROXY_BASE = (
  process.env.NEXT_PUBLIC_IMAGE_PROXY_URL ?? ""
).replace(/\/$/, "");

// Hostnames eligible for the proxy. Default: Runware's CDN only. Deployers who
// point IMAGE_BASE_URL at another provider can opt that provider's image host
// in via NEXT_PUBLIC_IMAGE_PROXY_ALLOWED_HOSTS (comma-separated). Inlined at
// build time. Anything not on this list stays on the direct path.
const IMAGE_PROXY_ALLOWED_HOSTS = (
  process.env.NEXT_PUBLIC_IMAGE_PROXY_ALLOWED_HOSTS ?? "im.runware.ai"
)
  .split(",")
  .map((h) => h.trim().toLowerCase())
  .filter(Boolean);

// Route a URL through the proxy only when a proxy is configured AND it's a
// remote http(s) image on an allow-listed host. data: URIs (MOCK_IMAGE) are
// already local; malformed URLs and any other origin fall through to direct.
function shouldProxy(originalUrl: string): boolean {
  if (!IMAGE_PROXY_BASE) return false;
  if (originalUrl.startsWith("data:")) return false;
  try {
    const { protocol, hostname } = new URL(originalUrl);
    if (protocol !== "https:" && protocol !== "http:") return false;
    return IMAGE_PROXY_ALLOWED_HOSTS.includes(hostname.toLowerCase());
  } catch {
    return false;
  }
}

function proxiedImageUrl(originalUrl: string): string {
  return `${IMAGE_PROXY_BASE}/?url=${encodeURIComponent(originalUrl)}`;
}

async function fetchImageAsBlobUrl(url: string): Promise<string> {
  if (url.startsWith("data:")) return url;

  // Direct path (default): warm the cache + decode, hand back the original
  // URL. No fetch() — im.runware.ai has no CORS, so fetch().blob() would throw.
  if (!shouldProxy(url)) {
    await preloadImage(url);
    return url;
  }

  // Proxy path (opt-in): fetch through the Worker and materialize a blob: URL.
  // On error / timeout fall back to the original URL so <img> still tries
  // (possible progressive paint — same as the direct path, never worse).
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), IMAGE_PRELOAD_TIMEOUT_MS);
  try {
    const r = await fetch(proxiedImageUrl(url), { signal: ctrl.signal });
    if (!r.ok) return url;
    const blob = await r.blob();
    return URL.createObjectURL(blob);
  } catch {
    return url;
  } finally {
    clearTimeout(timer);
  }
}

// Module-level cache so speculative prefetches and the eventual commit share
// the same in-flight fetch — no double-download per scene. Keyed by the
// ORIGINAL CDN URL (the blob: URL it resolves to is the value). Persists for
// the page's lifetime; entries are explicitly revoked when the scene swaps.
const blobUrlCache = new Map<string, Promise<string>>();

function getOrCreateBlobUrl(originalUrl: string): Promise<string> {
  let p = blobUrlCache.get(originalUrl);
  if (!p) {
    p = fetchImageAsBlobUrl(originalUrl);
    blobUrlCache.set(originalUrl, p);
  }
  return p;
}

function revokeBlobUrlFor(originalUrl: string): void {
  const p = blobUrlCache.get(originalUrl);
  if (!p) return;
  blobUrlCache.delete(originalUrl);
  p.then((u) => {
    if (u.startsWith("blob:")) URL.revokeObjectURL(u);
  }).catch(() => {});
}

// ──────────────────────────────────────────────────────────────────────
//  Prefetch pool — speculative SceneResponses keyed by choice path.
//
//  Key format: "C1" → reached by choosing C1 from current scene.
//              "C1/C2" → after C1, then C2 (recursive must-pass prefetch).
//
//  When the player picks a change-scene choice, we keep that key's
//  descendants (re-rooted) and abort the rest.
// ──────────────────────────────────────────────────────────────────────

const PREFETCH_MAX_DEPTH = 3;

type PrefetchEntry = {
  promise: Promise<SceneResponse>;
  abort: AbortController;
};

type ScenePathStep = {
  fromScene: Scene;
  fromVisitedBeats: string[];
  exit: { choiceId: string; label: string; nextSceneSeed: string };
};

function pathKey(steps: ScenePathStep[]): string {
  return steps.map((s) => s.exit.choiceId).join("/");
}

function buildSpeculativeSession(
  base: Session,
  steps: ScenePathStep[],
): Session {
  // Drop base's current (last) entry and re-add each step's `fromScene` with
  // its exit set. Final result has `history.length = base.length - 1 + steps.length`.
  const newHistory = [...base.history.slice(0, -1)];
  for (const step of steps) {
    newHistory.push({
      scene: step.fromScene,
      visitedBeatIds: step.fromVisitedBeats,
      exit: {
        kind: "choice",
        choiceId: step.exit.choiceId,
        label: step.exit.label,
        nextSceneSeed: step.exit.nextSceneSeed,
      },
    });
  }
  return { ...base, history: newHistory };
}

function findAllChangeSceneChoices(scene: Scene): BeatChoice[] {
  const result: BeatChoice[] = [];
  const seen = new Set<string>();
  for (const b of scene.beats) {
    if (b.next.type === "choice") {
      for (const c of b.next.choices) {
        if (c.effect.kind === "change-scene" && !seen.has(c.id)) {
          seen.add(c.id);
          result.push(c);
        }
      }
    }
  }
  return result;
}

function findSoleChangeSceneChoice(scene: Scene): BeatChoice | null {
  const all = findAllChangeSceneChoices(scene);
  return all.length === 1 ? all[0]! : null;
}

function prefetchScenePath(
  pool: Map<string, PrefetchEntry>,
  baseSession: Session,
  steps: ScenePathStep[],
  depth: number,
  clientTts: boolean,
): void {
  if (depth >= PREFETCH_MAX_DEPTH) return;
  const key = pathKey(steps);
  if (pool.has(key)) return;

  const specSession = buildSpeculativeSession(baseSession, steps);
  const abort = new AbortController();
  const promise = (async () => {
    const res = await fetch("/api/scene", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...getByoHeaders(),
      },
      body: JSON.stringify({ session: stripVoicesForTransport(specSession), clientTts }),
      signal: abort.signal,
    });
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(j.error ?? res.statusText);
    }
    const data = (await res.json()) as SceneResponse;

    // Kick off the blob fetch for this URL so when the player eventually
    // picks this choice, transitioning is a no-op cache lookup instead of a
    // fresh CDN download. Don't await — let it run in the background; the
    // transition path awaits the same cached promise via getOrCreateBlobUrl.
    void getOrCreateBlobUrl(data.imageUrl);

    // Re-attach locally-held voices the server stripped from known characters.
    data.characters = mergeCharactersPreserveVoice(
      baseSession.characters,
      data.characters,
    );

    // Recursive: if the resulting scene has exactly one change-scene exit,
    // it is a must-pass node — prefetch its child too.
    if (depth + 1 < PREFETCH_MAX_DEPTH) {
      const sole = findSoleChangeSceneChoice(data.scene);
      if (sole && sole.effect.kind === "change-scene") {
        const nextStep: ScenePathStep = {
          fromScene: data.scene,
          fromVisitedBeats: [data.scene.entryBeatId],
          exit: {
            choiceId: sole.id,
            label: sole.label,
            nextSceneSeed: sole.effect.nextSceneSeed,
          },
        };
        // Carry forward the registry that the parent prefetch result already
        // settled (it may include characters introduced by the intermediate
        // scene). Without this, the L2+ prefetch starts from the original
        // base.characters and a later transition through this survivor would
        // silently drop voices the player has already heard.
        const carriedBase: Session = {
          ...baseSession,
          characters: data.characters,
          storyState: data.storyState,
        };
        prefetchScenePath(
          pool,
          carriedBase,
          [...steps, nextStep],
          depth + 1,
          clientTts,
        );
      }
    }

    return data;
  })();

  promise.catch(() => {});
  pool.set(key, { promise, abort });
}

function consumeChoice(
  pool: Map<string, PrefetchEntry>,
  choiceId: string,
): PrefetchEntry | undefined {
  const my = pool.get(choiceId);
  const survivors = new Map<string, PrefetchEntry>();
  for (const [key, entry] of pool) {
    if (key === choiceId) continue;
    if (key.startsWith(choiceId + "/")) {
      survivors.set(key.slice(choiceId.length + 1), entry);
    } else {
      entry.abort.abort();
    }
  }
  pool.clear();
  for (const [k, e] of survivors) pool.set(k, e);
  return my;
}

function clearPool(pool: Map<string, PrefetchEntry>): void {
  for (const e of pool.values()) e.abort.abort();
  pool.clear();
}

// ──────────────────────────────────────────────────────────────────────
//  BYO voice resolution (client-direct Xiaomi TTS).
//
//  In BYO mode the server skips all TTS (clientTts:true), so the browser must
//  obtain each speaker's reference audio itself. `cache` is keyed by character
//  NAME and persists for the whole session, so a voice locked in on a
//  character's first speaking beat stays identical across every later scene —
//  even though /api/scene returns its characters without `.voice`. Storing the
//  in-flight Promise (not the resolved value) dedupes the burst of concurrent
//  beats by the same speaker into ONE voicedesign call, which matters because
//  Xiaomi rate-limits voicedesign hard.
// ──────────────────────────────────────────────────────────────────────

async function resolveByoVoice(
  cache: Map<string, Promise<CharacterVoice>>,
  cfg: TtsConfig,
  speaker: Character,
): Promise<CharacterVoice | null> {
  const cached = cache.get(speaker.name);
  if (cached) return cached;
  // Prebaked cards ship baked reference audio — reuse it directly (cross-key
  // synth with the user's key works), keeping the prebaked voice identical.
  if (speaker.voice) {
    const ready = Promise.resolve(speaker.voice);
    cache.set(speaker.name, ready);
    return ready;
  }
  if (!speaker.voiceDescription) return null;
  const p = provisionVoice(cfg, speaker.voiceDescription);
  cache.set(speaker.name, p);
  try {
    return await p;
  } catch (e) {
    cache.delete(speaker.name); // failed provision — let a later beat retry
    throw e;
  }
}

// ──────────────────────────────────────────────────────────────────────
//  Component
// ──────────────────────────────────────────────────────────────────────

function PlayInner() {
  const router = useRouter();
  const params = useSearchParams();

  const [phase, setPhase] = useState<Phase>("loading-first");
  const [session, setSession] = useState<Session | null>(null);
  const [currentScene, setCurrentScene] = useState<Scene | null>(null);
  const [currentBeatId, setCurrentBeatId] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [beatAudioMap, setBeatAudioMap] = useState<Record<string, string>>({});
  // Lazy-initialize 优先级：本局选择(homepage 的「语音配音」存到 sessionStorage:infiplot:custom)
  // > 上次会话的粘性偏好(localStorage:infiplot:muted) > 默认非静音。
  // 这样首页选了「关闭」开始游戏，进来就是静音；选「开启」就不是静音；进入 play 页后用户自己
  // 切换 静音/有声 时再用 localStorage 持久化，下一局开新游戏 sessionStorage 选择会再覆盖。
  const [muted, setMuted] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      const stored = window.sessionStorage.getItem("infiplot:custom");
      if (stored) {
        const parsed = JSON.parse(stored) as { audioEnabled?: boolean };
        if (typeof parsed.audioEnabled === "boolean") {
          return !parsed.audioEnabled;
        }
      }
      return window.localStorage.getItem(MUTED_STORAGE_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [pendingClick, setPendingClick] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [presentation, setPresentation] = useState(false);
  // Session-locked image orientation (see detectOrientation). "portrait" makes
  // the whole play surface render full-bleed vertical on phones.
  const [orientation, setOrientation] = useState<Orientation>("landscape");
  const [lastExitLabel, setLastExitLabel] = useState<string | null>(null);
  // Consecutive server-side TTS misses (null audio / failed /api/beat-audio).
  // Climbs when the shared server key is rate-limited by MiMo — the exact pain
  // BYO fixes — so the play page can nudge non-BYO users to add their own key.
  // Reset to 0 on any successful synth. Only the server path touches it.
  const [silenceStrikes, setSilenceStrikes] = useState(0);
  // Once the player dismisses the silence nudge, keep it gone for this session.
  const [nudgeDismissed, setNudgeDismissed] = useState(false);
  // The in-place BYO-key modal, opened from the silence nudge so the player can
  // add a key without leaving the play page.
  const [ttsModalOpen, setTtsModalOpen] = useState(false);

  const startedRef = useRef(false);
  const poolRef = useRef<Map<string, PrefetchEntry>>(new Map());
  // Lazy per-beat audio fetches keyed by beat.id. Aborted when the scene
  // changes so stale in-flight requests can't poison the new scene's map
  // (beat ids like "b1" are scene-local and would collide across scenes).
  const beatAudioAbortRef = useRef<Map<string, AbortController>>(new Map());
  // Mirrors `muted` so the closure-stable fetchBeatAudio (deps []) can gate on
  // it. Muting stops TTS *synthesis*, not just playback — TTS is the only sound
  // source, so synthesizing audio the user can't hear just burns quota.
  // 首页「语音配音 关闭」会把 muted 初值置为 true（见上方 useState 初始化），
  // 不再单独维护 audioEnabledRef —— 单一来源避免两个 flag 漂移。
  const mutedRef = useRef<boolean>(muted);

  // Resolved bring-your-own Xiaomi TTS config (region preset + key), read once
  // from localStorage. When non-null, the browser provisions + synths voices
  // directly against Xiaomi — the key never touches our server — and every
  // start/scene/insert-beat request carries clientTts:true so the engine skips
  // server-side TTS. null = user hasn't opted in (server default / silent).
  const [byoTtsConfig, setByoTtsConfig] = useState<TtsConfig | null>(() =>
    loadClientTtsConfig(),
  );
  const byoTtsRef = useRef<TtsConfig | null>(byoTtsConfig);
  // BYO voice cache (see resolveByoVoice). Keyed by character name; persists
  // across scenes so each speaker is provisioned at most once per session.
  const provisionedVoicesRef = useRef<Map<string, Promise<CharacterVoice>>>(
    new Map(),
  );

  // Mirrors for use inside async handlers (closure-stable)
  const sessionRef = useRef<Session | null>(null);
  const currentSceneRef = useRef<Scene | null>(null);
  const currentBeatRef = useRef<Beat | null>(null);
  const visitedBeatsRef = useRef<string[]>([]);
  // Original (CDN) URL of the currently-rendered scene image. Used as the key
  // to revoke its blob: URL when the scene swaps. We track the ORIGINAL URL,
  // not the blob URL, because blobUrlCache is keyed by original URL.
  const lastImageOriginalUrlRef = useRef<string | null>(null);

  const currentBeat = useMemo<Beat | null>(() => {
    if (!currentScene || !currentBeatId) return null;
    return currentScene.beats.find((b) => b.id === currentBeatId) ?? null;
  }, [currentScene, currentBeatId]);

  const audioSrc = (currentBeat ? beatAudioMap[currentBeat.id] : undefined) ?? null;

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);
  useEffect(() => {
    currentSceneRef.current = currentScene;
  }, [currentScene]);
  useEffect(() => {
    currentBeatRef.current = currentBeat;
  }, [currentBeat]);
  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);

  // Coarse liveness ping for active-time analytics. /play is a single SPA
  // route, so page views alone read as ~0 duration; a 30s heartbeat (only
  // while the tab is visible) gives Umami the timestamps to derive real
  // engaged time. Content-free — no payload. The interval is never even
  // scheduled unless the tracker is configured, so it's zero work when off.
  useEffect(() => {
    if (!process.env.NEXT_PUBLIC_UMAMI_SRC || !process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID) {
      return;
    }
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") track("play_heartbeat");
    }, 30_000);
    return () => window.clearInterval(id);
  }, []);

  // Whenever currentBeatId changes, append it to visited (skip consecutive dups)
  useEffect(() => {
    if (!currentBeatId) return;
    if (visitedBeatsRef.current.at(-1) === currentBeatId) return;
    visitedBeatsRef.current = [...visitedBeatsRef.current, currentBeatId];
    setSession((s) => {
      if (!s) return s;
      return {
        ...s,
        history: s.history.map((h, i, arr) =>
          i === arr.length - 1
            ? { ...h, visitedBeatIds: [...visitedBeatsRef.current] }
            : h,
        ),
      };
    });
  }, [currentBeatId]);

  // ── Lazy per-beat audio fetch ────────────────────────────────────────
  // Returns silently on any failure — the UI never waits for audio, so a
  // null result just means that beat plays without voice.
  // Sends only the speaker's voice + the line to speak — NOT the whole
  // session — so the per-beat payload stays small even with many characters
  // (each voice.referenceAudioBase64 is ~160KB).
  const fetchBeatAudio = useCallback(
    async (
      sess: Session,
      beat: { id: string; speaker?: string; line?: string; lineDelivery?: string },
    ): Promise<void> => {
      if (mutedRef.current) return; // 静音 → 不合成 TTS（避免无谓的调用与花费）。
      // 「首页选关闭」也走这条路：bootstrap 时 muted 已被初始化为 true。
      if (!beat.speaker || !beat.line) return;
      const speaker = sess.characters.find((c) => c.name === beat.speaker);
      if (!speaker) return;

      const byo = byoTtsRef.current;
      // Non-BYO relies on the server having provisioned speaker.voice. BYO
      // skipped server TTS, so it needs a baked voice (prebaked card) or a
      // voiceDescription to provision from in the browser.
      if (!byo && !speaker.voice) return;
      if (byo && !speaker.voice && !speaker.voiceDescription) return;

      if (beatAudioAbortRef.current.has(beat.id)) return;
      const abort = new AbortController();
      beatAudioAbortRef.current.set(beat.id, abort);
      try {
        let audioUrl: string | null = null;
        if (byo) {
          // Client-direct: provision (once per speaker, cached) + synth against
          // Xiaomi with the user's own key — no /api/beat-audio round-trip and
          // the key never touches our server.
          const voice = await resolveByoVoice(
            provisionedVoicesRef.current,
            byo,
            speaker,
          );
          if (!voice || abort.signal.aborted) return;
          const out = await synthesize(
            byo,
            voice,
            beat.line,
            beat.lineDelivery,
            abort.signal,
          );
          audioUrl = `data:${out.mimeType};base64,${out.audioBase64}`;
        } else {
          const res = await fetch("/api/beat-audio", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...getByoHeaders(),
            },
            body: JSON.stringify({
              beat: { id: beat.id, line: beat.line, lineDelivery: beat.lineDelivery },
              voice: speaker.voice,
            }),
            signal: abort.signal,
          });
          if (res.status === 204) {
            setSilenceStrikes((n) => Math.min(n + 1, 99));
            return;
          }
          if (!res.ok) {
            setSilenceStrikes((n) => Math.min(n + 1, 99));
            return;
          }
          const blob = await res.blob();
          audioUrl = URL.createObjectURL(blob);
          setSilenceStrikes(0);
        }
        // Skip the state write if we've been aborted between the await and
        // here — beat ids are scene-local, so a late arrival from a prior
        // scene would otherwise overwrite the current scene's audio under the
        // same id.
        if (audioUrl && !abort.signal.aborted) {
          setBeatAudioMap((m) => ({ ...m, [beat.id]: audioUrl }));
        } else if (audioUrl?.startsWith("blob:")) {
          URL.revokeObjectURL(audioUrl);
        }
      } catch {
        // aborted / network / Xiaomi rate-limit — silent fallback (no audio)
      } finally {
        // Only clear the slot if it's still ours. An aborted prior fetch
        // running its finally late could otherwise delete the controller of a
        // new fetch that took the same beat id, leaving the new one
        // unabortable on the next scene change.
        if (beatAudioAbortRef.current.get(beat.id) === abort) {
          beatAudioAbortRef.current.delete(beat.id);
        }
      }
    },
    [],
  );

  function cancelBeatAudioFetches(): void {
    for (const c of beatAudioAbortRef.current.values()) c.abort();
    beatAudioAbortRef.current.clear();
  }

  // Fire one /api/beat-audio request per speaking beat in the current scene.
  // Reads refs (not props) so it stays closure-stable and can be re-run on
  // un-mute as well as on scene change.
  const prefetchSceneAudio = useCallback(() => {
    const scene = currentSceneRef.current;
    const sess = sessionRef.current;
    if (!scene || !sess) return;
    for (const b of scene.beats) {
      if (b.speaker && b.line) void fetchBeatAudio(sess, b);
    }
  }, [fetchBeatAudio]);

  // (Re)synthesize each time the scene changes. Cancel any in-flight requests
  // from the prior scene first — beat ids are scene-local ("b1" repeats across
  // scenes) so a late arrival would land under the wrong beat otherwise.
  useEffect(() => {
    cancelBeatAudioFetches();
    setBeatAudioMap((prev) => {
      for (const url of Object.values(prev)) {
        if (url.startsWith("blob:")) URL.revokeObjectURL(url);
      }
      return {};
    });
    prefetchSceneAudio();
  }, [currentScene?.id, prefetchSceneAudio]);

  // ── Mute persistence (read is via the useState lazy initializer above) ─
  const toggleMuted = useCallback(() => {
    track("tts_toggle", { muted: !mutedRef.current });
    setMuted((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(MUTED_STORAGE_KEY, next ? "1" : "0");
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  // Muting stops synthesis, not just playback: abort in-flight requests when
  // muting. When un-muting, re-synthesize the current scene — fetchBeatAudio
  // skips synthesis while muted, so a scene entered muted has no audio to play
  // back otherwise. (Clearing the map re-synthesizes already-fetched beats on a
  // mid-scene un-mute, but that's bounded to one scene and a rare toggle.)
  //
  // Gate on actual mute *transitions*: on mount this effect would otherwise
  // fire alongside the scene effect above (both call prefetchSceneAudio),
  // doubling the initial /api/beat-audio batch — the first set is dispatched
  // only to be aborted mid-flight, burning TTS quota.
  const prevMutedRef = useRef(muted);
  useEffect(() => {
    const prev = prevMutedRef.current;
    prevMutedRef.current = muted;
    if (prev === muted) return;
    cancelBeatAudioFetches();
    if (muted) return;
    setBeatAudioMap((prev) => {
      for (const url of Object.values(prev)) {
        if (url.startsWith("blob:")) URL.revokeObjectURL(url);
      }
      return {};
    });
    prefetchSceneAudio();
  }, [muted, prefetchSceneAudio]);

  // ── BYO key enabled/disabled from the play page (silence nudge → modal) ─
  // On enable: point the synth path at the user's key and immediately
  // re-synthesize the current scene in-browser, so the voices the player just
  // missed come back without a reload (their characters already carry
  // server-provisioned `voice`, which resolveByoVoice reuses with the new key).
  // On disable: just stop using it; later scenes fall back to the server.
  const handleByoSaved = useCallback(
    (configured: boolean) => {
      const cfg = configured ? loadClientTtsConfig() : null;
      byoTtsRef.current = cfg;
      setByoTtsConfig(cfg);
      if (cfg) {
        setSilenceStrikes(0);
        cancelBeatAudioFetches();
        setBeatAudioMap((prev) => {
          for (const url of Object.values(prev)) {
            if (url.startsWith("blob:")) URL.revokeObjectURL(url);
          }
          return {};
        });
        prefetchSceneAudio();
      }
    },
    [prefetchSceneAudio],
  );

  // ── Presentation mode toggle ─────────────────────────────────────────
  const togglePresentation = useCallback(async () => {
    const entering = !presentation;
    track("fullscreen_toggle", { on: entering });
    if (entering) {
      try {
        if (!document.fullscreenElement) {
          await document.documentElement.requestFullscreen();
        }
      } catch {
        // ignore — fall through to chrome-less mode anyway
      }
      setPresentation(true);
    } else {
      try {
        if (document.fullscreenElement) await document.exitFullscreen();
      } catch {
        // ignore
      }
      setPresentation(false);
    }
  }, [presentation]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "f" || e.key === "F") {
        if (e.metaKey || e.ctrlKey || e.altKey) return;
        e.preventDefault();
        void togglePresentation();
      } else if (e.key === "Escape" && presentation) {
        setPresentation(false);
      }
    }
    function onFullscreenChange() {
      if (!document.fullscreenElement && presentation) setPresentation(false);
    }
    window.addEventListener("keydown", onKey);
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("fullscreenchange", onFullscreenChange);
    };
  }, [togglePresentation, presentation]);

  // Lock the visible orientation BEFORE the first paint, so portrait phones
  // never flash the landscape loading chrome. The state inits to "landscape"
  // for SSR-safety; this corrects it pre-paint (no-op re-render on landscape
  // devices). Prebaked cards (decision C) stay landscape-baked regardless of
  // device. The bootstrap effect below re-derives the same value for the
  // /api/start payload.
  useIsomorphicLayoutEffect(() => {
    setOrientation(params.get("card") ? "landscape" : detectOrientation());
  }, [params]);

  // ── Bootstrap: start session ─────────────────────────────────────────
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    // 三条进入路径：
    //   ?card=<m0..f31>      → 首页精选卡，直接从 /home/firstact/{name}.json
    //                          静态文件加载（已在构建期 prebake，免一切引擎调用）
    //   ?preset=<id>         → 内置 PRESETS（仍走 /api/start 现场生成）
    //   ?custom=1            → 用户自定义 prompt，sessionStorage 取 ws/sg
    //                          后走 /api/start 现场生成
    const cardName = params.get("card");
    const presetId = params.get("preset");
    const isCustom = params.get("custom") === "1";

    let livePayload: {
      worldSetting: string;
      styleGuide: string;
      styleReferenceImage?: string;
      orientation?: Orientation;
    } | null = null;
    if (!cardName) {
      if (presetId) {
        const p = PRESETS.find((x) => x.id === presetId);
        if (p) livePayload = { worldSetting: p.worldSetting, styleGuide: p.styleGuide };
      } else if (isCustom) {
        const stored = sessionStorage.getItem("infiplot:custom");
        if (stored) {
          try {
            const parsed = JSON.parse(stored) as {
              worldSetting: string;
              styleGuide: string;
              audioEnabled?: boolean;
              styleReferenceImage?: string;
            };
            livePayload = {
              worldSetting: parsed.worldSetting,
              styleGuide: parsed.styleGuide,
              styleReferenceImage: parsed.styleReferenceImage || undefined,
            };
            // audioEnabled 已在 useState 初始化时反向投射到 muted；这里无需再额外存。
          } catch {
            livePayload = null;
          }
        }
      }
    }

    // Lock orientation for the whole session. Prebaked cards (decision C) are
    // landscape-baked, so they stay landscape regardless of device; only the
    // live /api/start path requests a portrait paint when the phone is upright.
    // The visible state is already set pre-paint by the layout effect above;
    // here we only need the value for the /api/start payload.
    const sessionOrientation: Orientation = cardName
      ? "landscape"
      : detectOrientation();
    if (livePayload) livePayload.orientation = sessionOrientation;

    if (!cardName && !livePayload) {
      router.replace("/");
      return;
    }

    type PrebakedFirstAct = StartResponse & {
      worldSetting: string;
      styleGuide: string;
      // Live /api/start path tags this on after the response (prebaked card
      // JSONs never have one — they were rendered at build time without any
      // user-uploaded reference). Carried into Session so /api/scene's painter
      // anchors the same style image on every subsequent scene.
      styleReferenceImage?: string;
      cardName?: string;
      cardTitle?: string;
      cardGender?: string;
    };

    const fetchStart: Promise<PrebakedFirstAct> = cardName
      ? fetch(`/home/firstact/${encodeURIComponent(cardName)}.json`).then(
          async (r) => {
            if (!r.ok) throw new Error(`找不到精选剧情：${cardName}`);
            return (await r.json()) as PrebakedFirstAct;
          },
        )
      : fetch("/api/start", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...getByoHeaders(),
          },
          body: JSON.stringify({
            ...livePayload,
            clientTts: !!byoTtsRef.current,
          }),
        }).then(async (r) => {
          if (!r.ok) {
            const j = (await r.json().catch(() => ({}))) as { error?: string };
            throw new Error(j.error ?? r.statusText);
          }
          const data = (await r.json()) as StartResponse;
          // Live /api/start doesn't echo ws/sg back — splice in what we sent.
          // styleReferenceImage is similarly not in StartResponse; tag it on so
          // the session we build below carries it for every /api/scene call.
          return {
            ...data,
            worldSetting: livePayload!.worldSetting,
            styleGuide: livePayload!.styleGuide,
            styleReferenceImage: livePayload!.styleReferenceImage,
          };
        });

    fetchStart
      .then(async (data) => {
        // Resolve to a paintable src before committing to state. Proxy path:
        // a fully-local blob: URL the browser paints atomically (no row-by-row
        // "层层加载"). Direct path (default): the preloaded original URL.
        const blobUrl = await getOrCreateBlobUrl(data.imageUrl);
        lastImageOriginalUrlRef.current = data.imageUrl;

        const initial: Session = {
          id: data.sessionId,
          createdAt: Date.now(),
          worldSetting: data.worldSetting,
          styleGuide: data.styleGuide,
          history: [
            {
              scene: data.scene,
              visitedBeatIds: [data.scene.entryBeatId],
            },
          ],
          characters: data.characters,
          storyState: data.storyState,
          styleReferenceImage: data.styleReferenceImage,
          orientation: data.scene.orientation ?? sessionOrientation,
        };
        visitedBeatsRef.current = [data.scene.entryBeatId];
        setSession(initial);
        setCurrentScene(data.scene);
        setCurrentBeatId(data.scene.entryBeatId);
        setImageUrl(blobUrl);
        // beatAudioMap is populated lazily by the per-beat fetch effect once
        // currentScene becomes non-null (see fetchBeatAudio).
        setPhase("ready");
        track("scene_reached", { scene_index: initial.history.length });
      })
      .catch((e) => setError(String(e)));
  }, [params, router]);

  // ── Prefetch on scene entry: L1 + recursive L2/L3 for must-pass ──────
  useEffect(() => {
    const s = session;
    const scene = currentScene;
    if (!s || !scene) return;

    const exits = findAllChangeSceneChoices(scene);
    for (const choice of exits) {
      if (choice.effect.kind !== "change-scene") continue;
      const step: ScenePathStep = {
        fromScene: scene,
        // Snapshot of visited beats at prefetch start. Slight drift is OK.
        fromVisitedBeats: [...visitedBeatsRef.current],
        exit: {
          choiceId: choice.id,
          label: choice.label,
          nextSceneSeed: choice.effect.nextSceneSeed,
        },
      };
      prefetchScenePath(poolRef.current, s, [step], 0, !!byoTtsRef.current);
    }
  }, [currentScene?.id, session?.id]);

  // Abort all in-flight speculative prefetches when the page unmounts, so we
  // stop paying for background scene/image generation. Empty deps → fires only
  // on unmount; it must NOT run on scene transitions, which rely on
  // consumeChoice keeping the re-rooted survivor prefetches alive.
  // Also revoke any surviving blob: URLs so their bytes can be GC'd — the
  // module-level blobUrlCache outlives the component but its entries should
  // not survive the page navigation that unmounts us.
  useEffect(() => {
    const pool = poolRef.current;
    const beatAborts = beatAudioAbortRef.current;
    return () => {
      clearPool(pool);
      for (const c of beatAborts.values()) c.abort();
      beatAborts.clear();
      for (const [originalUrl] of blobUrlCache) {
        revokeBlobUrlFor(originalUrl);
      }
    };
  }, []);

  // ── Handlers ──────────────────────────────────────────────────────────

  function onAdvance() {
    if (phase !== "ready") return;
    const beat = currentBeatRef.current;
    if (!beat || beat.next.type !== "continue") return;
    setCurrentBeatId(beat.next.nextBeatId);
  }

  async function performSceneTransition(
    source: PrefetchEntry | Promise<SceneResponse>,
    exit: SceneExit,
    visitedForCurrent: string[],
    exitLabel: string,
  ) {
    setPhase("transitioning");
    setPendingClick(null);
    try {
      const result = await ("promise" in source ? source.promise : source);

      const base = sessionRef.current;
      if (!base) throw new Error("Session lost mid-transition");

      // Pull full image bytes into a local blob: URL before committing. For
      // prefetched scenes the speculative getOrCreateBlobUrl in
      // prefetchScenePath already has this in flight (often resolved), so
      // this is a near-instant cache lookup. For cold transitions we eat the
      // CDN download / preload time under the "transitioning" overlay. Proxy
      // path: the <img> then gets a fully-local blob (no progressive paint);
      // direct path (default): the preloaded original URL.
      const blobUrl = await getOrCreateBlobUrl(result.imageUrl);
      // Revoke the previous scene's blob (no longer rendered) to release JS
      // heap. New scene's original URL takes its place as "current".
      const priorOriginal = lastImageOriginalUrlRef.current;
      if (priorOriginal && priorOriginal !== result.imageUrl) {
        revokeBlobUrlFor(priorOriginal);
      }
      lastImageOriginalUrlRef.current = result.imageUrl;

      const closedHistory = base.history.map((h, i, arr) =>
        i === arr.length - 1
          ? { ...h, visitedBeatIds: visitedForCurrent, exit }
          : h,
      );
      const newSession: Session = {
        ...base,
        history: [
          ...closedHistory,
          {
            scene: result.scene,
            visitedBeatIds: [result.scene.entryBeatId],
          },
        ],
        characters: mergeCharactersPreserveVoice(
          base.characters,
          result.characters,
        ),
        storyState: result.storyState,
      };
      visitedBeatsRef.current = [result.scene.entryBeatId];
      setSession(newSession);
      setCurrentScene(result.scene);
      setCurrentBeatId(result.scene.entryBeatId);
      setImageUrl(blobUrl);
      // beatAudioMap reset + per-beat fetches kicked off by the scene effect.
      setLastExitLabel(exitLabel);
      setPhase("ready");
      track("scene_reached", { scene_index: newSession.history.length });
    } catch (e) {
      if ((e as { name?: string }).name === "AbortError") {
        setPhase("ready");
        return;
      }
      setError(String(e));
      setPhase("ready");
    }
  }

  function onSelectChoice(choice: BeatChoice) {
    if (phase !== "ready" || !session || !currentScene) return;

    const beatNext = currentBeatRef.current?.next;
    const choiceIndex =
      beatNext?.type === "choice"
        ? beatNext.choices.findIndex((c) => c.id === choice.id)
        : -1;
    if (choiceIndex >= 0) {
      track("choice_select", {
        scene_index: session.history.length,
        choice_index: choiceIndex,
        kind: choice.effect.kind,
      });
    }

    if (choice.effect.kind === "advance-beat") {
      // Pure local jump. No network. No pool changes.
      setCurrentBeatId(choice.effect.targetBeatId);
      return;
    }

    const visited = [...visitedBeatsRef.current];
    const exit: SceneExit = {
      kind: "choice",
      choiceId: choice.id,
      label: choice.label,
      nextSceneSeed: choice.effect.nextSceneSeed,
    };

    const cached = consumeChoice(poolRef.current, choice.id);
    if (cached) {
      void performSceneTransition(cached, exit, visited, choice.label);
      return;
    }

    // Cold path — start a fresh fetch
    const step: ScenePathStep = {
      fromScene: currentScene,
      fromVisitedBeats: visited,
      exit: {
        choiceId: choice.id,
        label: choice.label,
        nextSceneSeed: choice.effect.nextSceneSeed,
      },
    };
    const specSession = buildSpeculativeSession(session, [step]);
    clearPool(poolRef.current);

    const promise = (async () => {
      const res = await fetch("/api/scene", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getByoHeaders(),
        },
        body: JSON.stringify({
          session: stripVoicesForTransport(specSession),
          clientTts: !!byoTtsRef.current,
        }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? res.statusText);
      }
      return (await res.json()) as SceneResponse;
    })();

    void performSceneTransition(promise, exit, visited, choice.label);
  }

  async function onBackgroundClick(click: { x: number; y: number }) {
    if (phase !== "ready" || !session || !currentScene || !imageUrl) return;
    setPhase("vision-thinking");
    setPendingClick(click);

    try {
      const annotatedImageBase64 = await annotateClick(imageUrl, click);
      const visionRes = await fetch("/api/vision", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getByoHeaders(),
        },
        body: JSON.stringify({ session: stripVoicesForTransport(session), annotatedImageBase64 }),
      });
      if (!visionRes.ok) {
        const j = (await visionRes.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(j.error ?? visionRes.statusText);
      }
      const decision = (await visionRes.json()) as VisionResponse;
      track("vision_click", { result: decision.classify });

      if (decision.classify === "insert-beat") {
        setPhase("inserting-beat");
        const insertRes = await fetch("/api/insert-beat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...getByoHeaders(),
          },
          body: JSON.stringify({
            session: stripVoicesForTransport(session),
            freeformAction: decision.intent.freeformAction,
            clientTts: !!byoTtsRef.current,
          }),
        });
        if (!insertRes.ok) {
          const j = (await insertRes.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(j.error ?? insertRes.statusText);
        }
        const { partial, characters: insertChars } =
          (await insertRes.json()) as InsertBeatResponse;

        const fromBeatId =
          currentBeatRef.current?.id ?? currentScene.entryBeatId;
        const newBeatId = `b_ins_${Date.now()}_${Math.random()
          .toString(36)
          .slice(2, 6)}`;
        const newBeat: Beat = {
          id: newBeatId,
          narration: partial.narration,
          speaker: partial.speaker,
          line: partial.line,
          lineDelivery: partial.lineDelivery,
          next: { type: "continue", nextBeatId: fromBeatId },
        };

        const patched: Scene = {
          ...currentScene,
          beats: [...currentScene.beats, newBeat],
        };

        const nextSession: Session = {
          ...session,
          history: session.history.map((h, i, arr) =>
            i === arr.length - 1 ? { ...h, scene: patched } : h,
          ),
          characters: mergeCharactersPreserveVoice(
            session.characters,
            insertChars,
          ),
        };
        setSession(nextSession);
        setCurrentScene(patched);
        setCurrentBeatId(newBeatId);
        // Insert-beat doesn't change scene.id, so the scene effect won't
        // re-fire — manually kick off the audio fetch for the new beat.
        if (newBeat.speaker && newBeat.line) {
          void fetchBeatAudio(nextSession, {
            id: newBeatId,
            speaker: newBeat.speaker,
            line: newBeat.line,
            lineDelivery: newBeat.lineDelivery,
          });
        }
        setLastExitLabel(decision.intent.freeformAction);
        setPhase("ready");
        setPendingClick(null);
      } else {
        const exit: SceneExit = {
          kind: "freeform",
          action: decision.intent.freeformAction,
        };
        const visited = [...visitedBeatsRef.current];
        const base = sessionRef.current;
        if (!base) {
          setPhase("ready");
          setPendingClick(null);
          return;
        }
        const specSession: Session = {
          ...base,
          history: base.history.map((h, i, arr) =>
            i === arr.length - 1 ? { ...h, visitedBeatIds: visited, exit } : h,
          ),
        };
        clearPool(poolRef.current);

        const promise = (async () => {
          const res = await fetch("/api/scene", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...getByoHeaders(),
            },
            body: JSON.stringify({
              session: stripVoicesForTransport(specSession),
              clientTts: !!byoTtsRef.current,
            }),
          });
          if (!res.ok) {
            const j = (await res.json().catch(() => ({}))) as {
              error?: string;
            };
            throw new Error(j.error ?? res.statusText);
          }
          return (await res.json()) as SceneResponse;
        })();

        await performSceneTransition(
          promise,
          exit,
          visited,
          decision.intent.freeformAction,
        );
      }
    } catch (e) {
      setError(String(e));
      setPendingClick(null);
      setPhase("ready");
    }
  }

  // ── Render ────────────────────────────────────────────────────────────

  if (error) {
    const byoOn = isByoActive();

    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-8">
        <div className="max-w-md text-center animate-fade-in">
          <p className="text-[10px] smallcaps text-clay-500 mb-6">
            出 · 了 · 点 · 状 · 况
          </p>
          <p className="font-serif italic text-clay-900 text-lg leading-[1.7] mb-6">
            {error}
          </p>
          {byoOn && (
            <p className="font-sans text-xs text-ember-600 mb-10 leading-relaxed">
              提示：当前已启用「自带 API」。如果请求失败，请返回首页并检查右上角 API 配置的 Key、Endpoint 和 Model 是否正确，并确认您的服务额度充足。
            </p>
          )}
          <Link
            href="/"
            className={"text-[10px] smallcaps text-clay-700 hover:text-ember-500 transition-colors inline-flex items-center gap-3" + (byoOn ? "" : " mt-4")}
          >
            <i className="fa-solid fa-arrow-left text-[9px]" />
            返 回
          </Link>
        </div>
      </div>
    );
  }

  // Mobile portrait renders full-bleed by default — it sidesteps the iOS
  // Safari Fullscreen API (unsupported on iPhone) with a CSS full-viewport
  // layout instead. Desktop "presentation" mode shares the same immersive
  // canvas, toggled via the F key.
  const immersive = presentation || orientation === "portrait";

  if (immersive) {
    return (
      <div className="fixed inset-0 bg-black flex items-center justify-center z-50">
        <PlayCanvas
          imageUrl={imageUrl}
          audioSrc={audioSrc}
          muted={muted}
          phase={phase}
          beat={currentBeat}
          pendingClick={pendingClick}
          onBackgroundClick={onBackgroundClick}
          onAdvance={onAdvance}
          onSelectChoice={onSelectChoice}
          orientation={orientation}
          fullViewport
        />
        {orientation === "portrait" && (
          <div
            className="absolute inset-x-0 top-0 z-10 flex items-center justify-between px-4 pointer-events-none"
            style={{ paddingTop: "max(0.5rem, env(safe-area-inset-top))" }}
          >
            <Link
              href="/"
              className="pointer-events-auto flex h-9 w-9 items-center justify-center rounded-full bg-black/40 text-white/80 backdrop-blur-sm transition-colors hover:text-white"
              aria-label="返回"
            >
              <i className="fa-solid fa-arrow-left text-[13px]" />
            </Link>
            <button
              type="button"
              onClick={toggleMuted}
              className="pointer-events-auto flex h-9 w-9 items-center justify-center rounded-full bg-black/40 text-white/80 backdrop-blur-sm transition-colors hover:text-white"
              aria-label={muted ? "取消静音" : "静音"}
            >
              <i
                className={`fa-solid ${muted ? "fa-volume-xmark" : "fa-volume-high"} text-[13px]`}
              />
            </button>
          </div>
        )}
      </div>
    );
  }

  const sceneCount = session?.history.length ?? 0;
  const beatCount = visitedBeatsRef.current.length;

  // Surface the BYO-key nudge only to an unmuted, non-BYO player whose last few
  // beats came back silent (shared key rate-limited) — the exact pain BYO fixes.
  // Dismissible for the session.
  const showSilenceNudge =
    phase === "ready" &&
    !muted &&
    !byoTtsConfig &&
    !nudgeDismissed &&
    silenceStrikes >= SILENCE_NUDGE_THRESHOLD;

  return (
    <div className="min-h-screen flex flex-col">
      <header className="px-5 md:px-12 pt-6 md:pt-8 flex items-center justify-between">
        <Link
          href="/"
          className="text-clay-600 hover:text-clay-900 transition-colors flex items-center gap-3"
        >
          <i className="fa-solid fa-arrow-left text-[12px]" />
          <span className="font-serif text-[22px] md:text-[26px] leading-none tracking-tight">
            Infi<em className="italic font-light text-ember-500">Plot</em>
          </span>
        </Link>
        <div className="flex items-center gap-3 text-[10px] smallcaps text-clay-500 num">
          <span>第 · {String(sceneCount).padStart(3, "0")} · 幕</span>
          <span className="text-clay-300">·</span>
          <span>{String(beatCount).padStart(3, "0")} · 拍</span>
        </div>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center px-4 md:px-8 py-6 md:py-10">
        <PlayCanvas
          imageUrl={imageUrl}
          audioSrc={audioSrc}
          muted={muted}
          phase={phase}
          beat={currentBeat}
          pendingClick={pendingClick}
          onBackgroundClick={onBackgroundClick}
          onAdvance={onAdvance}
          onSelectChoice={onSelectChoice}
          orientation={orientation}
          aboveCanvas={
            <button
              type="button"
              onClick={() => void togglePresentation()}
              className="text-[10px] smallcaps text-clay-500 hover:text-ember-500 transition-colors flex items-center gap-2"
              aria-label="进入全屏"
              title="全屏 (F)"
            >
              <i className="fa-solid fa-expand text-[10px]" />
              F · 键 · 全 · 屏
            </button>
          }
          aboveCanvasLeft={
            <>
              <button
                type="button"
                onClick={toggleMuted}
                className="text-[10px] smallcaps text-clay-500 hover:text-ember-500 transition-colors flex items-center gap-2"
                aria-label={muted ? "取消静音" : "静音"}
                title={muted ? "取消静音" : "静音"}
              >
                <i
                  className={`fa-solid ${muted ? "fa-volume-xmark" : "fa-volume-high"} text-[10px]`}
                />
                {muted ? "静 · 音" : "有 · 声"}
              </button>

              {/* Silence nudge — a compact pill right beside the mute toggle.
                  Clicking opens the BYO-key modal in place (no trip to the
                  homepage). The × dismisses it for the session. */}
              {showSilenceNudge && (
                <span className="flex items-center gap-1 animate-fade-in">
                  <button
                    type="button"
                    onClick={() => setTtsModalOpen(true)}
                    className="inline-flex items-center gap-1.5 rounded-full border border-ember-500/40 bg-ember-500/10 px-2.5 py-1 text-[10px] text-ember-500 hover:bg-ember-500/20 transition-colors"
                    title="经常没声音？填入你自己的小米 MiMo Key（免费），配音更稳定"
                  >
                    <i className="fa-solid fa-volume-xmark text-[9px]" />
                    经常没声音？自带 Key
                  </button>
                  <button
                    type="button"
                    onClick={() => setNudgeDismissed(true)}
                    aria-label="关闭提示"
                    title="关闭"
                    className="text-clay-400 hover:text-clay-700 transition-colors"
                  >
                    <i className="fa-solid fa-xmark text-[10px]" />
                  </button>
                </span>
              )}
            </>
          }
        />

        <div className="mt-4 max-w-md w-full text-center min-h-[28px] flex items-center justify-center">
          {phase === "loading-first" && (
            <p className="text-[10px] smallcaps text-clay-500 animate-slow-pulse">
              正 · 在 · 唤 · 起 · 第 · 一 · 幕
            </p>
          )}
          {phase === "ready" && lastExitLabel && (
            <p className="text-[9px] smallcaps text-clay-400 animate-fade-in">
              <span className="mr-2">上 · 一 · 步 ·</span>
              <span className="text-clay-600">{lastExitLabel}</span>
            </p>
          )}
        </div>

      </main>

      {ttsModalOpen && (
        <TtsKeyModal
          onClose={() => setTtsModalOpen(false)}
          onSaved={handleByoSaved}
          footerNote="保存后会立即用这把 Key 在你的浏览器里合成当前这一幕的配音；本设备后续游玩也会自动使用此 Key。"
        />
      )}
    </div>
  );
}

export default function PlayPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center">
          <span className="text-[10px] smallcaps text-clay-500 animate-slow-pulse">
            载入中
          </span>
        </div>
      }
    >
      <PlayInner />
    </Suspense>
  );
}
