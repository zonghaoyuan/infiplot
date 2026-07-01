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
import {
  PlayCanvas,
  type Phase,
} from "@/components/PlayCanvas";
import type { DialogueHistoryItem } from "@/components/DialogueHistoryModal";
import type { GalleryDoc, GalleryScene } from "@/app/[locale]/gallery/page";
import { SettingsModal, readStoredPlayerName, readStoredVisionClick } from "@/components/SettingsModal";
import { annotateClick } from "@/lib/annotateClient";
import { loadClientTtsConfig } from "@/lib/clientTtsConfig";
import { collectBeatAudioForExport } from "@/lib/exportAudio";
import { saveStory, loadStorySession } from "@/lib/clientStoryPersistence";
import { PRESETS } from "@/lib/presets";
import {
  STORY_SHARE_STORAGE_KEY,
  createStoryShareDoc,
  parseStoryShareDoc,
  storyShareFilename,
} from "@/lib/storyShare";
import { provisionVoice, synthesize } from "@infiplot/tts-client";
import {
  startSession,
  requestScene,
  visionDecide,
  requestInsertBeat,
  getTtsProvider,
  AuthRequiredError,
} from "@/lib/engineClient";
import type {
  Beat,
  BeatChoice,
  Character,
  CharacterVoice,
  Orientation,
  Scene,
  SceneExit,
  SceneResponse,
  Session,
  StartResponse,
  TtsConfig,
  TtsProvider,
} from "@infiplot/types";
import { coerceOrientation } from "@infiplot/types";
import { track } from "@/lib/analytics";
import { AUTH_ENABLED } from "@/lib/supabase/config";
import { writeResumeSnapshot, consumeResumeSnapshot } from "@/lib/authResume";
import { AuthModal } from "@/components/AuthModal";
import { UserChip } from "@/components/UserChip";
import { useI18n } from "@/lib/i18n/client";
import { useLocalePath } from "@/lib/i18n/hooks";

const MUTED_STORAGE_KEY = "infiplot:muted";
// One-shot snapshot of in-progress game state, written just before an OAuth
// full-page redirect (Google/GitHub) so the play page can resume the exact
// scene/beat after the round-trip. The redirect unmounts the app and destroys
// the in-memory Session (the server is stateless), so without this the play
// page re-bootstraps from `?card=…` and restarts the story. OTP login keeps
// state in-memory (no redirect) and never writes this. Consumed once on mount.
const PLAY_RESUME_KEY = "infiplot:play-resume";

// Serializable form of the action intercepted by a 401. `persistPlayResume`
// stashes whichever one is pending into sessionStorage; the deferred-replay
// effect re-dispatches it after `restorePlayResume` commits the restored state.
type PendingResumeAction =
  | { kind: "choice"; choice: BeatChoice }
  | { kind: "freeform"; text: string }
  | { kind: "background-click"; x: number; y: number };

// Shape written to sessionStorage[PLAY_RESUME_KEY]. `imageOriginalUrl` is the
// remote CDN URL (never the blob: URL — those are revoked on unmount and won't
// survive the full-page reload); restorePlayResume re-resolves it to a fresh
// blob via getOrCreateBlobUrl.
type PlayResumeSnapshot = {
  session: Session;
  beatId: string;
  visitedBeats: string[];
  orientation: Orientation;
  imageOriginalUrl: string;
  pendingAction?: PendingResumeAction;
};

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

// After blob/preload resolves the <img> still needs to decode the bitmap.
// This gate keeps the "transitioning" overlay visible until decode fires,
// so the user never sees progressive paint or a blank flash. 3s is generous
// (decode is typically <100ms for a locally-held blob).
const IMAGE_READY_TIMEOUT_MS = 3000;

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

function buildDialogueHistory(
  session: Session | null,
): DialogueHistoryItem[] {
  if (!session) return [];

  return session.history.flatMap((entry, sceneIndex) => {
    const beatsById = new Map(entry.scene.beats.map((b) => [b.id, b]));
    const visitedBeatIds = entry.visitedBeatIds;

    return visitedBeatIds.flatMap((beatId, beatIndex) => {
      const beat = beatsById.get(beatId);
      if (!beat) return [];

      const nextVisitedBeatId = visitedBeatIds[beatIndex + 1];
      const choice =
        beat.next.type === "choice"
          ? beat.next.choices.find((c) => {
              if (c.effect.kind === "advance-beat") {
                return c.effect.targetBeatId === nextVisitedBeatId;
              }
              return (
                beatIndex === visitedBeatIds.length - 1 &&
                entry.exit?.kind === "choice" &&
                c.id === entry.exit.choiceId
              );
            })
          : undefined;
      const freeformAction =
        beatIndex === visitedBeatIds.length - 1 &&
        entry.exit?.kind === "freeform"
          ? entry.exit.action
          : undefined;

      const body = beat.speaker ? beat.line : beat.narration;
      const narration = beat.speaker ? beat.narration : undefined;
      if (!body && !narration && !choice && !freeformAction) return [];

      return [
        {
          id: `${sceneIndex}:${beatId}:${beatIndex}`,
          sceneIndex: sceneIndex + 1,
          speaker: beat.speaker,
          body,
          narration,
          selectedChoice: choice?.label,
          freeformAction,
        },
      ];
    });
  });
}

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
  // Resolved-prefetch sink for the gallery export. Every successful resolve
  // is recorded here keyed by `${parentSceneId}:${choiceId}` so the gallery
  // can let the player click any choice whose alternate the AI already paid
  // to generate — even ones that were later abandoned mid-play because the
  // player took a different branch. Survives `consumeChoice`'s abort sweep:
  // a prefetch that's already resolved when its parent choice is abandoned
  // still leaves the result here.
  resolvedSink: Map<string, Scene>,
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
  const prefetchT0 = Date.now();
  const promise = (async () => {
    const data = await requestScene({ session: specSession, clientTts });
    if (abort.signal.aborted) throw new DOMException("aborted", "AbortError");

    // Record this resolved alternate for the gallery export. Key is
    // (parent scene id at the choice point) : (choice id). Includes the
    // CDN imageUrl on the Scene so the gallery has everything it needs to
    // render without any further info from the engine.
    const lastStep = steps[steps.length - 1]!;
    resolvedSink.set(`${lastStep.fromScene.id}:${lastStep.exit.choiceId}`, {
      ...data.scene,
      imageUrl: data.imageUrl,
    });

    // Kick off the blob fetch for this URL so when the player eventually
    // picks this choice, transitioning is a no-op cache lookup instead of a
    // fresh CDN download. Don't await — let it run in the background; the
    // transition path awaits the same cached promise via getOrCreateBlobUrl.
    void getOrCreateBlobUrl(data.imageUrl);

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
          resolvedSink,
          carriedBase,
          [...steps, nextStep],
          depth + 1,
          clientTts,
        );
      }
    }

    return data;
  })();

  promise.catch((e) => {
    if ((e as { name?: string }).name === "AbortError") return;
    const { kind, http_status } = classifyError(e);
    track("play_error", {
      source: "prefetch" as const,
      kind,
      http_status,
      orientation: coerceOrientation(baseSession.orientation),
      connection: getConnectionType(),
      was_hidden: typeof document !== "undefined" && document.visibilityState === "hidden",
      scene_index: baseSession.history.length,
      elapsed_bucket: elapsedBucket(prefetchT0),
    });
  });
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
  const p = provisionVoice(cfg, speaker.voiceDescription, speaker.name);
  cache.set(speaker.name, p);
  try {
    return await p;
  } catch (e) {
    cache.delete(speaker.name); // failed provision — let a later beat retry
    throw e;
  }
}

// ── Error observability helpers ────────────────────────────────────────

type ErrorSource = "scene" | "start" | "vision" | "insert_beat" | "freeform" | "prefetch";

function classifyError(
  e: unknown,
  res?: Response,
): { kind: "network" | "timeout" | "http_5xx" | "http_4xx" | "abort" | "unknown"; http_status: number } {
  if (res) {
    const s = res.status;
    if (s >= 500) return { kind: "http_5xx", http_status: s };
    if (s >= 400) return { kind: "http_4xx", http_status: s };
  }
  if (e instanceof Error) {
    if (e.name === "AbortError") return { kind: "abort", http_status: 0 };
    if (e instanceof TypeError && /fetch|network/i.test(e.message))
      return { kind: "network", http_status: 0 };
    if (/timeout/i.test(e.message)) return { kind: "timeout", http_status: 0 };
    const httpMatch = e.message.match(/^HTTP (\d+)$/);
    if (httpMatch) {
      const s = Number(httpMatch[1]);
      if (s >= 500) return { kind: "http_5xx", http_status: s };
      if (s >= 400) return { kind: "http_4xx", http_status: s };
    }
  }
  return { kind: "unknown", http_status: 0 };
}

function elapsedBucket(startMs: number): "<5s" | "5-30s" | "30-60s" | "60-120s" | "120s+" {
  const s = (Date.now() - startMs) / 1000;
  if (s < 5) return "<5s";
  if (s < 30) return "5-30s";
  if (s < 60) return "30-60s";
  if (s < 120) return "60-120s";
  return "120s+";
}

function getConnectionType(): "4g" | "3g" | "2g" | "slow-2g" | "unknown" {
  const nav = typeof navigator !== "undefined" ? navigator : undefined;
  const conn = (nav as { connection?: { effectiveType?: string } } | undefined)?.connection;
  const et = conn?.effectiveType;
  if (et === "4g" || et === "3g" || et === "2g" || et === "slow-2g") return et;
  return "unknown";
}

