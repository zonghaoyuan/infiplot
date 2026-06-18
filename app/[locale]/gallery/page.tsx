"use client";

import Link from "next/link";
import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  Beat,
  BeatChoice,
  Orientation,
  SceneExit,
} from "@infiplot/types";
import {
  downloadImagesIndividually,
  downloadImagesAsZip,
  inferImageExtension,
} from "@/lib/imageZipDownload";
import { useLocalePath } from "@/lib/i18n/hooks";

// ──────────────────────────────────────────────────────────────────────
//  Gallery — an offline-only replay of a played session. Entered from
//  /play via the 导出图集 button, which strips the live Session to the
//  GalleryDoc fields below (no voice base64 / no style reference), writes
//  it to localStorage under a one-shot id, then opens /gallery#id=<id>
//  in a new tab.
//
//  No engine calls happen here. Every scene image is a Runware CDN link
//  the browser already loaded once during play. Choices are clickable:
//   - advance-beat choices are pure local jumps (the beats live in the
//     scene already)
//   - change-scene choices are looked up in `alternates` — main-path picks
//     resolve to the next visited scene, and any AI-prefetched-but-not-taken
//     alternates also live there so the player can explore branches the
//     engine already paid to generate
//  Choices with no recorded alternate are greyed (no way to navigate
//  forward without re-calling the engine, which we deliberately don't do).
// ──────────────────────────────────────────────────────────────────────

export type GalleryScene = {
  /** Scene id from the original engine. Used to key into `alternates` and
   *  to detect when an alternate happens to be a main-path scene. */
  id?: string;
  imageUrl: string;
  sceneKey?: string;
  orientation?: Orientation;
  beats: Beat[];
  entryBeatId: string;
  /** Beat ids the player walked, in order. Set for main-path scenes;
   *  absent for prefetched alternates the player never entered. */
  visitedBeatIds?: string[];
  /** How the player left the scene. Same scoping as visitedBeatIds. */
  exit?: SceneExit;
};

export type GalleryDoc = {
  /** v1 = scenes only (initial export). v2 = + alternates + characters.
   *  v3 = + beat audio (stored in a sidecar localStorage key so the main
   *  doc stays small and the first paint isn't blocked by JSON.parse-ing
   *  several MB of base64). */
  v: 1 | 2 | 3;
  id: string;
  createdAt: number;
  orientation: Orientation;
  scenes: GalleryScene[];
  /** Key: `${parentSceneId}:${choiceId}` → reachable scene. Includes both
   *  main-path picks and AI-prefetched alternates the player abandoned. */
  alternates?: Record<string, GalleryScene>;
  /** Cast for the "下载角色图" button. Name + CDN URL only. */
  characters?: { name: string; basePortraitUrl?: string }[];
};

const STORAGE_PREFIX = "infiplot:gallery:";
const AUDIO_SUFFIX = ":audio";
const MUTED_STORAGE_KEY = "infiplot:gallery:muted";

