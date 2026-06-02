"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { PlayCanvas, type Phase } from "@/components/PlayCanvas";
import { annotateClick } from "@/lib/annotateClient";
import { PRESETS } from "@/lib/presets";
import type {
  Beat,
  BeatAudio,
  BeatAudioResponse,
  BeatChoice,
  InsertBeatResponse,
  Scene,
  SceneExit,
  SceneResponse,
  Session,
  StartResponse,
  VisionResponse,
} from "@infiplot/types";

const MUTED_STORAGE_KEY = "infiplot:muted";

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
//  Image preload — decode the Runware URL in memory before committing to
//  React state, so when the <img> mounts, the browser cache is warm and
//  rendering is instant. Without this the user sees a blank canvas during
//  the Runware-CDN download (~1-3s) after /api/scene returns.
//
//  Data URIs (MOCK_IMAGE mode) and prefetched-then-cached real URLs both
//  resolve fast / instantly. Errors and timeouts resolve quietly — better
//  to render a broken-image than to hang the play loop indefinitely.
// ──────────────────────────────────────────────────────────────────────

function preloadImage(url: string): Promise<void> {
  return new Promise<void>((resolve) => {
    const img = new Image();
    const done = () => resolve();
    const timer = setTimeout(done, IMAGE_PRELOAD_TIMEOUT_MS);
    img.onload = () => {
      clearTimeout(timer);
      // .decode() forces the bitmap to be fully decoded before we proceed —
      // without it, a slow decode could still cause a flash on first paint.
      img.decode().then(done, done);
    };
    img.onerror = () => {
      clearTimeout(timer);
      done();
    };
    img.src = url;
  });
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
): void {
  if (depth >= PREFETCH_MAX_DEPTH) return;
  const key = pathKey(steps);
  if (pool.has(key)) return;

  const specSession = buildSpeculativeSession(baseSession, steps);
  const abort = new AbortController();
  const promise = (async () => {
    const res = await fetch("/api/scene", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session: specSession }),
      signal: abort.signal,
    });
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(j.error ?? res.statusText);
    }
    const data = (await res.json()) as SceneResponse;

    // Warm the browser's HTTP + image-decode cache for this URL so when the
    // player eventually picks this choice and we render the <img>, it's
    // instant. Don't await — let the bytes stream in the background; the
    // transition path will await its own preloadImage() before committing.
    void preloadImage(data.imageUrl);

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
        prefetchScenePath(pool, carriedBase, [...steps, nextStep], depth + 1);
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
  const [beatAudioMap, setBeatAudioMap] = useState<Record<string, BeatAudio>>({});
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
  const [lastExitLabel, setLastExitLabel] = useState<string | null>(null);

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

  // Mirrors for use inside async handlers (closure-stable)
  const sessionRef = useRef<Session | null>(null);
  const currentSceneRef = useRef<Scene | null>(null);
  const currentBeatRef = useRef<Beat | null>(null);
  const visitedBeatsRef = useRef<string[]>([]);

  const currentBeat = useMemo<Beat | null>(() => {
    if (!currentScene || !currentBeatId) return null;
    return currentScene.beats.find((b) => b.id === currentBeatId) ?? null;
  }, [currentScene, currentBeatId]);

  const currentBeatAudio = currentBeat ? beatAudioMap[currentBeat.id] : undefined;
  const audioBase64 = currentBeatAudio?.base64 ?? null;
  const audioMime = currentBeatAudio?.mime ?? null;

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
      if (!speaker?.voice) return; // not yet provisioned — server can't synth anyway
      if (beatAudioAbortRef.current.has(beat.id)) return;
      const abort = new AbortController();
      beatAudioAbortRef.current.set(beat.id, abort);
      try {
        const res = await fetch("/api/beat-audio", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            beat: { id: beat.id, line: beat.line, lineDelivery: beat.lineDelivery },
            voice: speaker.voice,
          }),
          signal: abort.signal,
        });
        if (!res.ok) return;
        const json = (await res.json()) as BeatAudioResponse;
        // Skip the state write if we've been aborted between the .ok check and
        // here — beat ids are scene-local, so a late arrival from a prior
        // scene would otherwise overwrite the current scene's audio under the
        // same id.
        if (json.audio && !abort.signal.aborted) {
          setBeatAudioMap((m) => ({ ...m, [beat.id]: json.audio as BeatAudio }));
        }
      } catch {
        // aborted or network error — silent fallback
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
    setBeatAudioMap({});
    prefetchSceneAudio();
  }, [currentScene?.id, prefetchSceneAudio]);

  // ── Mute persistence (read is via the useState lazy initializer above) ─
  const toggleMuted = useCallback(() => {
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
    setBeatAudioMap({});
    prefetchSceneAudio();
  }, [muted, prefetchSceneAudio]);

  // ── Presentation mode toggle ─────────────────────────────────────────
  const togglePresentation = useCallback(async () => {
    const entering = !presentation;
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

    let livePayload: { worldSetting: string; styleGuide: string } | null = null;
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
            };
            livePayload = { worldSetting: parsed.worldSetting, styleGuide: parsed.styleGuide };
            // audioEnabled 已在 useState 初始化时反向投射到 muted；这里无需再额外存。
          } catch {
            livePayload = null;
          }
        }
      }
    }

    if (!cardName && !livePayload) {
      router.replace("/");
      return;
    }

    type PrebakedFirstAct = StartResponse & {
      worldSetting: string;
      styleGuide: string;
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
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(livePayload),
        }).then(async (r) => {
          if (!r.ok) {
            const j = (await r.json().catch(() => ({}))) as { error?: string };
            throw new Error(j.error ?? r.statusText);
          }
          const data = (await r.json()) as StartResponse;
          // Live /api/start doesn't echo ws/sg back — splice in what we sent.
          return { ...data, worldSetting: livePayload!.worldSetting, styleGuide: livePayload!.styleGuide };
        });

    fetchStart
      .then(async (data) => {
        // Decode the Runware image in memory before committing to state, so
        // the <img> renders instantly when it mounts (same rationale as the
        // performSceneTransition path).
        await preloadImage(data.imageUrl);

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
        };
        visitedBeatsRef.current = [data.scene.entryBeatId];
        setSession(initial);
        setCurrentScene(data.scene);
        setCurrentBeatId(data.scene.entryBeatId);
        setImageUrl(data.imageUrl);
        // beatAudioMap is populated lazily by the per-beat fetch effect once
        // currentScene becomes non-null (see fetchBeatAudio).
        setPhase("ready");
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
      prefetchScenePath(poolRef.current, s, [step], 0);
    }
  }, [currentScene?.id, session?.id]);

  // Abort all in-flight speculative prefetches when the page unmounts, so we
  // stop paying for background scene/image generation. Empty deps → fires only
  // on unmount; it must NOT run on scene transitions, which rely on
  // consumeChoice keeping the re-rooted survivor prefetches alive.
  useEffect(() => {
    const pool = poolRef.current;
    const beatAborts = beatAudioAbortRef.current;
    return () => {
      clearPool(pool);
      for (const c of beatAborts.values()) c.abort();
      beatAborts.clear();
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

      // Wait for the browser to download + decode the Runware-hosted image
      // BEFORE committing it to state, so the <img> renders instantly when it
      // mounts. For prefetched scenes the preloadImage call inside
      // prefetchScenePath has already warmed the cache, so this resolves
      // almost immediately. For cold transitions we trade an extra ~1-3s of
      // "transitioning" overlay for an image-pop-in-from-blank flash.
      await preloadImage(result.imageUrl);

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
        characters: result.characters,
        storyState: result.storyState,
      };
      visitedBeatsRef.current = [result.scene.entryBeatId];
      setSession(newSession);
      setCurrentScene(result.scene);
      setCurrentBeatId(result.scene.entryBeatId);
      setImageUrl(result.imageUrl);
      // beatAudioMap reset + per-beat fetches kicked off by the scene effect.
      setLastExitLabel(exitLabel);
      setPhase("ready");
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
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session: specSession }),
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
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session, annotatedImageBase64 }),
      });
      if (!visionRes.ok) {
        const j = (await visionRes.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(j.error ?? visionRes.statusText);
      }
      const decision = (await visionRes.json()) as VisionResponse;

      if (decision.classify === "insert-beat") {
        setPhase("inserting-beat");
        const insertRes = await fetch("/api/insert-beat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            session,
            freeformAction: decision.intent.freeformAction,
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
          characters: insertChars,
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
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ session: specSession }),
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
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-8">
        <div className="max-w-md text-center animate-fade-in">
          <p className="text-[10px] smallcaps text-clay-500 mb-6">
            出 · 了 · 点 · 状 · 况
          </p>
          <p className="font-serif italic text-clay-900 text-lg leading-[1.7] mb-10">
            {error}
          </p>
          <Link
            href="/"
            className="text-[10px] smallcaps text-clay-700 hover:text-ember-500 transition-colors inline-flex items-center gap-3"
          >
            <i className="fa-solid fa-arrow-left text-[9px]" />
            返 回
          </Link>
        </div>
      </div>
    );
  }

  if (presentation) {
    return (
      <div className="fixed inset-0 bg-black flex items-center justify-center z-50">
        <PlayCanvas
          imageUrl={imageUrl}
          audioBase64={audioBase64}
          audioMime={audioMime}
          muted={muted}
          phase={phase}
          beat={currentBeat}
          pendingClick={pendingClick}
          onBackgroundClick={onBackgroundClick}
          onAdvance={onAdvance}
          onSelectChoice={onSelectChoice}
          fullViewport
        />
      </div>
    );
  }

  const sceneCount = session?.history.length ?? 0;
  const beatCount = visitedBeatsRef.current.length;

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
          <span className="text-clay-300">·</span>
          <span className="hidden sm:inline truncate max-w-[180px]">
            {session?.id.slice(2, 14) ?? "—"}
          </span>
        </div>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center px-4 md:px-8 py-6 md:py-10">
        <PlayCanvas
          imageUrl={imageUrl}
          audioBase64={audioBase64}
          audioMime={audioMime}
          muted={muted}
          phase={phase}
          beat={currentBeat}
          pendingClick={pendingClick}
          onBackgroundClick={onBackgroundClick}
          onAdvance={onAdvance}
          onSelectChoice={onSelectChoice}
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

      <footer className="px-5 md:px-12 pb-6 flex items-center justify-center">
        {/* 演示 / 静音入口已搬到画面正上方左右两侧；footer 仅留中间的「Ⅰ · Ⅰ」标记 */}
        <div className="text-[9px] smallcaps text-clay-400 num">Ⅰ · Ⅰ</div>
      </footer>
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