// ──────────────────────────────────────────────────────────────────────
//  Component
// ──────────────────────────────────────────────────────────────────────

function PlayInner() {
  const router = useRouter();
  const params = useSearchParams();
  const { t, locale } = useI18n();
  const lp = useLocalePath();

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
  const [errorRetry, setErrorRetry] = useState<(() => void) | null>(null);
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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [visionClickEnabled, setVisionClickEnabled] = useState(true);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const authResolveRef = useRef<(() => void) | null>(null);
  // Serializable description of the action that hit the 401 (choice / freeform
  // text / background-click coords), captured alongside the retry closure. An
  // OAuth round-trip destroys the closure, but this survives in sessionStorage
  // so the exact action can be replayed after game state is restored.
  const pendingResumeActionRef = useRef<PendingResumeAction | null>(null);
  // Set by restorePlayResume when a snapshot carries a pending action; a
  // dedicated effect dispatches it once the restored state has committed
  // (phase "ready", session + scene present), then clears it. Mirrors the
  // homepage's autoStartPending resume pattern.
  const [pendingReplayAction, setPendingReplayAction] =
    useState<PendingResumeAction | null>(null);
  // Bumped by the OAuth-resume fallback to retrigger the bootstrap effect after
  // relinquishing its `startedRef` slot (snapshot consumed but user not signed
  // in → run normal card/preset/custom bootstrap instead of leaving a blank
  // loading screen).
  const [retryBootstrap, setRetryBootstrap] = useState(0);
  // Top-of-screen progress toast for the gallery / story export pipeline.
  // null when idle; { done, total, label } while collecting beat audio.
  const [exportProgress, setExportProgress] = useState<
    { done: number; total: number; label: string } | null
  >(null);

  // `retry` re-runs the action that hit the 401, replayed by AuthModal.onSuccess
  // after the user signs in. Omitted by callers whose path can't actually 401
  // (initial load already gated on the homepage, recorded replay is local).
  // `action` is the serializable twin of `retry`: same intent, but survives an
  // OAuth full-page redirect via sessionStorage so it can be replayed after
  // game state is restored (the retry closure itself is destroyed on unmount).
  const handleAuthError = useCallback(
    (
      e: unknown,
      retry?: () => void,
      action?: PendingResumeAction,
    ): boolean => {
      if (e instanceof AuthRequiredError) {
        authResolveRef.current = retry ?? null;
        pendingResumeActionRef.current = action ?? null;
        setAuthModalOpen(true);
        return true;
      }
      return false;
    },
    [],
  );

  // Snapshot the in-progress game just before an OAuth full-page redirect so
  // the play page can resume the exact scene/beat on return. Reads only refs
  // (stable across renders), so an empty dep list is safe. Mirrors the
  // homepage's persistPendingStart + quota-fallback degradation.
  const persistPlayResume = useCallback((): void => {
    const sess = sessionRef.current;
    const beat = currentBeatRef.current;
    const imageOriginalUrl = lastImageOriginalUrlRef.current;
    if (!sess || !beat || !imageOriginalUrl) return;
    const snap: PlayResumeSnapshot = {
      session: sess,
      beatId: beat.id,
      visitedBeats: [...visitedBeatsRef.current],
      orientation: coerceOrientation(sess.orientation),
      imageOriginalUrl,
      pendingAction: pendingResumeActionRef.current ?? undefined,
    };
    // Quota-safe write: the only heavy field is the user-uploaded style ref
    // (~100KB data URL), which only affects the Painter on FUTURE scenes, not
    // the resumed scene — so stripping it degrades gracefully. Voices are
    // deliberately kept (continuity > rare quota miss; a typical session of
    // remote-image URLs + a few ~160KB voice refs fits under the 5MB cap).
    writeResumeSnapshot(PLAY_RESUME_KEY, snap, [
      // Fallback: drop the style-reference data URL from the session.
      { ...snap, session: { ...sess, styleReferenceImage: undefined } },
    ]);
  }, []);

  // Restore an in-progress game from a PLAY_RESUME_KEY snapshot after an OAuth
  // round-trip. Re-resolves the remote image URL to a fresh blob (the old blob
  // was revoked on unmount), repopulates the runtime refs the handlers read,
  // and hands any pending action to the deferred-replay effect. Throws on a
  // corrupt snapshot so the caller can fall back to normal bootstrap.
  const restorePlayResume = useCallback(
    async (snap: PlayResumeSnapshot): Promise<void> => {
      const last = snap.session.history[snap.session.history.length - 1];
      if (!last?.scene) throw new Error("resume snapshot missing current scene");

      setOrientation(snap.orientation);
      visitedBeatsRef.current = [...snap.visitedBeats];
      lastImageOriginalUrlRef.current = snap.imageOriginalUrl;

      setSession(snap.session);
      setCurrentScene(last.scene);
      setCurrentBeatId(snap.beatId);

      const blobUrl = await getOrCreateBlobUrl(snap.imageOriginalUrl);
      const ready = waitForImageReady();
      setImageUrl(blobUrl);
      await ready;
      setPhase("ready");
      track("scene_reached", { scene_index: snap.session.history.length });

      if (snap.pendingAction) setPendingReplayAction(snap.pendingAction);
    },
    [],
  );

  const startedRef = useRef(false);
  const poolRef = useRef<Map<string, PrefetchEntry>>(new Map());
  // Accumulator for resolved prefetches across the whole session — every
  // `prefetchScenePath` resolution writes here, keyed by parent-scene + choice.
  // Survives `consumeChoice`'s pool sweep (an already-resolved promise is not
  // un-resolved by aborting its controller), so abandoned alternates remain
  // available for the gallery export. Cleared only on unmount.
  const resolvedPrefetchesRef = useRef<Map<string, Scene>>(new Map());
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
  const phaseRef = useRef<Phase>(phase);

  // Resolved bring-your-own Xiaomi TTS config (region preset + key), read once
  // from localStorage. When non-null, the browser provisions + synths voices
  // directly against Xiaomi — the key never touches our server — and every
  // start/scene/insert-beat request carries clientTts:true so the engine skips
  // server-side TTS. null = user hasn't opted in (server default / silent).
  const [byoTtsConfig, setByoTtsConfig] = useState<TtsConfig | null>(() =>
    loadClientTtsConfig(),
  );
  const byoTtsRef = useRef<TtsConfig | null>(byoTtsConfig);
  // Server TTS provider (probed once at mount via /api/tts-provider). Used by
  // fetchBeatAudio to decide which voice fields to send: when the server runs
  // StepFun, omit the ~220KB Xiaomi `voice` and send stepfunVoiceId /
  // voiceDescription instead (saves Fast Origin Transfer bandwidth). null =
  // probe failed or server has no TTS; fetchBeatAudio then sends defensively
  // and the server normalizes. Ignored entirely in BYO mode (byoTtsRef wins).
  const [serverTtsProvider, setServerTtsProvider] = useState<TtsProvider>(null);
  const serverTtsProviderRef = useRef<TtsProvider>(null);
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
  const replaySourceRef = useRef<Session | null>(null);
  const replayIndexRef = useRef(-1);
  const replayActiveRef = useRef(false);
  const exportingStoryRef = useRef(false);
  const exportingGalleryRef = useRef(false);
  const prebakedAudioRef = useRef<Record<string, string>>({});
  // Original (CDN) URL of the currently-rendered scene image. Used as the key
  // to revoke its blob: URL when the scene swaps. We track the ORIGINAL URL,
  // not the blob URL, because blobUrlCache is keyed by original URL.
  const lastImageOriginalUrlRef = useRef<string | null>(null);

  // Image-ready gate: keeps the "transitioning" overlay visible until the
  // actual <img> element has decoded its bitmap, so the user never sees
  // progressive paint or a blank flash between scenes.
  const imageReadyResolverRef = useRef<(() => void) | null>(null);
  function waitForImageReady(): Promise<void> {
    return new Promise<void>((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        imageReadyResolverRef.current = null;
        resolve();
      };
      imageReadyResolverRef.current = done;
      setTimeout(done, IMAGE_READY_TIMEOUT_MS);
    });
  }
  const handleImageReady = useCallback(() => {
    imageReadyResolverRef.current?.();
  }, []);

  const currentBeat = useMemo<Beat | null>(() => {
    if (!currentScene || !currentBeatId) return null;
    return currentScene.beats.find((b) => b.id === currentBeatId) ?? null;
  }, [currentScene, currentBeatId]);

  const dialogueHistory = useMemo<DialogueHistoryItem[]>(
    () => buildDialogueHistory(session),
    [session],
  );

  const audioSrc = (currentBeat ? beatAudioMap[currentBeat.id] : undefined) ?? null;

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);
  // Autosave bookkeeping. We persist on a stable FINGERPRINT of the durable,
  // session-level state — committed-scene count + playerName — not the raw
  // `session` reference, which churns on every beat advance (visitedBeatIds).
  //  - lastSavedFingerprintRef holds the fingerprint of the last SUCCESSFUL save.
  //    On failure it's cleared so the next session change retries: a
  //    fire-and-forget that silently failed (IndexedDB transiently unavailable)
  //    must not strand the scene unsaved.
  //  - saveChainRef serializes writes so a slow save for scene N can't land after
  //    a faster save for N+1 and persist a stale, shorter session.
  const lastSavedFingerprintRef = useRef("");
  const saveChainRef = useRef<Promise<void>>(Promise.resolve());
  // Persist to the browser-local store when the durable state changes (Req 2.1).
  // Fingerprint = committed-scene count + last-scene beat count + playerName:
  //  - scene count grows on a normal scene commit;
  //  - last-scene beat count grows on an insert-beat (freeform / background-click
  //    appends a beat to the current scene WITHOUT changing history.length), which
  //    is real generated narrative that must persist — keying on length alone
  //    would silently drop it;
  //  - playerName captures a late rename.
  // Within-scene *visited* progress (visitedBeatIds) is deliberately NOT in the
  // fingerprint, so merely advancing through existing beats doesn't re-save. The
  // resume path primes the fingerprint so loading a story stays a pure read (no
  // re-save / rev bump / list reorder). No debounce — the write is issued on the
  // committing render, so navigating home right after a change can't drop it (the
  // IndexedDB put is already in flight, serialized, not cancelled by unmount).
  // Fire-and-forget: never blocks.
  useEffect(() => {
    // Never persist a replayed shared story into the user's own library — it
    // isn't theirs and its id can collide with (and clobber) a real local save.
    // Guard on replaySourceRef (set unconditionally on import, cleared by
    // detachRecordedReplay when the user takes over) — NOT replayActiveRef, which
    // means "more recorded scenes remain" and is false for a single-scene share,
    // so that share would otherwise slip through and overwrite a real save.
    if (!session || replaySourceRef.current) return;
    const history = session.history ?? [];
    if (history.length < 1) return;
    const lastBeatCount = history[history.length - 1]?.scene?.beats?.length ?? 0;
    const fingerprint = `${history.length}:${lastBeatCount}:${session.playerName ?? ""}`;
    if (fingerprint === lastSavedFingerprintRef.current) return;
    lastSavedFingerprintRef.current = fingerprint; // optimistic; rolled back on failure
    const snapshot = session;
    saveChainRef.current = saveChainRef.current
      .then(async () => {
        const r = await saveStory(snapshot);
        // Roll back only if no newer save has superseded us, so the next session
        // change retries this content instead of the failure being permanent.
        if (!r.ok && lastSavedFingerprintRef.current === fingerprint) {
          lastSavedFingerprintRef.current = "";
        }
      })
      .catch(() => {
        if (lastSavedFingerprintRef.current === fingerprint) {
          lastSavedFingerprintRef.current = "";
        }
      });
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
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);
  useEffect(() => {
    serverTtsProviderRef.current = serverTtsProvider;
  }, [serverTtsProvider]);
  useEffect(() => {
    setVisionClickEnabled(readStoredVisionClick());
  }, []);

  // Probe the server's TTS provider ONCE at mount. Non-BYO users need this so
  // fetchBeatAudio can skip the ~220KB Xiaomi reference audio when the server
  // runs StepFun. BYO users never read this ref (byoTtsRef takes precedence),
  // but the probe is harmless and cheap, so we run it unconditionally and let
  // getTtsProvider short-circuit for BYO. AuthRequiredError is handled by the
  // bootstrap flow's handleAuthError; other errors degrade to null silently.
  useEffect(() => {
    let cancelled = false;
    getTtsProvider()
      .then((p) => {
        if (!cancelled) setServerTtsProvider(p);
      })
      .catch((e) => {
        if (!cancelled && e instanceof AuthRequiredError) {
          // Defer to the bootstrap effect's auth modal — leave provider null.
          return;
        }
        // Non-auth errors already logged in getTtsProvider; null = unknown.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function trackPlayError(source: ErrorSource, e: unknown, startMs: number, res?: Response) {
    const { kind, http_status } = classifyError(e, res);
    track("play_error", {
      source,
      kind,
      http_status,
      orientation,
      connection: getConnectionType(),
      was_hidden: document.visibilityState === "hidden",
      scene_index: session?.history.length ?? 0,
      elapsed_bucket: elapsedBucket(startMs),
    });
  }

  function showError(e: unknown, retry?: () => void): void {
    setError(e instanceof Error ? e.message : String(e));
    setErrorRetry(() => retry ?? null);
  }

  function clearError(): void {
    setError(null);
    setErrorRetry(null);
  }

  function retryAfterError(): void {
    const retry = errorRetry;
    clearError();
    retry?.();
  }

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

  useEffect(() => {
    function onVisChange() {
      if (document.visibilityState === "hidden") {
        const p = phaseRef.current;
        track("play_visibility_lost", {
          phase: p,
          had_pending_fetch: p !== "ready",
        });
      }
    }
    document.addEventListener("visibilitychange", onVisChange);
    return () => document.removeEventListener("visibilitychange", onVisChange);
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

      // Reuse pre-baked audio from a `.infiplot` import before any synth —
      // free, instant, and identical to what the original player heard.
      const curSceneId = currentSceneRef.current?.id;
      if (curSceneId) {
        const baked = prebakedAudioRef.current[`${curSceneId}:${beat.id}`];
        if (baked) {
          setBeatAudioMap((m) => (m[beat.id] === baked ? m : { ...m, [beat.id]: baked }));
          return;
        }
      }

      const speaker = sess.characters.find((c) => c.name === beat.speaker);
      if (!speaker) return;

      const byo = byoTtsRef.current;
      const serverProvider = serverTtsProviderRef.current;
      // What we need to synthesize depends on the path:
      //   - BYO (xiaomi): baked voice OR voiceDescription to provision locally.
      //   - Server stepfun: stepfunVoiceId or voiceDescription — no Xiaomi
      //     `voice` needed (saves the ~220KB reference-audio FOT).
      //   - Server xiaomi / unknown (probe pending): accept ANY synthesizable
      //     source. The null case covers the race where getTtsProvider hasn't
      //     resolved before the first beat fetch fires — without this widening
      //     a stepfun-only speaker (no Xiaomi voice) would be silently dropped.
      //     The server resolves + normalizes regardless of which fields arrive.
      if (byo) {
        if (!speaker.voice && !speaker.voiceDescription) return;
      } else if (serverProvider === "stepfun") {
        if (!speaker.stepfunVoiceId && !speaker.voiceDescription) return;
      } else {
        if (!speaker.voice && !speaker.stepfunVoiceId && !speaker.voiceDescription) return;
      }

      if (beatAudioAbortRef.current.has(beat.id)) return;
      const abort = new AbortController();
      beatAudioAbortRef.current.set(beat.id, abort);
      try {
        let audioUrl: string | null = null;
        if (byo) {
          // Client-direct: provision (once per speaker, cached) + synth against
          // Xiaomi with the user's own key — the key never touches our server.
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
          // Server-side synth: shape the body by the probed provider so we don't
          // waste Fast Origin Transfer bandwidth on the ~220KB Xiaomi reference
          // audio when the server actually runs StepFun.
          //   - stepfun → stepfunVoiceId + voiceDescription + characterName
          //     (all lightweight; the server synths directly with the id).
          //   - xiaomi / unknown → voice (the ~220KB reference audio the server
          //     needs to clone), PLUS the lightweight fallback fields so the
          //     server can still normalize on a provider mismatch (e.g. a prebaked
          //     card holding a Xiaomi voice while the server runs StepFun).
          const isStepfunServer = serverProvider === "stepfun";
          const res = await fetch("/api/beat-audio", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              beat: { id: beat.id, line: beat.line, lineDelivery: beat.lineDelivery },
              ...(isStepfunServer
                ? {
                    stepfunVoiceId: speaker.stepfunVoiceId,
                    voiceDescription: speaker.voiceDescription,
                    characterName: speaker.name,
                  }
                : {
                    voice: speaker.voice,
                    // Defensive fallback fields (lightweight) — let the server
                    // re-provision if speaker.voice.provider ≠ server provider.
                    stepfunVoiceId: speaker.stepfunVoiceId,
                    voiceDescription: speaker.voiceDescription,
                    characterName: speaker.name,
                  }),
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
          // Defensive: a 200 with an empty body (proxy/CDN truncation,
          // framework edge cases) would create a silent blob URL and wrongly
          // reset the silence counter. Treat empty as a miss so the nudge
          // still surfaces when the shared key is being rate-limited.
          if (blob.size === 0) {
            setSilenceStrikes((n) => Math.min(n + 1, 99));
            return;
          }
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
          // Aborted between synth and store — revoke the blob URL we just
          // created so it doesn't leak. (Scene-change and mute transitions
          // revoke stored URLs separately; this only covers this race.)
          URL.revokeObjectURL(audioUrl);
        }
      } catch {
        // aborted (scene change / mute) — silent fallback, NOT a strike.
        // Network failure / server 5xx / shared-key rate-limit that surfaces
        // as a thrown error on the server path DOES count — otherwise the
        // silence nudge would never fire for those cases (the explicit 204/
        // !ok/empty-blob branches above only cover responses, not throws).
        // BYO throws are the user's own key quota, not the shared-key pain
        // the nudge addresses, so they don't count.
        if (!abort.signal.aborted && !byo) {
          setSilenceStrikes((n) => Math.min(n + 1, 99));
        }
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

  const handleSettingsSaved = useCallback(
    (settings: { playerName: string; visionClickEnabled: boolean; ttsConfigured: boolean }) => {
      setVisionClickEnabled(settings.visionClickEnabled);
      const nextPlayerName = settings.playerName || undefined;
      setSession((prev) => prev ? { ...prev, playerName: nextPlayerName } : prev);
      const cfg = settings.ttsConfigured ? loadClientTtsConfig() : null;
      byoTtsRef.current = cfg;
      setByoTtsConfig(cfg);
      if (cfg) {
        // Switching to BYO: any server-path audio in flight is now stale,
        // and the silence nudge is no longer relevant. Abort + clear, then
        // re-synth the current scene with the user's own key.
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

  function detachRecordedReplay(): void {
    replayActiveRef.current = false;
    replaySourceRef.current = null;
    replayIndexRef.current = -1;
    clearPool(poolRef.current);
  }

  // ── Export to interactive gallery (PPT-style replay) ─────────────────
  // Drop all but the (keepCount) most-recent gallery exports from localStorage,
  // ordered by their stored createdAt. Called right before writing a new
  // export so the cap is enforced strictly (≤ keepCount + 1 transiently → ≤ N
  // once write completes). Corrupt entries (un-parseable / no createdAt) sort
  // last and get evicted first.
  //
  // Audio lives in a sidecar key `infiplot:gallery:<id>:audio` so the main
  // doc JSON.parse on gallery load doesn't block the main thread with several
  // MB of base64. The sidecar key inherits its doc's age — paired by id, not
  // its own createdAt (it never has one) — and is evicted alongside its doc.
  const trimGalleryExports = useCallback((keepCount: number) => {
    try {
      const prefix = "infiplot:gallery:";
      const audioSuffix = ":audio";
      const docs: Map<string, { key: string; createdAt: number }> = new Map();
      const sidecars: Map<string, string> = new Map();
      for (let i = 0; i < window.localStorage.length; i++) {
        const k = window.localStorage.key(i);
        if (!k || !k.startsWith(prefix)) continue;
        if (k.endsWith(audioSuffix)) {
          const id = k.slice(prefix.length, -audioSuffix.length);
          sidecars.set(id, k);
          continue;
        }
        const id = k.slice(prefix.length);
        let createdAt = 0;
        try {
          const raw = window.localStorage.getItem(k);
          if (raw) {
            const parsed = JSON.parse(raw) as { createdAt?: number };
            createdAt = parsed.createdAt ?? 0;
          }
        } catch {
          createdAt = 0;
        }
        docs.set(id, { key: k, createdAt });
      }
      const ordered = [...docs.entries()].sort(
        (a, b) => b[1].createdAt - a[1].createdAt,
      );
      for (const [id, { key }] of ordered.slice(keepCount)) {
        window.localStorage.removeItem(key);
        const sc = sidecars.get(id);
        if (sc) window.localStorage.removeItem(sc);
        sidecars.delete(id);
      }
      // Orphan sidecars (their doc was already gone) get cleaned up too.
      for (const sc of sidecars.values()) {
        if (!docs.has(sc.slice(prefix.length, -audioSuffix.length))) {
          window.localStorage.removeItem(sc);
        }
      }
    } catch {
      // best-effort — quota or disabled storage shouldn't block the export
    }
  }, []);

  // Strips the live Session to a small GalleryDoc — only scene images +
  // dialogue text + recorded choices, no voice base64 / portraits / style
  // reference (those are tens-to-hundreds of KB each). Writes it to
  // localStorage under a one-shot id and opens /gallery#<id> in a new tab
  // so the play session keeps running.
  //
  // Beat audio is collected synchronously here (reusing the per-scene
  // beatAudioMap when possible, BYO / server TTS for the rest) and stashed
  // in a sidecar localStorage key so the gallery's first paint isn't
  // bottlenecked on JSON.parse-ing several MB of base64.
  const handleExportGallery = useCallback(async () => {
    const s = sessionRef.current;
    if (!s || exportingGalleryRef.current) return;
    exportingGalleryRef.current = true;
    const scenes: GalleryScene[] = s.history
      .map((h) => ({
        id: h.scene.id,
        imageUrl: h.scene.imageUrl ?? "",
        sceneKey: h.scene.sceneKey,
        orientation: h.scene.orientation,
        beats: h.scene.beats,
        entryBeatId: h.scene.entryBeatId,
        visitedBeatIds: h.visitedBeatIds,
        exit: h.exit,
      }))
      .filter((sc) => sc.imageUrl);
    if (scenes.length === 0) {
      exportingGalleryRef.current = false;
      return;
    }

    // Alternates: ${parentSceneId}:${choiceId} → reachable scene. Two sources,
    // merged with main-path winning ties (it always agrees with prefetch when
    // prefetch was actually used, so the override is a no-op in the common case;
    // it differs only when the player took a cold path and the prefetch had
    // resolved to something the engine later regenerated):
    //   1. Every resolved prefetch (including alternates the player never took)
    //   2. Main path: every history step's choice exit → the next visited scene
    const alternates: Record<string, GalleryScene> = {};
    for (const [key, scene] of resolvedPrefetchesRef.current) {
      if (!scene.imageUrl) continue;
      alternates[key] = {
        id: scene.id,
        imageUrl: scene.imageUrl,
        sceneKey: scene.sceneKey,
        orientation: scene.orientation,
        beats: scene.beats,
        entryBeatId: scene.entryBeatId,
      };
    }
    for (let i = 0; i < s.history.length - 1; i++) {
      const h = s.history[i]!;
      const nextH = s.history[i + 1]!;
      if (
        h.exit?.kind === "choice" &&
        h.scene.id &&
        nextH.scene.imageUrl
      ) {
        alternates[`${h.scene.id}:${h.exit.choiceId}`] = {
          id: nextH.scene.id,
          imageUrl: nextH.scene.imageUrl,
          sceneKey: nextH.scene.sceneKey,
          orientation: nextH.scene.orientation,
          beats: nextH.scene.beats,
          entryBeatId: nextH.scene.entryBeatId,
        };
      }
    }

    // Character portraits — names + CDN URLs only. The big voice base64s are
    // intentionally dropped (the gallery only needs the portraits for download).
    const characters = s.characters
      .filter((c) => c.basePortraitUrl)
      .map((c) => ({
        name: c.name,
        basePortraitUrl: c.basePortraitUrl as string,
      }));

    const id = `${Date.now().toString(36)}_${Math.random()
      .toString(36)
      .slice(2, 8)}`;

    let audioByBeatId: Record<string, string> = {};
    try {
      setExportProgress({ done: 0, total: 0, label: t("play.exportProgress.preparingVoice") });
      audioByBeatId = await collectBeatAudioForExport({
        session: s,
        beatAudioMap,
        currentSceneId: currentSceneRef.current?.id ?? null,
        byoTts: byoTtsRef.current,
        byoVoiceCache: provisionedVoicesRef.current,
        prebakedAudio: prebakedAudioRef.current,
        onProgress: (done, total) =>
          setExportProgress({ done, total, label: t("play.exportProgress.preparingVoice") }),
      });
    } catch {
      // best-effort — even if the collector throws, the gallery without audio
      // is still usable; we keep going rather than block the export.
    } finally {
      setExportProgress(null);
    }

    const doc: GalleryDoc = {
      v: audioByBeatId && Object.keys(audioByBeatId).length > 0 ? 3 : 2,
      id,
      createdAt: Date.now(),
      orientation: coerceOrientation(s.orientation),
      scenes,
      alternates,
      characters,
    };
    // Cap retained gallery exports at the most recent 2. Drop everything
    // older BEFORE writing the new doc so we never transiently exceed the cap
    // (and so a near-quota localStorage has headroom for the new entry).
    trimGalleryExports(1);
    const docStr = JSON.stringify(doc);
    try {
      window.localStorage.setItem(`infiplot:gallery:${id}`, docStr);
    } catch {
      // localStorage full or disabled — silently bail; the player keeps playing.
      exportingGalleryRef.current = false;
      return;
    }
    const audioCount = Object.keys(audioByBeatId).length;
    if (audioCount > 0) {
      try {
        window.localStorage.setItem(
          `infiplot:gallery:${id}:audio`,
          JSON.stringify(audioByBeatId),
        );
      } catch {
        // Sidecar too big for quota — gallery still opens without sound.
      }
    }
    track("gallery_export", { scene_count: scenes.length, audio_count: audioCount });
    window.open(`/gallery#id=${id}`, "_blank", "noopener");
    exportingGalleryRef.current = false;
  }, [beatAudioMap, trimGalleryExports]);

  const handleExportStory = useCallback(async () => {
    const s = sessionRef.current;
    if (!s || s.history.length === 0 || exportingStoryRef.current) return;
    exportingStoryRef.current = true;
    const sceneIndex = Math.max(0, s.history.length - 1);

    let audioByBeatId: Record<string, string> = {};
    try {
      setExportProgress({ done: 0, total: 0, label: t("play.exportProgress.preparingVoice") });
      audioByBeatId = await collectBeatAudioForExport({
        session: s,
        beatAudioMap,
        currentSceneId: currentSceneRef.current?.id ?? null,
        byoTts: byoTtsRef.current,
        byoVoiceCache: provisionedVoicesRef.current,
        prebakedAudio: prebakedAudioRef.current,
        onProgress: (done, total) =>
          setExportProgress({ done, total, label: t("play.exportProgress.preparingVoice") }),
      });
    } catch {
      // best-effort — share the doc silent if collecting audio failed
    } finally {
      setExportProgress(null);
    }

    const doc = createStoryShareDoc(
      s,
      {
        sceneIndex,
        beatId: currentBeatRef.current?.id ?? s.history[sceneIndex]?.scene.entryBeatId,
      },
      Object.keys(audioByBeatId).length > 0 ? audioByBeatId : undefined,
    );

    try {
      const r = await fetch("/api/story-pack", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ docStr: JSON.stringify(doc) }),
      });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        window.alert(j.error ?? t("play.shareErrors.packFailed"));
        return;
      }
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = storyShareFilename(doc);
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch {
      window.alert(t("play.shareErrors.packFailed"));
    } finally {
      exportingStoryRef.current = false;
    }
  }, [beatAudioMap, t]);

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
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement)?.isContentEditable) return;
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
  // devices). The bootstrap effect below re-derives the same value for the
  // /api/start payload.
  useIsomorphicLayoutEffect(() => {
    setOrientation(detectOrientation());
  }, [params]);

  // ── Bootstrap: start session ─────────────────────────────────────────
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    // ── OAuth resume ────────────────────────────────────────────────
    // Returning from a Google/GitHub round-trip? The full-page redirect
    // destroyed the in-memory Session; if we stashed a snapshot just before
    // navigating away (persistPlayResume via AuthModal.onBeforeOAuth) and the
    // user is now signed in, restore the exact scene/beat instead of
    // re-bootstrapping from `?card=…` (which would restart the story). OTP
    // login never writes a snapshot — its onSuccess retry keeps state
    // in-memory.
    //
    // Peek before awaiting: when there's no snapshot (the common case —
    // normal card/preset/custom entry), fall straight through to the
    // bootstrap below. Only when a snapshot exists do we enter the async
    // gate, which itself removes the entry. This keeps the no-snapshot path
    // off the retryBootstrap re-trigger loop entirely.
    if (
      AUTH_ENABLED &&
      sessionStorage.getItem(PLAY_RESUME_KEY) !== null
    ) {
      void (async () => {
        const snap = await consumeResumeSnapshot<PlayResumeSnapshot>(
          PLAY_RESUME_KEY,
        );
        if (!snap) {
          // Snapshot existed but user isn't signed in / payload corrupt →
          // consumeResumeSnapshot already removed it. Relinquish the slot so
          // the normal bootstrap below re-runs on the next effect cycle.
          startedRef.current = false;
          setRetryBootstrap((n) => n + 1);
          return;
        }
        try {
          await restorePlayResume(snap);
        } catch {
          // Corrupt snapshot / network — relinquish and bootstrap normally.
          startedRef.current = false;
          setRetryBootstrap((n) => n + 1);
        }
      })();
      return;
    }

    // 三条进入路径：
    //   ?card=<m0..f31>      → 首页精选卡，直接从 /home/firstact/{name}.json
    //                          静态文件加载（已在构建期 prebake，免一切引擎调用）
    //   ?preset=<id>         → 内置 PRESETS（仍走 /api/start 现场生成）
    //   ?custom=1            → 用户自定义 prompt，sessionStorage 取 ws/sg
    //                          后走 /api/start 现场生成
    //   ?share=1             → 首页上传的剧情分享 JSON，从第一幕开始本地回放
    //   ?storyId=<uuid>      → 加载已保存的剧情（从 localStorage）
    const cardName = params.get("card");
    const presetId = params.get("preset");
    const isCustom = params.get("custom") === "1";
    const isShare = params.get("share") === "1";
    const storyId = params.get("storyId");

    if (isShare) {
      (async () => {
        const t0 = Date.now();
        try {
          const raw = sessionStorage.getItem(STORY_SHARE_STORAGE_KEY);
          if (!raw) throw new Error(t("play.shareErrors.notFound"));
          const doc = parseStoryShareDoc(JSON.parse(raw));
          const imported = doc.session;
          const first = imported.history[0];
          if (!first) throw new Error(t("play.shareErrors.invalid"));
          if (!first.scene.imageUrl) throw new Error(t("play.shareErrors.noImage"));

          const sessionOrientation =
            first.scene.orientation ?? imported.orientation ?? detectOrientation();
          setOrientation(sessionOrientation);
          const blobUrl = await getOrCreateBlobUrl(first.scene.imageUrl);
          lastImageOriginalUrlRef.current = first.scene.imageUrl;

          const initialStoryState = first.storyStateAfter ?? imported.storyState;
          if (!initialStoryState) throw new Error(t("play.shareErrors.noMemory"));

          const initial: Session = {
            ...imported,
            history: [
              {
                ...first,
                visitedBeatIds: [first.scene.entryBeatId],
                exit: undefined,
              },
            ],
            storyState: initialStoryState,
            orientation: sessionOrientation,
          };
          replaySourceRef.current = imported;
          replayIndexRef.current = 0;
          replayActiveRef.current = imported.history.length > 1;
          visitedBeatsRef.current = [first.scene.entryBeatId];
          if (doc.audioByBeatId) {
            prebakedAudioRef.current = { ...doc.audioByBeatId };
            const seed: Record<string, string> = {};
            for (const beat of first.scene.beats) {
              const k = `${first.scene.id}:${beat.id}`;
              const v = doc.audioByBeatId[k];
              if (v) seed[beat.id] = v;
            }
            if (Object.keys(seed).length > 0) setBeatAudioMap(seed);
          }
          setSession(initial);
          setCurrentScene(first.scene);
          setCurrentBeatId(first.scene.entryBeatId);
          const ready = waitForImageReady();
          setImageUrl(blobUrl);
          await ready;
          setPhase("ready");
          track("scene_reached", { scene_index: 1 });
        } catch (e) {
          if (!handleAuthError(e)) {
            trackPlayError("start", e, t0);
            showError(e);
          }
        }
      })();
      return;
    }

    let livePayload: {
      worldSetting: string;
      styleGuide: string;
      styleReferenceImage?: string;
      orientation?: Orientation;
      playerName?: string;
      language?: string;
    } | null = null;
    if (!cardName) {
      if (presetId) {
        const p = PRESETS.find((x) => x.id === presetId);
        if (p) livePayload = { worldSetting: p.worldSetting, styleGuide: p.styleGuide, playerName: readStoredPlayerName() || undefined, language: locale };
      } else if (isCustom) {
        const stored = sessionStorage.getItem("infiplot:custom");
        if (stored) {
          try {
            const parsed = JSON.parse(stored) as {
              worldSetting: string;
              styleGuide: string;
              audioEnabled?: boolean;
              styleReferenceImage?: string;
              playerName?: string;
            };
            livePayload = {
              worldSetting: parsed.worldSetting,
              styleGuide: parsed.styleGuide,
              styleReferenceImage: parsed.styleReferenceImage || undefined,
              playerName: parsed.playerName || undefined,
              language: locale,
            };
            // audioEnabled 已在 useState 初始化时反向投射到 muted；这里无需再额外存。
          } catch {
            livePayload = null;
          }
        }
      }
    }

    // Lock orientation for the whole session. Both prebaked-card and live paths
    // now respect device orientation — portrait prebaked assets live under
    // firstact-portrait/ and firstscene-portrait/.
    const sessionOrientation: Orientation = detectOrientation();
    if (livePayload) livePayload.orientation = sessionOrientation;
    // sessionLanguage flows into Session.language regardless of which start
    // path was taken (prebaked card skips /api/start, so the language has to
    // be tagged onto the local Session build for /api/scene calls).
    const sessionLanguage: string = locale;

    if (!cardName && !livePayload && !storyId) {
      router.replace(lp("/"));
      return;
    }

    // ── Load saved story path ──
    if (storyId) {
      (async () => {
        // Browser-local store (IndexedDB) is async; load inside the IIFE.
        const loadedSession = await loadStorySession(storyId);
        if (!loadedSession) {
          setError(t("play.savedStoryNotFound"));
          return;
        }
        // Resume at the player's last position. Walk from the newest scene back
        // to the first and resume at the latest one that actually has a rendered
        // image: the final scene → correct position; if the very last scene
        // failed to image (committed without one), a small rewind beats a blank
        // canvas (Req 3.3). If NO scene has an image the story can't render —
        // surface savedStoryCorrupted instead of landing on getOrCreateBlobUrl("").
        const history = loadedSession.history;
        let resumeEntry = history[history.length - 1];
        for (let i = history.length - 1; i >= 0; i--) {
          if (history[i]?.scene?.imageUrl) {
            resumeEntry = history[i];
            break;
          }
        }
        const resumeScene = resumeEntry?.scene;
        if (!resumeScene?.imageUrl) {
          setError(t("play.savedStoryCorrupted"));
          return;
        }
        // Pure read: prime the autosave fingerprint so loading doesn't re-save /
        // bump rev / reorder the list. Must match the effect's fingerprint shape
        // exactly (scene count + last-scene beat count + playerName) or the first
        // render would re-persist.
        {
          const lastBeatCount =
            history[history.length - 1]?.scene?.beats?.length ?? 0;
          lastSavedFingerprintRef.current = `${history.length}:${lastBeatCount}:${loadedSession.playerName ?? ""}`;
        }
        try {
          const blobUrl = await getOrCreateBlobUrl(resumeScene.imageUrl);
          lastImageOriginalUrlRef.current = resumeScene.imageUrl;
          setSession(loadedSession);
          setCurrentScene(resumeScene);
          setCurrentBeatId(resumeScene.entryBeatId);
          setImageUrl(blobUrl);
          visitedBeatsRef.current = [resumeScene.entryBeatId];
          setOrientation(coerceOrientation(loadedSession.orientation));
          setPhase("ready");
          track("scene_reached", { scene_index: loadedSession.history.length });
        } catch (e) {
          showError(e);
        }
      })();
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

    const baseDir = sessionOrientation === "portrait"
      ? "firstact-portrait"
      : "firstact";
    const localeSuffix = locale !== "zh-CN" ? `-${locale}` : "";
    const firstactDir = `${baseDir}${localeSuffix}`;

    const startT0 = Date.now();
    const fetchStart: Promise<PrebakedFirstAct> = cardName
      ? fetch(`/home/${firstactDir}/${encodeURIComponent(cardName)}.json`).then(
          async (r) => {
            if (r.ok) return (await r.json()) as PrebakedFirstAct;
            // Fallback chain: locale-specific → zh-CN portrait → zh-CN landscape
            if (localeSuffix) {
              const zhFb = await fetch(`/home/${baseDir}/${encodeURIComponent(cardName)}.json`);
              if (zhFb.ok) return (await zhFb.json()) as PrebakedFirstAct;
            }
            if (sessionOrientation === "portrait") {
              console.warn(`[play] portrait firstact missing for ${cardName} (HTTP ${r.status}), falling back to landscape`);
              const fbDir = localeSuffix ? `firstact-${locale}` : "firstact";
              const fb = await fetch(`/home/${fbDir}/${encodeURIComponent(cardName)}.json`);
              if (fb.ok) {
                const fallback = (await fb.json()) as PrebakedFirstAct;
                return { ...fallback, scene: { ...fallback.scene, orientation: "landscape" as const } };
              }
              if (localeSuffix) {
                const zhLandscape = await fetch(`/home/firstact/${encodeURIComponent(cardName)}.json`);
                if (zhLandscape.ok) {
                  const fallback = (await zhLandscape.json()) as PrebakedFirstAct;
                  return { ...fallback, scene: { ...fallback.scene, orientation: "landscape" as const } };
                }
              }
            }
            throw new Error(t("home.errors.cardNotFound", { cardName }));
          },
        )
      : (async () => {
          const data = await startSession({
            ...livePayload!,
            clientTts: !!byoTtsRef.current,
          });
          // startSession doesn't echo ws/sg back — splice in what we sent.
          // styleReferenceImage is similarly not in StartResponse; tag it on so
          // the session we build below carries it for every scene call.
          return {
            ...data,
            worldSetting: livePayload!.worldSetting,
            styleGuide: livePayload!.styleGuide,
            styleReferenceImage: livePayload!.styleReferenceImage,
          };
        })();

    fetchStart
      .then(async (data) => {
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
              storyStateAfter: data.storyState,
            },
          ],
          characters: data.characters,
          storyState: data.storyState,
          styleReferenceImage: data.styleReferenceImage,
          orientation: data.scene.orientation ?? sessionOrientation,
          playerName: livePayload?.playerName || readStoredPlayerName() || undefined,
          language: sessionLanguage,
        };
        visitedBeatsRef.current = [data.scene.entryBeatId];
        setSession(initial);
        setCurrentScene(data.scene);
        setCurrentBeatId(data.scene.entryBeatId);
        const ready = waitForImageReady();
        setImageUrl(blobUrl);
        await ready;
        setPhase("ready");
        track("scene_reached", { scene_index: initial.history.length });
      })
      .catch((e) => {
        if (!handleAuthError(e)) {
          trackPlayError("start", e, startT0);
          showError(e);
        }
      });
  }, [params, router, retryBootstrap, restorePlayResume]);

  // ── Deferred replay of the action that hit 401 (OAuth resume) ─────────
  // After restorePlayResume commits the restored session/scene/beat, dispatch
  // the pending action so the player lands exactly where they were headed
  // (seamless continuation). Runs once the restored state is interactive,
  // then clears the slot. Mirrors the homepage's autoStartPending pattern.
  useEffect(() => {
    if (!pendingReplayAction) return;
    if (phase !== "ready" || !session || !currentScene) return;
    const action = pendingReplayAction;
    setPendingReplayAction(null);
    if (action.kind === "choice") {
      onSelectChoice(action.choice);
    } else if (action.kind === "freeform") {
      void onFreeformInput(action.text);
    } else {
      void onBackgroundClick({ x: action.x, y: action.y });
    }
    // onSelectChoice/onFreeformInput/onBackgroundClick are stable inner
    // functions keyed off the restored state; listing them would re-fire on
    // every render, so we intentionally scope deps to the readiness gate.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingReplayAction, phase, session, currentScene]);

  // ── Prefetch on scene entry: L1 + recursive L2/L3 for must-pass ──────
  useEffect(() => {
    const s = session;
    const scene = currentScene;
    if (!s || !scene) return;
    if (isRecordedReplayLockedAt(currentBeat)) return;

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
      prefetchScenePath(
        poolRef.current,
        resolvedPrefetchesRef.current,
        s,
        [step],
        0,
        !!byoTtsRef.current,
      );
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
    retry?: () => void,
    action?: PendingResumeAction,
  ) {
    const sceneT0 = Date.now();
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
            storyStateAfter: result.storyState,
          },
        ],
        characters: result.characters,
        storyState: result.storyState,
      };
      visitedBeatsRef.current = [result.scene.entryBeatId];
      setSession(newSession);
      setCurrentScene(result.scene);
      setCurrentBeatId(result.scene.entryBeatId);
      const ready = waitForImageReady();
      setImageUrl(blobUrl);
      setLastExitLabel(exitLabel);
      await ready;
      setPhase("ready");
      track("scene_reached", { scene_index: newSession.history.length });
    } catch (e) {
      if ((e as { name?: string }).name === "AbortError") {
        setPhase("ready");
        return;
      }
      if (!handleAuthError(e, retry, action)) {
        trackPlayError("scene", e, sceneT0);
        showError(e, retry);
      }
      setPhase("ready");
    }
  }

  function tryRecordedSceneTransition(
    choice: BeatChoice,
    exit: SceneExit,
    visitedForCurrent: string[],
  ): boolean {
    const source = replaySourceRef.current;
    const idx = replayIndexRef.current;
    if (!source || idx < 0 || !isRecordedReplayLockedAt(currentBeatRef.current)) {
      return false;
    }

    const recorded = source.history[idx];
    const next = source.history[idx + 1];
    if (
      !recorded ||
      !next ||
      recorded.exit?.kind !== "choice" ||
      recorded.exit.choiceId !== choice.id
    ) {
      detachRecordedReplay();
      return false;
    }

    void (async () => {
      const replayT0 = Date.now();
      setPhase("transitioning");
      setPendingClick(null);
      try {
        if (!next.scene.imageUrl) throw new Error(t("play.shareErrors.noNextImage"));
        const blobUrl = await getOrCreateBlobUrl(next.scene.imageUrl);
        const priorOriginal = lastImageOriginalUrlRef.current;
        if (priorOriginal && priorOriginal !== next.scene.imageUrl) {
          revokeBlobUrlFor(priorOriginal);
        }
        lastImageOriginalUrlRef.current = next.scene.imageUrl;

        const base = sessionRef.current;
        if (!base) throw new Error("Session lost mid-replay");
        const closedHistory = base.history.map((h, i, arr) =>
          i === arr.length - 1
            ? { ...h, visitedBeatIds: visitedForCurrent, exit }
            : h,
        );
        const nextIndex = idx + 1;
        const nextSession: Session = {
          ...base,
          history: [
            ...closedHistory,
            {
              ...next,
              visitedBeatIds: [next.scene.entryBeatId],
              exit: undefined,
            },
          ],
          characters: source.characters,
          storyState: next.storyStateAfter ?? base.storyState,
          orientation: next.scene.orientation ?? base.orientation,
        };
        replayIndexRef.current = nextIndex;
        replayActiveRef.current = true;
        visitedBeatsRef.current = [next.scene.entryBeatId];
        setSession(nextSession);
        setCurrentScene(next.scene);
        setCurrentBeatId(next.scene.entryBeatId);
        const ready = waitForImageReady();
        setImageUrl(blobUrl);
        setLastExitLabel(choice.label);
        await ready;
        setPhase("ready");
        track("scene_reached", { scene_index: nextSession.history.length });
      } catch (e) {
        if (!handleAuthError(e)) {
          trackPlayError("scene", e, replayT0);
          showError(e, () => onSelectChoice(choice));
        }
        setPhase("ready");
      }
    })();

    return true;
  }

  function recordedAllowedChoiceIds(beat: Beat | null): Set<string> | null {
    if (!replaySourceRef.current || !beat || beat.next.type !== "choice") return null;
    const source = replaySourceRef.current;
    const recorded = source?.history[replayIndexRef.current];
    if (!recorded) return new Set();

    const visited = recorded.visitedBeatIds;
    const beatIdx = visited.indexOf(beat.id);
    if (beatIdx < 0) return null;
    const nextVisited = beatIdx >= 0 ? visited[beatIdx + 1] : undefined;
    const allowed = new Set<string>();
    if (nextVisited) {
      for (const choice of beat.next.choices) {
        if (
          choice.effect.kind === "advance-beat" &&
          choice.effect.targetBeatId === nextVisited
        ) {
          allowed.add(choice.id);
        }
      }
      return allowed;
    }

    if (
      beatIdx === visited.length - 1 &&
      recorded.exit?.kind === "choice" &&
      source.history[replayIndexRef.current + 1]
    ) {
      allowed.add(recorded.exit.choiceId);
      return allowed;
    }
    return null;
  }

  function isRecordedReplayLockedAt(beat: Beat | null): boolean {
    if (!replaySourceRef.current || !beat) return false;
    const recorded = replaySourceRef.current.history[replayIndexRef.current];
    if (!recorded) return false;
    const beatIdx = recorded.visitedBeatIds.indexOf(beat.id);
    if (beatIdx < 0) return false;
    return Boolean(
      recorded.visitedBeatIds[beatIdx + 1] ||
        (
          beatIdx === recorded.visitedBeatIds.length - 1 &&
          recorded.exit?.kind === "choice" &&
          replaySourceRef.current.history[replayIndexRef.current + 1]
        ),
    );
  }

  function isDisabledByRecordedReplay(choice: BeatChoice): boolean {
    const allowed = recordedAllowedChoiceIds(currentBeatRef.current);
    return allowed !== null && !allowed.has(choice.id);
  }

  function onSelectChoice(choice: BeatChoice) {
    if (phase !== "ready" || !session || !currentScene) return;
    if (isDisabledByRecordedReplay(choice)) return;

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
      clearError();
      if (replayActiveRef.current && currentBeatRef.current) {
        const source = replaySourceRef.current;
        const idx = replayIndexRef.current;
        const recorded = source?.history[idx];
        const recordedVisited = recorded?.visitedBeatIds ?? [];
        const beatIdx = recordedVisited.indexOf(currentBeatRef.current.id);
        const recordedNext = beatIdx >= 0 ? recordedVisited[beatIdx + 1] : undefined;
        if (recordedNext && recordedNext !== choice.effect.targetBeatId) {
          detachRecordedReplay();
        }
      } else if (
        replaySourceRef.current &&
        !isRecordedReplayLockedAt(currentBeatRef.current)
      ) {
        detachRecordedReplay();
      }
      // Pure local jump. No network. No pool changes.
      setCurrentBeatId(choice.effect.targetBeatId);
      return;
    }

    const visited = [...visitedBeatsRef.current];
    clearError();
    const exit: SceneExit = {
      kind: "choice",
      choiceId: choice.id,
      label: choice.label,
      nextSceneSeed: choice.effect.nextSceneSeed,
    };

    if (tryRecordedSceneTransition(choice, exit, visited)) return;
    if (replaySourceRef.current) detachRecordedReplay();

    const cached = consumeChoice(poolRef.current, choice.id);
    if (cached) {
      void performSceneTransition(
        cached,
        exit,
        visited,
        choice.label,
        () => onSelectChoice(choice),
        { kind: "choice", choice },
      );
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
      const data = await requestScene({
        session: specSession,
        clientTts: !!byoTtsRef.current,
      });
      return data;
    })();

    void performSceneTransition(
      promise,
      exit,
      visited,
      choice.label,
      () => onSelectChoice(choice),
      { kind: "choice", choice },
    );
  }

  async function onFreeformInput(text: string) {
    if (phase !== "ready" || !session || !currentScene) return;
    // Detach if we're still replaying a shared story (gate on replaySourceRef,
    // not replayActiveRef — the latter is false for a single-scene share, which
    // would otherwise leave us "stuck" in replay and block autosave forever).
    if (replaySourceRef.current) detachRecordedReplay();

    track("freeform_input", {
      scene_index: session.history.length,
      text_length: text.length,
    });

    const freeformT0 = Date.now();
    setPhase("vision-thinking");

    try {
      // Always generate a new scene for freeform text input — the player
      // typed something, so they expect the story to move forward.
      const visited = [...visitedBeatsRef.current];
      const exit: SceneExit = {
        kind: "freeform",
        action: text,
      };
      clearPool(poolRef.current);

      const specSession: Session = {
        ...session,
        history: session.history.map((h, i, arr) =>
          i === arr.length - 1
            ? { ...h, visitedBeatIds: visited, exit }
            : h,
        ),
      };

      const promise = (async () => {
        const data = await requestScene({
          session: specSession,
          clientTts: !!byoTtsRef.current,
        });
        return data;
      })();

      setPendingClick(null);
      void performSceneTransition(
        promise,
        exit,
        visited,
        text,
        () => onFreeformInput(text),
        { kind: "freeform", text },
      );
    } catch (e) {
      if (!handleAuthError(e, () => onFreeformInput(text), { kind: "freeform", text })) {
        trackPlayError("freeform", e, freeformT0);
        showError(e, () => onFreeformInput(text));
      }
      setPhase("ready");
    }
  }

  async function onBackgroundClick(click: { x: number; y: number }) {
    if (phase !== "ready" || !session || !currentScene || !imageUrl) return;
    // Gate on replaySourceRef, not replayActiveRef (false for a single-scene
    // share) — see onFreeformInput for the rationale.
    if (replaySourceRef.current) detachRecordedReplay();
    const visionT0 = Date.now();
    clearError();
    setPhase("vision-thinking");
    setPendingClick(click);

    try {
      const annotatedImageBase64 = await annotateClick(imageUrl, click);
      const decision = await visionDecide({
        session,
        annotatedImageBase64,
      });
      track("vision_click", { result: decision.classify });

      if (decision.classify === "insert-beat") {
        setPhase("inserting-beat");
        const { partial, extraBeats, characters: insertChars } = await requestInsertBeat({
          session,
          freeformAction: decision.intent.freeformAction,
          clientTts: !!byoTtsRef.current,
        });

        const fromBeatId =
          currentBeatRef.current?.id ?? currentScene.entryBeatId;
        const allPartials = [partial, ...(extraBeats ?? [])];
        const newBeats: Beat[] = [];
        const newBeatIds: string[] = [];

        for (const [i, p] of allPartials.entries()) {
          const id = `b_ins_${Date.now()}_${Math.random().toString(36).slice(2, 6)}_${i}`;
          newBeatIds.push(id);
          newBeats.push({
            id,
            narration: p.narration,
            speaker: p.speaker,
            line: p.line,
            lineDelivery: p.lineDelivery,
            next: { type: "continue", nextBeatId: "" },
          });
        }

        // Chain beats: each points to the next; last one loops back to original beat
        for (let i = 0; i < newBeats.length - 1; i++) {
          newBeats[i]!.next = { type: "continue", nextBeatId: newBeatIds[i + 1]! };
        }
        newBeats[newBeats.length - 1]!.next = { type: "continue", nextBeatId: fromBeatId };

        const patched: Scene = {
          ...currentScene,
          beats: [...currentScene.beats, ...newBeats],
        };
        const nextVisited = [...visitedBeatsRef.current, ...newBeatIds];
        visitedBeatsRef.current = nextVisited;

        const nextSession: Session = {
          ...session,
          history: session.history.map((h, i, arr) =>
            i === arr.length - 1 ? { ...h, scene: patched, visitedBeatIds: nextVisited } : h,
          ),
          characters: insertChars,
        };
        setSession(nextSession);
        setCurrentScene(patched);
        setCurrentBeatId(newBeatIds[0]!);

        for (const nb of newBeats) {
          if (nb.speaker && nb.line) {
            void fetchBeatAudio(nextSession, {
              id: nb.id,
              speaker: nb.speaker,
              line: nb.line,
              lineDelivery: nb.lineDelivery,
            });
          }
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
          const data = await requestScene({
            session: specSession,
            clientTts: !!byoTtsRef.current,
          });
          return data;
        })();

        await performSceneTransition(
          promise,
          exit,
          visited,
          decision.intent.freeformAction,
          () => onBackgroundClick(click),
          { kind: "background-click", x: click.x, y: click.y },
        );
      }
    } catch (e) {
      if (!handleAuthError(e, () => onBackgroundClick(click), { kind: "background-click", x: click.x, y: click.y })) {
        trackPlayError("vision", e, visionT0);
        showError(e, () => onBackgroundClick(click));
      }
      setPendingClick(null);
      setPhase("ready");
    }
  }

  // ── Render ────────────────────────────────────────────────────────────

  const replayAllowedChoiceIds = recordedAllowedChoiceIds(currentBeat);
  const disabledReplayChoiceIds =
    replayAllowedChoiceIds && currentBeat?.next.type === "choice"
      ? currentBeat.next.choices
          .filter((choice) => !replayAllowedChoiceIds.has(choice.id))
          .map((choice) => choice.id)
      : [];
  const replayLocked = isRecordedReplayLockedAt(currentBeat);

  const errorOverlay = error && currentScene ? (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/45 px-5 backdrop-blur-[2px]"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="play-error-title"
    >
      <div
        className="w-full max-w-sm border px-6 py-5 text-center shadow-2xl animate-fade-in"
        style={{
          background: "rgba(14, 10, 6, 0.88)",
          borderColor: "rgba(200,165,90,0.45)",
          borderRadius: "8px",
        }}
      >
        <p
          id="play-error-title"
          className="text-[10px] smallcaps text-amber-200/85 mb-3"
        >
          {t("play.error.title")}
        </p>
        <p className="font-serif text-[16px] leading-[1.65] text-white/90 mb-5 break-words">
          {error}
        </p>
        <div className="flex items-center justify-center gap-3">
          {errorRetry && (
            <button
              type="button"
              onClick={retryAfterError}
              className="inline-flex items-center gap-2 border border-amber-300/55 bg-amber-300/15 px-4 py-2 text-[10px] smallcaps text-amber-100 transition-colors hover:bg-amber-300/25"
              style={{ borderRadius: "6px" }}
            >
              <i className="fa-solid fa-rotate-right text-[10px]" />
              {t("play.error.retry")}
            </button>
          )}
          <button
            type="button"
            onClick={clearError}
            className="inline-flex items-center gap-2 border border-white/20 bg-white/10 px-4 py-2 text-[10px] smallcaps text-white/75 transition-colors hover:bg-white/15 hover:text-white"
            style={{ borderRadius: "6px" }}
          >
            <i className="fa-solid fa-xmark text-[10px]" />
            {t("play.error.close")}
          </button>
        </div>
      </div>
    </div>
  ) : null;

  if (error && !currentScene) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-8">
        <div className="max-w-md text-center animate-fade-in">
          <p className="text-[10px] smallcaps text-clay-500 mb-6">
            {t("play.error.title")}
          </p>
          <p className="font-serif italic text-clay-900 text-lg leading-[1.7] mb-6">
            {error}
          </p>
          <Link
            href={lp("/")}
            className="mt-4 text-[10px] smallcaps text-clay-700 hover:text-ember-500 transition-colors inline-flex items-center gap-3"
          >
            <i className="fa-solid fa-arrow-left text-[9px]" />
            {t("play.error.back")}
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
          onFreeformInput={onFreeformInput}
          orientation={orientation}
          playerName={session?.playerName}
          visionClickEnabled={visionClickEnabled}
          onOpenSettings={() => setSettingsOpen(true)}
          onImageReady={handleImageReady}
          fullViewport
          dialogueHistory={dialogueHistory}
          disabledChoiceIds={disabledReplayChoiceIds}
          freeformDisabled={replayLocked}
        />
        {orientation === "portrait" && (
          <div
            className="absolute inset-x-0 top-0 z-10 flex items-center justify-between px-4 pointer-events-none"
            style={{ paddingTop: "max(0.5rem, env(safe-area-inset-top))" }}
          >
            <Link
              href={lp("/")}
              className="pointer-events-auto flex h-9 w-9 items-center justify-center rounded-full bg-black/40 text-white/80 backdrop-blur-sm transition-colors hover:text-white"
              aria-label={t("play.tooltips.back")}
            >
              <i className="fa-solid fa-arrow-left text-[13px]" />
            </Link>
            <button
              type="button"
              onClick={toggleMuted}
              className="pointer-events-auto flex h-9 w-9 items-center justify-center rounded-full bg-black/40 text-white/80 backdrop-blur-sm transition-colors hover:text-white"
              aria-label={muted ? t("play.tooltips.unmute") : t("play.tooltips.mute")}
            >
              <i
                className={`fa-solid ${muted ? "fa-volume-xmark" : "fa-volume-high"} text-[13px]`}
              />
            </button>
          </div>
        )}
        {settingsOpen && (
          <SettingsModal
            initialVisionClickEnabled={visionClickEnabled}
            onClose={() => setSettingsOpen(false)}
            onSaved={handleSettingsSaved}
            footerNote={t("play.settingsFooter")}
          />
        )}
        {authModalOpen && (
          <AuthModal
            onClose={() => {
              setAuthModalOpen(false);
              // User dismissed login — drop the retry, don't re-run the action.
              authResolveRef.current = null;
              pendingResumeActionRef.current = null;
            }}
            onSuccess={() => {
              setAuthModalOpen(false);
              const retry = authResolveRef.current;
              authResolveRef.current = null;
              pendingResumeActionRef.current = null;
              retry?.();
            }}
            onBeforeOAuth={persistPlayResume}
          />
        )}
        {errorOverlay}
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
      {exportProgress && (
        <div
          className="fixed top-4 left-1/2 -translate-x-1/2 z-50 rounded-full bg-black/75 px-4 py-2 text-[11px] smallcaps text-white/95 backdrop-blur-sm shadow-lg flex items-center gap-2"
        >
          <i className="fa-solid fa-circle-notch animate-spin text-[11px] text-amber-300" />
          <span>{exportProgress.label}</span>
          {exportProgress.total > 0 && (
            <span className="num text-white/70">
              {exportProgress.done}/{exportProgress.total}
            </span>
          )}
        </div>
      )}
      <header className="px-5 md:px-12 pt-6 md:pt-8 flex items-center justify-between">
        <Link
          href={lp("/")}
          className="text-clay-600 hover:text-clay-900 transition-colors flex items-center gap-3"
        >
          <i className="fa-solid fa-arrow-left text-[12px]" />
          <span className="font-serif text-[22px] md:text-[26px] leading-none tracking-tight">
            Infi<em className="italic font-light text-ember-500">Plot</em>
          </span>
        </Link>
        <div className="flex items-center gap-3">
          <div className="text-[10px] smallcaps text-clay-500 num flex items-center gap-3">
            <span>{t("play.counter.scene", { n: String(sceneCount).padStart(3, "0") })}</span>
            <span className="text-clay-300">·</span>
            <span>{t("play.counter.beat", { n: String(beatCount).padStart(3, "0") })}</span>
          </div>
          <UserChip />
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
          onFreeformInput={onFreeformInput}
          orientation={orientation}
          playerName={session?.playerName}
          visionClickEnabled={visionClickEnabled}
          onOpenSettings={() => setSettingsOpen(true)}
          onImageReady={handleImageReady}
          dialogueHistory={dialogueHistory}
          disabledChoiceIds={disabledReplayChoiceIds}
          freeformDisabled={replayLocked}
          aboveCanvas={
            <button
              type="button"
              onClick={() => void togglePresentation()}
              className="text-[10px] smallcaps text-clay-500 hover:text-ember-500 transition-colors flex items-center gap-2"
              aria-label={t("play.tooltips.enterFullscreen")}
              title={t("play.tooltips.fullscreen")}
            >
              <i className="fa-solid fa-expand text-[10px]" />
              {t("play.buttons.fullscreen")}
            </button>
          }
          belowCanvas={
            session && session.history.length > 0 ? (
              <>
                <button
                  type="button"
                  onClick={() => void handleExportGallery()}
                  disabled={!!exportProgress}
                  className="text-[10px] smallcaps text-clay-500 hover:text-ember-500 transition-colors flex items-center gap-2 disabled:opacity-50"
                  aria-label={t("play.tooltips.exportGalleryLabel")}
                  title={t("play.tooltips.exportGallery")}
                >
                  <i className="fa-solid fa-link text-[10px]" />
                  {t("play.buttons.exportGallery")}
                </button>
                <button
                  type="button"
                  onClick={() => void handleExportStory()}
                  disabled={!!exportProgress}
                  className="text-[10px] smallcaps text-clay-500 hover:text-ember-500 transition-colors flex items-center gap-2 disabled:opacity-50"
                  aria-label={t("play.tooltips.shareStoryLabel")}
                  title={t("play.tooltips.shareStory")}
                >
                  <i className="fa-solid fa-share-nodes text-[10px]" />
                  {t("play.buttons.shareStory")}
                </button>
              </>
            ) : null
          }
          aboveCanvasLeft={
            <>
              <button
                type="button"
                onClick={toggleMuted}
                className="text-[10px] smallcaps text-clay-500 hover:text-ember-500 transition-colors flex items-center gap-2"
                aria-label={muted ? t("play.tooltips.unmute") : t("play.tooltips.mute")}
                title={muted ? t("play.tooltips.unmute") : t("play.tooltips.mute")}
              >
                <i
                  className={`fa-solid ${muted ? "fa-volume-xmark" : "fa-volume-high"} text-[10px]`}
                />
                {muted ? t("play.buttons.muted") : t("play.buttons.sound")}
              </button>

              {/* Silence nudge — a compact pill right beside the mute toggle.
                  Triggers when the shared server key keeps coming back silent,
                  which usually means it's rate-limited; nudges the player to
                  enter their own API Key for a more stable experience.
                  Clicking opens the settings modal in place; the × dismisses
                  it for the session. */}
              {showSilenceNudge && (
                <span className="flex items-center gap-1 animate-fade-in">
                  <button
                    type="button"
                    onClick={() => setSettingsOpen(true)}
                    className="inline-flex items-center gap-1.5 rounded-full border border-ember-500/40 bg-ember-500/10 px-2.5 py-1 text-[10px] text-ember-500 hover:bg-ember-500/20 transition-colors"
                    title={t("play.tooltips.silenceNudge")}
                  >
                    <i className="fa-solid fa-volume-xmark text-[9px]" />
                    {t("play.tooltips.silenceNudge")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setNudgeDismissed(true)}
                    aria-label={t("play.tooltips.closeNudge")}
                    title={t("play.tooltips.closeNudge")}
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
              {t("play.loading.loadingFirst")}
            </p>
          )}
          {phase === "ready" && lastExitLabel && (
            <p className="text-[9px] smallcaps text-clay-400 animate-fade-in">
              <span className="mr-2">{t("play.previousStep")}</span>
              <span className="text-clay-600">{lastExitLabel}</span>
            </p>
          )}
        </div>

      </main>

      {settingsOpen && (
        <SettingsModal
          initialVisionClickEnabled={visionClickEnabled}
          onClose={() => setSettingsOpen(false)}
          onSaved={handleSettingsSaved}
          footerNote={t("play.settingsFooter")}
        />
      )}
      {authModalOpen && (
        <AuthModal
          onClose={() => {
            setAuthModalOpen(false);
            // User dismissed login — drop the retry, don't re-run the action.
            authResolveRef.current = null;
            pendingResumeActionRef.current = null;
          }}
          onSuccess={() => {
            setAuthModalOpen(false);
            const retry = authResolveRef.current;
            authResolveRef.current = null;
            pendingResumeActionRef.current = null;
            retry?.();
          }}
          onBeforeOAuth={persistPlayResume}
        />
      )}
      {errorOverlay}
    </div>
  );
}

export default function PlayPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center">
          <i className="fa-solid fa-circle-notch fa-spin text-clay-500 text-xl" />
        </div>
      }
    >
      <PlayInner />
    </Suspense>
  );
}