function readDoc(id: string): GalleryDoc | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + id);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as GalleryDoc;
    if (
      (parsed.v !== 1 && parsed.v !== 2 && parsed.v !== 3) ||
      !Array.isArray(parsed.scenes)
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function readSidecarAudio(id: string): Record<string, string> {
  try {
    const raw = window.localStorage.getItem(
      STORAGE_PREFIX + id + AUDIO_SUFFIX,
    );
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, string>;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === "string" && v.startsWith("data:")) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

function detectOrientation(): Orientation {
  if (typeof window === "undefined") return "landscape";
  const portrait = window.matchMedia("(orientation: portrait)").matches;
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  return portrait && coarse ? "portrait" : "landscape";
}

function findBeat(scene: GalleryScene, beatId: string): Beat | undefined {
  return scene.beats.find((b) => b.id === beatId);
}

// ── Identify which choice the player picked at this beat on the main path.
// For advance-beat picks we match by the next visited beat id; for change-
// scene picks we use the scene's recorded `exit`. Returns null when the
// scene is not on the main path (no visitedBeatIds), or when the beat is
// not on the visited trail.
function pickedChoiceIdAt(
  scene: GalleryScene,
  beatId: string,
): string | null {
  if (!scene.visitedBeatIds) return null;
  const visited = scene.visitedBeatIds;
  const idx = visited.indexOf(beatId);
  if (idx < 0) return null;
  const beat = findBeat(scene, beatId);
  if (!beat || beat.next.type !== "choice") return null;
  const nextVisited = visited[idx + 1];
  if (nextVisited) {
    const c = beat.next.choices.find(
      (c) => c.effect.kind === "advance-beat" && c.effect.targetBeatId === nextVisited,
    );
    if (c) return c.id;
  }
  if (
    scene.exit?.kind === "choice" &&
    idx === visited.length - 1
  ) {
    return scene.exit.choiceId;
  }
  return null;
}

// ──────────────────────────────────────────────────────────────────────
//  Dialogue panel — full beat trail of the current scene
// ──────────────────────────────────────────────────────────────────────

function DialoguePanel({
  scene,
  portrait,
  onClose,
}: {
  scene: GalleryScene;
  portrait: boolean;
  onClose: () => void;
}) {
  // Use visitedBeatIds when present (main path); else walk the entry chain
  // through `continue` beats (alternates have no visit trail so we just show
  // their establishing beat — choice beats can't be auto-resolved).
  const beatIds = useMemo(() => {
    if (scene.visitedBeatIds && scene.visitedBeatIds.length > 0) {
      return scene.visitedBeatIds;
    }
    const chain: string[] = [];
    let cur = scene.entryBeatId;
    const guard = new Set<string>();
    while (cur && !guard.has(cur)) {
      chain.push(cur);
      guard.add(cur);
      const b = findBeat(scene, cur);
      if (!b || b.next.type !== "continue") break;
      cur = b.next.nextBeatId;
    }
    return chain;
  }, [scene]);

  return (
    <div
      className="absolute inset-0 z-30 flex items-center justify-center px-4 py-6"
      style={{ background: "rgba(0,0,0,0.55)" }}
      onClick={onClose}
    >
      <div
        className={`w-full ${portrait ? "max-w-[92vw]" : "max-w-2xl"} max-h-[80dvh] overflow-hidden`}
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "rgba(14, 10, 6, 0.92)",
          border: "1.5px solid rgba(175, 138, 72, 0.72)",
          borderRadius: "6px",
          backdropFilter: "blur(14px)",
          WebkitBackdropFilter: "blur(14px)",
          boxShadow: "0 10px 42px rgba(0,0,0,0.62)",
        }}
        role="dialog"
        aria-modal="true"
        aria-label="本幕对话"
      >
        <div className="flex items-center justify-between border-b border-cream-50/10 px-4 py-3">
          <div className="flex items-center gap-2 text-[10px] smallcaps text-cream-50/70">
            <i className="fa-solid fa-clock-rotate-left text-[10px]" />
            本 · 幕 · 对 · 话
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center text-cream-50/60 transition-colors hover:text-cream-50"
            aria-label="关闭"
          >
            <i className="fa-solid fa-xmark text-[12px]" />
          </button>
        </div>
        <div
          className={`vn-scrollbar overflow-y-auto px-4 py-3 ${portrait ? "max-h-[68dvh]" : "max-h-[70dvh]"}`}
        >
          <div className="space-y-3">
            {beatIds.map((bid, i) => {
              const beat = findBeat(scene, bid);
              if (!beat) return null;
              const body = beat.speaker ? beat.line : beat.narration;
              const narration = beat.speaker ? beat.narration : undefined;
              return (
                <div key={`${bid}-${i}`} className="text-left">
                  <div className="mb-1 flex items-baseline gap-2">
                    <span className="text-[9px] smallcaps text-cream-50/35">
                      第 {String(i + 1).padStart(2, "0")} 拍
                    </span>
                    {beat.speaker && (
                      <span className="font-serif text-[12px] text-[rgba(205,165,90,0.92)]">
                        {beat.speaker}
                      </span>
                    )}
                  </div>
                  {body && (
                    <p
                      className={`font-serif leading-[1.75] ${portrait ? "text-[15px]" : "text-[13px]"}`}
                      style={{ color: "rgba(245,235,210,0.94)" }}
                    >
                      {body}
                    </p>
                  )}
                  {narration && (
                    <p
                      className={`mt-1 font-serif italic leading-[1.65] ${portrait ? "text-[13px]" : "text-[12px]"}`}
                      style={{ color: "rgba(200,185,155,0.72)" }}
                    >
                      {narration}
                    </p>
                  )}
                </div>
              );
            })}
            {scene.exit?.kind === "choice" && (
              <p className="mt-2 inline-flex max-w-full items-start gap-2 rounded-[5px] border border-ember-500/40 bg-ember-500/10 px-2.5 py-1.5 font-serif text-[12px] leading-snug text-cream-50/90">
                <span className="shrink-0 text-ember-300/95">选择</span>
                <span>{scene.exit.label}</span>
              </p>
            )}
            {scene.exit?.kind === "freeform" && (
              <p className="mt-2 inline-flex max-w-full items-start gap-2 rounded-[5px] border border-ember-500/40 bg-ember-500/10 px-2.5 py-1.5 font-serif text-[12px] leading-snug text-cream-50/90">
                <span className="shrink-0 text-ember-300/95">行动</span>
                <span>{scene.exit.action}</span>
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
//  Choice — rendered above the dialogue card
// ──────────────────────────────────────────────────────────────────────

type ChoiceState = "picked" | "navigable" | "dead";

function ChoiceButton({
  choice,
  state,
  vertical,
  onClick,
}: {
  choice: BeatChoice;
  state: ChoiceState;
  vertical: boolean;
  onClick: () => void;
}) {
  const picked = state === "picked";
  const dead = state === "dead";
  return (
    <button
      type="button"
      disabled={dead}
      onClick={onClick}
      className={`group relative ${vertical ? "w-full" : "flex-1 min-w-0"} px-4 py-3 text-left transition-all duration-200 ${
        dead ? "cursor-not-allowed" : "cursor-pointer"
      }`}
      style={{
        background: picked
          ? "rgba(60, 36, 12, 0.85)"
          : dead
            ? "rgba(20, 14, 8, 0.45)"
            : "rgba(20, 14, 8, 0.68)",
        border: picked
          ? "1.5px solid rgba(217, 122, 46, 0.85)"
          : dead
            ? "1.5px solid rgba(120, 100, 70, 0.25)"
            : "1.5px solid rgba(180, 140, 80, 0.65)",
        borderRadius: "6px",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        boxShadow: picked
          ? "0 2px 12px rgba(217,122,46,0.25), inset 0 1px 0 rgba(217,122,46,0.18)"
          : dead
            ? "none"
            : "0 2px 12px rgba(0,0,0,0.4), inset 0 1px 0 rgba(200,165,90,0.12)",
        opacity: dead ? 0.55 : 1,
      }}
    >
      <span
        className={`absolute inset-0 rounded-[5px] transition-opacity duration-200 pointer-events-none ${
          dead ? "opacity-0" : "opacity-0 group-hover:opacity-100"
        }`}
        style={{
          background: "rgba(180,140,60,0.10)",
          border: "1.5px solid rgba(200,165,90,0.85)",
        }}
      />
      <span className="relative flex items-baseline gap-2">
        <span
          className={`shrink-0 font-serif num ${vertical ? "text-[13px]" : "text-[11px]"}`}
          style={{
            color: picked
              ? "rgba(220,150,80,0.95)"
              : dead
                ? "rgba(160,140,100,0.55)"
                : "rgba(195,155,75,0.9)",
          }}
        >
          {picked ? "✓" : "·"}
        </span>
        <span
          className={`font-serif leading-snug ${vertical ? "text-[15px]" : "text-[13px] md:text-[14px]"}`}
          style={{
            color: picked
              ? "rgba(248,238,215,0.98)"
              : dead
                ? "rgba(210,200,180,0.55)"
                : "rgba(245,235,210,0.95)",
          }}
        >
          {choice.label}
        </span>
      </span>
    </button>
  );
}

// ──────────────────────────────────────────────────────────────────────
//  Slide — one scene + its current beat. All interaction lives here.
// ──────────────────────────────────────────────────────────────────────

function Slide({
  scene,
  beatId,
  orientation,
  alternates,
  audioByBeatId,
  muted,
  dialogueOpen,
  setDialogueOpen,
  onAdvanceBeat,
  onChoice,
}: {
  scene: GalleryScene;
  beatId: string;
  orientation: Orientation;
  alternates: Record<string, GalleryScene>;
  audioByBeatId: Record<string, string>;
  muted: boolean;
  dialogueOpen: boolean;
  setDialogueOpen: (b: boolean) => void;
  onAdvanceBeat: (nextBeatId: string) => void;
  onChoice: (choice: BeatChoice) => void;
}) {
  const portrait = orientation === "portrait";
  const intrinsicW = portrait ? 1024 : 1792;
  const intrinsicH = portrait ? 1792 : 1024;

  const beat = findBeat(scene, beatId) ?? findBeat(scene, scene.entryBeatId);

  const audioSrc =
    beat && scene.id && !muted
      ? (audioByBeatId[`${scene.id}:${beat.id}`] ?? null)
      : null;
  const audioRef = useRef<HTMLAudioElement | null>(null);
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    if (!audioSrc) {
      el.pause();
      return;
    }
    el.currentTime = 0;
    void el.play().catch(() => {
      // Browsers can refuse autoplay until user interacts — silent fail is fine.
    });
  }, [audioSrc]);

  const choices: BeatChoice[] =
    beat?.next.type === "choice"
      ? (beat.next as { type: "choice"; choices: BeatChoice[] }).choices
      : [];
  const pickedId = beat ? pickedChoiceIdAt(scene, beat.id) : null;

  const sizeStyle: React.CSSProperties = portrait
    ? { width: "100vw", height: "100dvh", objectFit: "cover" }
    : { maxWidth: "100vw", maxHeight: "100dvh" };

  function choiceState(c: BeatChoice): ChoiceState {
    if (c.id === pickedId) return "picked";
    if (c.effect.kind === "advance-beat") {
      // Beats are local; always navigable.
      return "navigable";
    }
    // change-scene: needs an alternate.
    if (scene.id && alternates[`${scene.id}:${c.id}`]) return "navigable";
    return "dead";
  }

  function handleChoiceClick(c: BeatChoice) {
    const st = choiceState(c);
    if (st === "dead") return;
    onChoice(c);
  }

  function handleImageClick() {
    if (!beat) return;
    if (beat.next.type === "continue") {
      onAdvanceBeat(beat.next.nextBeatId);
    }
    // Choice beats: do nothing — let the player click a choice.
  }

  return (
    <div
      className={`relative ${portrait ? "" : "inline-block"}`}
    >
      <img
        key={scene.imageUrl}
        src={scene.imageUrl}
        width={intrinsicW}
        height={intrinsicH}
        alt="Scene"
        crossOrigin="anonymous"
        draggable={false}
        onClick={handleImageClick}
        className={`block ${portrait ? "" : "w-auto h-auto"} select-none animate-fade-in ${
          beat?.next.type === "continue" ? "cursor-pointer" : "cursor-default"
        }`}
        style={sizeStyle}
      />

      {beat && (
        <div
          className="absolute inset-0 flex flex-col justify-end pointer-events-none select-none"
          style={
            portrait
              ? { paddingBottom: "env(safe-area-inset-bottom)" }
              : undefined
          }
        >
          {choices.length > 0 && (
            <div
              className={`pointer-events-auto px-[3%] pb-[1.5%] flex items-stretch ${
                portrait
                  ? "vn-scrollbar flex-col gap-2 max-h-[45dvh] overflow-y-auto"
                  : "gap-[1.5%]"
              }`}
            >
              {choices.map((choice) => (
                <ChoiceButton
                  key={choice.id}
                  choice={choice}
                  state={choiceState(choice)}
                  vertical={portrait}
                  onClick={() => handleChoiceClick(choice)}
                />
              ))}
            </div>
          )}

          {(beat.narration || beat.line) && (
            <div
              className="pointer-events-auto mx-[2%] mb-[2%] px-[3%] py-[2.2%] relative"
              onClick={(e) => {
                e.stopPropagation();
                handleImageClick();
              }}
              style={{
                background: "rgba(14, 10, 6, 0.72)",
                border: "1.5px solid rgba(175, 138, 72, 0.60)",
                borderRadius: "6px",
                backdropFilter: "blur(10px)",
                WebkitBackdropFilter: "blur(10px)",
                boxShadow:
                  "0 4px 24px rgba(0,0,0,0.55), inset 0 1px 0 rgba(200,165,90,0.10)",
              }}
            >
              {beat.speaker && (
                <p
                  className={`font-serif smallcaps mb-[0.6em] ${
                    portrait ? "text-[13px]" : "text-[11px] md:text-[12px]"
                  }`}
                  style={{ color: "rgba(205,165,90,0.92)" }}
                >
                  {beat.speaker}
                </p>
              )}
              <p
                className={`font-serif leading-[1.85] ${
                  portrait ? "text-[16px]" : "text-[13px] md:text-[15px]"
                }`}
                style={{ color: "rgba(245,235,210,0.95)" }}
              >
                {beat.speaker ? beat.line : beat.narration}
                {beat.speaker && beat.narration && (
                  <span
                    className={`block mt-[0.5em] italic ${portrait ? "text-[14px]" : "text-[12px] md:text-[13px]"}`}
                    style={{ color: "rgba(200,185,155,0.78)" }}
                  >
                    {beat.narration}
                  </span>
                )}
              </p>

              {beat.next.type === "continue" && (
                <span
                  className="absolute bottom-[6px] right-[42px] text-[10px] animate-slow-pulse"
                  style={{ color: "rgba(195,155,75,0.7)" }}
                  aria-hidden
                >
                  ▼
                </span>
              )}

              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setDialogueOpen(true);
                }}
                className="absolute bottom-[6px] right-[8px] flex h-7 w-7 items-center justify-center text-[rgba(195,155,75,0.78)] transition-colors hover:text-[rgba(245,235,210,0.96)]"
                aria-label="查看本幕完整对话"
                title="查看本幕对话"
              >
                <i className="fa-solid fa-clock-rotate-left text-[12px]" />
              </button>
            </div>
          )}
        </div>
      )}

      {dialogueOpen && (
        <DialoguePanel
          scene={scene}
          portrait={portrait}
          onClose={() => setDialogueOpen(false)}
        />
      )}

      {audioSrc && (
        <audio
          ref={audioRef}
          src={audioSrc}
          autoPlay
          preload="auto"
          className="hidden"
        />
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
//  Page — owns the navigation stack
// ──────────────────────────────────────────────────────────────────────

type Frame = {
  scene: GalleryScene;
  beatId: string;
  // Index in the main path array when this frame IS the main-path scene at
  // that index. null when the frame represents an alternate the player has
  // stepped into.
  mainIdx: number | null;
};

function GalleryInner() {
  const lp = useLocalePath();
  const [doc, setDoc] = useState<GalleryDoc | null>(null);
  const [missingId, setMissingId] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [stack, setStack] = useState<Frame[]>([]);
  const [dialogueOpen, setDialogueOpen] = useState(false);
  const [downloadingScenes, setDownloadingScenes] = useState(false);
  const [downloadingPortraits, setDownloadingPortraits] = useState(false);
  const [orientation, setOrientation] = useState<Orientation>("landscape");
  const [presentation, setPresentation] = useState(false);
  // Audio map keyed by `${sceneId}:${beatId}`. Loaded in two phases: the
  // sidecar localStorage key (gallery export path) is read lazily after first
  // paint so the multi-MB JSON.parse doesn't block the first scene image's
  // progressive paint. Imports from `.infiplot` files set this synchronously
  // since the data is already in memory.
  const [audioByBeatId, setAudioByBeatId] = useState<Record<string, string>>({});
  const [muted, setMuted] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.localStorage.getItem(MUTED_STORAGE_KEY) === "1";
    } catch {
      return false;
    }
  });
  // Top toolbar auto-hide while in fullscreen — it shows briefly on entry,
  // retracts upward, and pops back down when the cursor approaches the top
  // edge. Outside presentation mode the bar is always visible.
  const [toolbarVisible, setToolbarVisible] = useState(true);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const preloadedRef = useRef<Set<string>>(new Set());

  // Mirror /play's fullscreen behavior — request browser fullscreen so the
  // tab chrome disappears, with the F key as a shortcut and Esc to exit.
  // The gallery viewport is already `fixed inset-0`, so this only removes
  // the browser's own UI, not anything we render.
  const togglePresentation = useCallback(async () => {
    const entering = !presentation;
    if (entering) {
      try {
        if (!document.fullscreenElement) {
          await document.documentElement.requestFullscreen();
        }
      } catch {
        // ignore — fall back to chrome-less mode anyway
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
    const hash = window.location.hash.replace(/^#/, "");
    const id = new URLSearchParams(hash).get("id") || hash;
    if (!id) {
      setMissingId("");
      return;
    }
    const d = readDoc(id);
    if (!d || d.scenes.length === 0) {
      setMissingId(id);
      return;
    }
    setDoc(d);
    setOrientation(d.orientation ?? detectOrientation());
    const first = d.scenes[0]!;
    setStack([{ scene: first, beatId: first.entryBeatId, mainIdx: 0 }]);

    // Lazy-load the audio sidecar AFTER first paint so its JSON.parse (~MBs
    // of base64) doesn't stall the main thread and let the first image
    // paint row-by-row. setTimeout(0) yields back to the renderer first.
    if (d.v === 3) {
      const t = window.setTimeout(() => {
        const audio = readSidecarAudio(id);
        if (Object.keys(audio).length > 0) setAudioByBeatId(audio);
      }, 0);
      return () => window.clearTimeout(t);
    }
  }, []);

  // Prefer the doc's stored orientation; fall back to the device.
  const top = stack[stack.length - 1] ?? null;
  const alternates = doc?.alternates ?? {};

  // Pre-warm the next + previous main scene images so prev/next never flashes.
  useEffect(() => {
    if (!doc || !top) return;
    const set = preloadedRef.current;
    const candidates: string[] = [top.scene.imageUrl];
    if (top.mainIdx !== null) {
      const prev = doc.scenes[top.mainIdx - 1];
      const next = doc.scenes[top.mainIdx + 1];
      if (prev?.imageUrl) candidates.push(prev.imageUrl);
      if (next?.imageUrl) candidates.push(next.imageUrl);
    }
    for (const url of candidates) {
      if (!url || set.has(url)) continue;
      set.add(url);
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.src = url;
    }
  }, [doc, top]);

  // Mainline position for the header counter. Walk the stack from the top
  // down to the most recent main-path frame; if the player has stepped into
  // an alternate the counter still shows the last main-path index they were
  // on, plus a "支线" tag.
  const mainContextIdx = useMemo(() => {
    for (let i = stack.length - 1; i >= 0; i--) {
      const f = stack[i]!;
      if (f.mainIdx !== null) return f.mainIdx;
    }
    return null;
  }, [stack]);
  const offMain = top?.mainIdx === null;

  // ── Navigation actions ──────────────────────────────────────────────

  const onAdvanceBeat = useCallback((nextBeatId: string) => {
    setStack((s) => {
      if (s.length === 0) return s;
      const t = s[s.length - 1]!;
      if (!findBeat(t.scene, nextBeatId)) return s;
      return [...s.slice(0, -1), { ...t, beatId: nextBeatId }];
    });
    setDialogueOpen(false);
  }, []);

  const onChoice = useCallback(
    (choice: BeatChoice) => {
      setDialogueOpen(false);
      if (choice.effect.kind === "advance-beat") {
        onAdvanceBeat(choice.effect.targetBeatId);
        return;
      }
      // change-scene: resolve via alternates map.
      const t = stack[stack.length - 1];
      if (!t || !t.scene.id) return;
      const alt = alternates[`${t.scene.id}:${choice.id}`];
      if (!alt) return;
      // If this alternate IS the next main-path scene (the typical case for
      // the choice the player actually picked), advance mainIdx; otherwise
      // mark the new frame as off-main.
      const expectedMainIdx =
        t.mainIdx !== null ? t.mainIdx + 1 : null;
      const isMain =
        expectedMainIdx !== null &&
        doc?.scenes[expectedMainIdx]?.id === alt.id;
      setStack((s) => [
        ...s,
        {
          scene: alt,
          beatId: alt.entryBeatId,
          mainIdx: isMain ? expectedMainIdx : null,
        },
      ]);
    },
    [alternates, doc, onAdvanceBeat, stack],
  );

  // Prev / next at the scene level (slideshow-style edges + arrow keys).
  // Implementation: prev pops a stack frame (so alternates back out one step,
  // then we step back through main path); next walks forward by following the
  // recorded path — picked choice on main, entry beat advance otherwise.
  const goPrev = useCallback(() => {
    setStack((s) => {
      if (s.length === 0) return s;
      if (s.length > 1) return s.slice(0, -1);
      // Single frame: step back along main path.
      const t = s[0]!;
      if (t.mainIdx === null || t.mainIdx === 0) return s;
      const prevIdx = t.mainIdx - 1;
      const prevScene = doc?.scenes[prevIdx];
      if (!prevScene) return s;
      return [
        { scene: prevScene, beatId: prevScene.entryBeatId, mainIdx: prevIdx },
      ];
    });
    setDialogueOpen(false);
  }, [doc]);

  const goNext = useCallback(() => {
    setStack((s) => {
      if (s.length === 0) return s;
      const t = s[s.length - 1]!;
      // If on main and there's a next main scene, jump there directly.
      if (t.mainIdx !== null && doc) {
        const nextIdx = t.mainIdx + 1;
        const nextScene = doc.scenes[nextIdx];
        if (nextScene) {
          return [
            {
              scene: nextScene,
              beatId: nextScene.entryBeatId,
              mainIdx: nextIdx,
            },
          ];
        }
      }
      // Off-main: try advancing the current beat (only meaningful for
      // continue beats; choice beats are no-ops at the scene-level).
      const beat = findBeat(t.scene, t.beatId);
      if (beat && beat.next.type === "continue") {
        return [...s.slice(0, -1), { ...t, beatId: beat.next.nextBeatId }];
      }
      return s;
    });
    setDialogueOpen(false);
  }, [doc]);

  // "返回主线" — collapse the stack to its bottom-most main-path frame.
  const goBackToMain = useCallback(() => {
    setStack((s) => {
      for (let i = s.length - 1; i >= 0; i--) {
        if (s[i]!.mainIdx !== null) return s.slice(0, i + 1);
      }
      return s;
    });
    setDialogueOpen(false);
  }, []);

  // On entering presentation: show the bar, then retract after a moment so
  // the player gets a glance at the controls without them blocking the image.
  // On leaving: always-visible again. Clears any pending hide timer between
  // transitions so we never retract back in windowed mode.
  useEffect(() => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
    if (!presentation) {
      setToolbarVisible(true);
      return;
    }
    setToolbarVisible(true);
    hideTimerRef.current = setTimeout(() => {
      setToolbarVisible(false);
      hideTimerRef.current = null;
    }, 2200);
    return () => {
      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
      }
    };
  }, [presentation]);

  // Mouse-driven reveal while in presentation: cursor near the top edge
  // re-shows the bar; moving away starts a short hide countdown.
  useEffect(() => {
    if (!presentation) return;
    const SHOW_ZONE = 96;
    const HIDE_DELAY = 1400;
    function onMove(e: MouseEvent) {
      if (e.clientY < SHOW_ZONE) {
        if (hideTimerRef.current) {
          clearTimeout(hideTimerRef.current);
          hideTimerRef.current = null;
        }
        setToolbarVisible(true);
      } else if (!hideTimerRef.current) {
        hideTimerRef.current = setTimeout(() => {
          setToolbarVisible(false);
          hideTimerRef.current = null;
        }, HIDE_DELAY);
      }
    }
    window.addEventListener("mousemove", onMove);
    return () => window.removeEventListener("mousemove", onMove);
  }, [presentation]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowLeft") goPrev();
      else if (e.key === "ArrowRight") goNext();
      else if (e.key === "f" || e.key === "F") {
        if (e.metaKey || e.ctrlKey || e.altKey) return;
        e.preventDefault();
        void togglePresentation();
      } else if (e.key === "Escape") {
        if (dialogueOpen) setDialogueOpen(false);
        else if (presentation) setPresentation(false);
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
  }, [goPrev, goNext, dialogueOpen, presentation, togglePresentation]);

  const handleDownloadScenes = useCallback(async () => {
    if (!doc || downloadingScenes) return;
    setDownloadingScenes(true);
    try {
      // Main path + every unique alternate (AI-prefetched branches the player
      // didn't take). Dedupe by URL — the picked choice's alternate IS the
      // next main scene, so they overlap, and we never want the same image
      // saved twice. Main scenes get `scene-NNN`; uniquely-alternate scenes
      // get `branch-NNN` so the filenames hint at provenance.
      const seen = new Set<string>();
      const files: { url: string; name: string }[] = [];
      let sceneN = 0;
      for (const sc of doc.scenes) {
        if (!sc.imageUrl || seen.has(sc.imageUrl)) continue;
        seen.add(sc.imageUrl);
        sceneN++;
        files.push({
          url: sc.imageUrl,
          name: `infiplot-scene-${String(sceneN).padStart(3, "0")}.${inferImageExtension(sc.imageUrl)}`,
        });
      }
      let branchN = 0;
      for (const alt of Object.values(doc.alternates ?? {})) {
        if (!alt.imageUrl || seen.has(alt.imageUrl)) continue;
        seen.add(alt.imageUrl);
        branchN++;
        files.push({
          url: alt.imageUrl,
          name: `infiplot-branch-${String(branchN).padStart(3, "0")}.${inferImageExtension(alt.imageUrl)}`,
        });
      }
      const result = await downloadImagesAsZip(files, `infiplot-gallery-${doc.id}.zip`);
      if (result.downloaded === 0) {
        alert("所有图片抓取失败，请检查网络后重试");
      } else if (result.failed.length > 0) {
        alert(`已打包 ${result.downloaded} 张，${result.failed.length} 张抓取失败`);
      }
    } catch {
      alert("打包下载失败，请重试");
    } finally {
      setDownloadingScenes(false);
    }
  }, [doc, downloadingScenes]);

  // ── Import a friend-shared `.infiplot` file ──────────────────────────
  const loadDocFromFile = useCallback(async (file: File) => {
    setImporting(true);
    setImportError(null);
    try {
      const ab = await file.arrayBuffer();
      const r = await fetch("/api/gallery-unpack", {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: ab,
      });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        setImportError(j.error ?? `导入失败 (HTTP ${r.status})`);
        return;
      }
      const { docStr } = (await r.json()) as { docStr?: string };
      if (!docStr) {
        setImportError("服务端返回为空");
        return;
      }
      let parsed: GalleryDoc;
      try {
        parsed = JSON.parse(docStr) as GalleryDoc;
      } catch {
        setImportError("解密后的内容不是有效的图集数据");
        return;
      }
      if (
        (parsed.v !== 1 && parsed.v !== 2) ||
        !Array.isArray(parsed.scenes) ||
        parsed.scenes.length === 0
      ) {
        setImportError("图集数据格式不被支持");
        return;
      }
      setDoc(parsed);
      setOrientation(parsed.orientation ?? detectOrientation());
      const first = parsed.scenes[0]!;
      setStack([{ scene: first, beatId: first.entryBeatId, mainIdx: 0 }]);
      setMissingId(null);
    } catch (e) {
      setImportError(e instanceof Error ? e.message : "导入失败");
    } finally {
      setImporting(false);
    }
  }, []);

  const handleDownloadPortraits = useCallback(async () => {
    if (!doc || downloadingPortraits) return;
    const list = doc.characters ?? [];
    const files = list
      .filter((c) => !!c.basePortraitUrl)
      .map((c, i) => {
        const safeName = c.name.replace(/[^a-zA-Z0-9一-龥_-]/g, "_");
        return {
          url: c.basePortraitUrl as string,
          name: `infiplot-character-${String(i + 1).padStart(2, "0")}-${safeName || "char"}.jpg`,
        };
      });
    if (files.length === 0) return;
    setDownloadingPortraits(true);
    try {
      await downloadImagesIndividually(files);
    } finally {
      setDownloadingPortraits(false);
    }
  }, [doc, downloadingPortraits]);

  // ── Render ──────────────────────────────────────────────────────────

  if (missingId !== null) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-8 text-center">
        <p className="text-[10px] smallcaps text-clay-500 mb-6">
          图 · 集 · 找 · 不 · 到
        </p>
        <p className="font-serif italic text-clay-900 text-lg leading-[1.7] mb-4 max-w-md">
          {missingId
            ? "这份图集存在本机浏览器里,可能已被清理,或不在当前设备上。"
            : "想看朋友分享的图集?选他发给你的 .infiplot 文件;想自己导出?去游戏页点「导出图集」。"}
        </p>

        <label
          className={`mt-2 mb-2 inline-flex items-center gap-2 rounded-full border border-clay-300 bg-cream-100 px-4 py-2 text-[11px] smallcaps text-clay-700 transition-colors ${
            importing
              ? "cursor-wait opacity-60"
              : "cursor-pointer hover:bg-cream-200 hover:border-ember-500/40"
          }`}
        >
          <i
            className={`fa-solid ${importing ? "fa-spinner animate-spin" : "fa-file-import"} text-[11px]`}
          />
          {importing ? "正在导入" : "导入分享文件"}
          <input
            type="file"
            accept=".infiplot,application/octet-stream"
            disabled={importing}
            onChange={(e) => {
              const f = e.target.files?.[0];
              // Reset so picking the same file twice in a row re-fires onChange.
              e.target.value = "";
              if (f) void loadDocFromFile(f);
            }}
            className="hidden"
          />
        </label>

        {importError && (
          <p className="mt-3 max-w-md font-serif text-[12px] italic text-ember-600 leading-relaxed">
            {importError}
          </p>
        )}

        <Link
          href={lp("/")}
          className="mt-6 text-[10px] smallcaps text-clay-700 hover:text-ember-500 transition-colors inline-flex items-center gap-3"
        >
          <i className="fa-solid fa-arrow-left text-[9px]" />
          返回
        </Link>
      </div>
    );
  }

  if (!doc || !top) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <span className="text-[10px] smallcaps text-clay-500 animate-slow-pulse">
          载 · 入 · 中
        </span>
      </div>
    );
  }

  const total = doc.scenes.length;
  const counterIdx = mainContextIdx !== null ? mainContextIdx : 0;
  const portraitCount = (doc.characters ?? []).filter(
    (c) => !!c.basePortraitUrl,
  ).length;

  // Prev disabled at the very start of the main path with a length-1 stack.
  const atVeryStart =
    stack.length === 1 && stack[0]!.mainIdx === 0;
  // Next disabled at the last main scene's terminal beat (or any time there's
  // no main-next AND no beat to advance to).
  const beatAtTop = findBeat(top.scene, top.beatId);
  const hasMainNext =
    top.mainIdx !== null && top.mainIdx < total - 1;
  const hasBeatNext = beatAtTop?.next.type === "continue";
  const atVeryEnd = !hasMainNext && !hasBeatNext;

  return (
    <div className="fixed inset-0 bg-black flex items-center justify-center z-50">
      <Slide
        scene={top.scene}
        beatId={top.beatId}
        orientation={orientation}
        alternates={alternates}
        audioByBeatId={audioByBeatId}
        muted={muted}
        dialogueOpen={dialogueOpen}
        setDialogueOpen={setDialogueOpen}
        onAdvanceBeat={onAdvanceBeat}
        onChoice={onChoice}
      />

      {/* Top bar — auto-hides in fullscreen presentation mode (see toolbarVisible) */}
      <div
        className={`absolute inset-x-0 top-0 z-20 flex items-center justify-between px-3 py-3 pointer-events-none gap-2 transition-transform duration-300 ease-out ${
          toolbarVisible ? "translate-y-0" : "-translate-y-full"
        }`}
        style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}
      >
        <Link
          href={lp("/")}
          className="pointer-events-auto flex h-9 items-center gap-2 rounded-full bg-black/40 px-3 text-[11px] smallcaps text-white/80 backdrop-blur-sm transition-colors hover:text-white"
          aria-label="返回"
        >
          <i className="fa-solid fa-arrow-left text-[12px]" />
          返回
        </Link>

        <div className="pointer-events-auto flex items-center gap-2 flex-wrap justify-center">
          <span
            className="rounded-full bg-black/40 px-3 py-2 text-[10px] smallcaps text-white/85 backdrop-blur-sm num"
            aria-live="polite"
          >
            第 · {String(counterIdx + 1).padStart(3, "0")} · 幕
            <span className="mx-1 text-white/40">/</span>
            {String(total).padStart(3, "0")}
          </span>
          {offMain && (
            <button
              type="button"
              onClick={goBackToMain}
              className="rounded-full bg-ember-500/20 border border-ember-500/50 px-3 py-2 text-[10px] smallcaps text-ember-300 backdrop-blur-sm hover:bg-ember-500/30 transition-colors"
              title="收起所有支线,回到主线"
            >
              <i className="fa-solid fa-route text-[9px] mr-1.5" />
              返回主线
            </button>
          )}
        </div>

        <div className="pointer-events-auto flex items-center gap-2">
          {Object.keys(audioByBeatId).length > 0 && (
            <button
              type="button"
              onClick={() => {
                const next = !muted;
                setMuted(next);
                try {
                  window.localStorage.setItem(MUTED_STORAGE_KEY, next ? "1" : "0");
                } catch {
                  // ignore
                }
              }}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-black/40 text-white/80 backdrop-blur-sm transition-colors hover:text-white"
              aria-label={muted ? "取消静音" : "静音"}
              title={muted ? "取消静音" : "静音"}
            >
              <i
                className={`fa-solid ${muted ? "fa-volume-xmark" : "fa-volume-high"} text-[12px]`}
              />
            </button>
          )}
          <button
            type="button"
            onClick={() => void togglePresentation()}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-black/40 text-white/80 backdrop-blur-sm transition-colors hover:text-white"
            aria-label={presentation ? "退出全屏" : "进入全屏"}
            title={presentation ? "退出全屏 (F)" : "全屏 (F)"}
          >
            <i
              className={`fa-solid ${presentation ? "fa-compress" : "fa-expand"} text-[12px]`}
            />
          </button>
          {portraitCount > 0 && (
            <button
              type="button"
              onClick={handleDownloadPortraits}
              disabled={downloadingPortraits}
              className="flex h-9 items-center gap-2 rounded-full bg-black/40 px-3 text-[11px] smallcaps text-white/80 backdrop-blur-sm transition-colors hover:text-white disabled:opacity-50"
              aria-label="批量下载角色设定图"
              title={`把本局 ${portraitCount} 张角色设定图全部下载到本机（浏览器若弹「允许多个下载」请点允许）`}
            >
              <i
                className={`fa-solid ${downloadingPortraits ? "fa-spinner animate-spin" : "fa-download"} text-[11px]`}
              />
              {downloadingPortraits ? "下载中" : "下载角色图"}
            </button>
          )}
          <button
            type="button"
            onClick={handleDownloadScenes}
            disabled={downloadingScenes}
            className="flex h-9 items-center gap-2 rounded-full bg-black/40 px-3 text-[11px] smallcaps text-white/80 backdrop-blur-sm transition-colors hover:text-white disabled:opacity-50"
            aria-label="批量下载图集到本地"
            title="把本局所有场景图（含未选中的分支预生成图）打包成 zip 下载到本机"
          >
            <i
              className={`fa-solid ${downloadingScenes ? "fa-spinner animate-spin" : "fa-download"} text-[11px]`}
            />
            {downloadingScenes ? "打包中" : "下载图集"}
          </button>
        </div>
      </div>

      {(downloadingScenes || downloadingPortraits) && (
        <div
          className="absolute inset-x-0 z-30 flex justify-center pointer-events-none px-4"
          style={{ top: "calc(max(0.75rem, env(safe-area-inset-top)) + 60px)" }}
        >
          <span className="flex items-center gap-2 rounded-full bg-black/70 px-4 py-2 text-[11px] text-white/95 backdrop-blur-sm shadow-lg max-w-[92vw]">
            <i
              className={`fa-solid ${downloadingScenes ? "fa-file-zipper" : "fa-circle-exclamation"} text-[11px] text-amber-300`}
            />
            {downloadingScenes
              ? "正在抓取图片并打包 zip,完成后会自动开始下载"
              : "浏览器顶部如弹出「允许此网站下载多个文件」,请点「允许」,否则只能下到第一张"}
          </span>
        </div>
      )}

      {/* Left / Right slide nav */}
      <button
        type="button"
        onClick={goPrev}
        disabled={atVeryStart}
        className="absolute left-0 top-0 bottom-0 z-10 w-[10vw] min-w-[44px] flex items-center justify-start pl-3 text-white/35 hover:text-white/85 transition-colors disabled:opacity-0 disabled:cursor-default"
        aria-label="上一幕"
      >
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-black/30 backdrop-blur-sm">
          <i className="fa-solid fa-chevron-left text-[16px]" />
        </span>
      </button>
      <button
        type="button"
        onClick={goNext}
        disabled={atVeryEnd}
        className="absolute right-0 top-0 bottom-0 z-10 w-[10vw] min-w-[44px] flex items-center justify-end pr-3 text-white/35 hover:text-white/85 transition-colors disabled:opacity-0 disabled:cursor-default"
        aria-label="下一幕"
      >
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-black/30 backdrop-blur-sm">
          <i className="fa-solid fa-chevron-right text-[16px]" />
        </span>
      </button>

      {/* Bottom hint */}
      <div
        className="absolute inset-x-0 bottom-0 z-10 flex justify-center pb-3 pointer-events-none"
        style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
      >
        <span className="rounded-full bg-black/35 px-3 py-1.5 text-[9px] smallcaps text-white/65 backdrop-blur-sm">
          ← · → · 切 · 幕 ·  · F · 全 · 屏 ·  · ▼ · 推 · 进 ·  · 选 · 项 · 探 · 支 · 线
        </span>
      </div>
    </div>
  );
}

export default function GalleryPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center">
          <span className="text-[10px] smallcaps text-clay-500 animate-slow-pulse">
            载 · 入 · 中
          </span>
        </div>
      }
    >
      <GalleryInner />
    </Suspense>
  );
}
