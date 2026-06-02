"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { Beat, BeatChoice } from "@infiplot/types";

export type Phase =
  | "loading-first"        // first scene not yet rendered
  | "ready"                // current beat is interactive
  | "vision-thinking"      // background click → waiting on vision verdict
  | "inserting-beat"       // vision-driven beat being generated
  | "transitioning";       // changing scenes (cache miss or speculative wait)

const SHADOW =
  "0 1px 0 rgba(45,24,16,0.05), 0 36px 64px -28px rgba(45,24,16,0.25), 0 8px 18px -6px rgba(45,24,16,0.10)";

const DEFAULT_CHAR_MS = 28;
const MIN_CHAR_MS = 30;
// Voice playback speed multiplier. >1 speeds up the (somewhat slow) MiMo voice
// while preserving pitch. Typewriter pacing is divided by the same factor.
const SPEECH_RATE = 1.2;
// If audio metadata never arrives within this window, give up waiting and
// let the typewriter run at default speed.
const AUDIO_WAIT_TIMEOUT_MS = 2500;

// ── Typewriter hook ────────────────────────────────────────────────────
// Returns the progressively-revealed text, a `done` flag, and a `skip()` that
// instantly completes the current text. Reset is keyed by `resetKey` (the beat
// id) rather than the text, so a new beat whose line happens to match the
// previous one still replays from scratch.
//
// When `targetDurationMs` is provided we space characters to span that audio
// duration, keeping text and voice in lockstep. While `waitForAudio` is true
// and we don't yet know a duration, the typewriter holds (so text doesn't
// race ahead of an audio that's still loading).
function useTypewriter(
  text: string,
  resetKey: string,
  opts: { targetDurationMs?: number; waitForAudio: boolean } = {
    waitForAudio: false,
  },
): { shown: string; done: boolean; skip: () => void } {
  const { targetDurationMs, waitForAudio } = opts;
  const [displayed, setDisplayed] = useState("");
  const [prevKey, setPrevKey] = useState(resetKey);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  // Sticky once the player has skipped this beat: prevents a late-arriving
  // audio metadata event from re-triggering the effect and replaying the text.
  const skippedRef = useRef(false);

  // Render-phase reset (React "adjust state on prop change" pattern): when the
  // beat changes, drop the old progress before this render commits.
  if (resetKey !== prevKey) {
    setPrevKey(resetKey);
    setDisplayed("");
    skippedRef.current = false;
  }

  useEffect(() => {
    if (!text) return;
    // `=== undefined` (not `!targetDurationMs`): 0 means "audio failed or
    // timed out — run at default speed". The original truthy check stalled
    // the typewriter forever on those fallback paths.
    if (waitForAudio && targetDurationMs === undefined) return;
    // If the player skipped, settle on the full text and don't restart even
    // when audio metadata arrives late and re-triggers this effect.
    if (skippedRef.current) {
      setDisplayed(text);
      return;
    }

    const speed =
      targetDurationMs && text.length > 0
        ? Math.max(MIN_CHAR_MS, targetDurationMs / text.length)
        : DEFAULT_CHAR_MS;

    let i = 0;
    timer.current = setInterval(() => {
      i += 1;
      setDisplayed(text.slice(0, i));
      if (i >= text.length && timer.current) {
        clearInterval(timer.current);
        timer.current = null;
      }
    }, speed);
    return () => {
      if (timer.current) clearInterval(timer.current);
      timer.current = null;
    };
  }, [resetKey, text, targetDurationMs, waitForAudio]);

  const skip = useCallback(() => {
    if (timer.current) {
      clearInterval(timer.current);
      timer.current = null;
    }
    skippedRef.current = true;
    setDisplayed(text);
  }, [text]);

  // During the throwaway render where the beat just changed, `displayed` still
  // holds the previous beat's text — coerce it to empty so nothing stale shows.
  const shown = resetKey === prevKey ? displayed : "";
  const done = text.length === 0 || shown.length >= text.length;
  return { shown, done, skip };
}

// ── Choice button ──────────────────────────────────────────────────────
function ChoiceButton({
  index,
  label,
  disabled,
  onClick,
}: {
  index: number;
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="group relative flex-1 min-w-0 px-4 py-3 text-left transition-all duration-200
        disabled:opacity-50 disabled:cursor-wait"
      style={{
        background: "rgba(20, 14, 8, 0.68)",
        border: "1.5px solid rgba(180, 140, 80, 0.65)",
        borderRadius: "6px",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        boxShadow: "0 2px 12px rgba(0,0,0,0.4), inset 0 1px 0 rgba(200,165,90,0.12)",
      }}
    >
      <span
        className="absolute inset-0 rounded-[5px] opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none"
        style={{
          background: "rgba(180,140,60,0.10)",
          border: "1.5px solid rgba(200,165,90,0.85)",
        }}
      />
      <span className="relative flex items-baseline gap-2">
        <span
          className="shrink-0 font-serif text-[11px] num"
          style={{ color: "rgba(195,155,75,0.9)" }}
        >
          {index + 1}.
        </span>
        <span
          className="font-serif text-[13px] md:text-[14px] leading-snug"
          style={{ color: "rgba(245,235,210,0.95)" }}
        >
          {label}
        </span>
      </span>
    </button>
  );
}

// ── Main component ─────────────────────────────────────────────────────
export function PlayCanvas({
  imageUrl,
  audioBase64,
  audioMime,
  muted,
  phase,
  beat,
  pendingClick,
  onBackgroundClick,
  onAdvance,
  onSelectChoice,
  fullViewport = false,
  aboveCanvas,
  aboveCanvasLeft,
}: {
  imageUrl: string | null;
  audioBase64: string | null;
  audioMime: string | null;
  muted: boolean;
  phase: Phase;
  beat: Beat | null;
  pendingClick: { x: number; y: number } | null;
  onBackgroundClick: (click: { x: number; y: number }) => void;
  onAdvance: () => void;
  onSelectChoice: (choice: BeatChoice) => void;
  fullViewport?: boolean;
  // 渲染在图片正上方、右对齐的 slot（画面外、紧贴右上角）。
  aboveCanvas?: ReactNode;
  // 渲染在图片正上方、左对齐的 slot（画面外、紧贴左上角），与 aboveCanvas 水平镜像。
  aboveCanvasLeft?: ReactNode;
}) {
  const imgRef = useRef<HTMLImageElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [audioDurationMs, setAudioDurationMs] = useState<number | undefined>(
    undefined,
  );

  const isChoiceBeat = beat?.next.type === "choice";
  const choices: BeatChoice[] = isChoiceBeat
    ? (beat!.next as { type: "choice"; choices: BeatChoice[] }).choices
    : [];

  const displayBody = beat?.speaker ? beat.line ?? "" : beat?.narration ?? "";
  const { shown: typedBody, done: typingDone, skip: skipTypewriter } =
    useTypewriter(displayBody, beat?.id ?? "", {
      targetDurationMs: audioDurationMs,
      waitForAudio: Boolean(audioBase64),
    });

  // ── Audio source change ──────────────────────────────────────────────
  // Reset duration when audio source changes; if loading takes too long,
  // unblock the typewriter via timeout so text doesn't stall.
  useEffect(() => {
    setAudioDurationMs(undefined);
    if (!audioBase64) return;
    const timer = setTimeout(() => {
      setAudioDurationMs((prev) => prev ?? 0);
    }, AUDIO_WAIT_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [audioBase64]);

  // ── Mute toggle ───────────────────────────────────────────────────────
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    el.muted = muted;
    el.playbackRate = SPEECH_RATE;
    if (!muted && audioBase64 && el.paused) {
      el.play().catch(() => {
        // autoplay blocked — silent until next interaction
      });
    }
  }, [muted, audioBase64]);

  function handleAudioMetadata() {
    const el = audioRef.current;
    if (!el) return;
    el.playbackRate = SPEECH_RATE;
    // Effective playback time is shorter once sped up — keep the typewriter in sync.
    const ms = Number.isFinite(el.duration)
      ? (el.duration * 1000) / SPEECH_RATE
      : 0;
    setAudioDurationMs(ms > 0 ? ms : 0);
    if (!muted) {
      el.play().catch(() => {
        // autoplay blocked
      });
    }
  }

  function handleAudioError() {
    // Treat as zero duration so the typewriter runs at default speed.
    setAudioDurationMs(0);
  }

  function handleImageClick(e: React.MouseEvent<HTMLImageElement>) {
    if (phase !== "ready" || !imgRef.current || !beat) return;
    const rect = imgRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    // If the typewriter is still printing, a click completes it instantly
    // (standard VN affordance) — the page never sees this click.
    if (!typingDone) {
      skipTypewriter();
      return;
    }
    // For continue-type beats, image click advances; for choice beats,
    // image click goes through vision (treat as freeform action).
    if (beat.next.type === "continue") {
      onAdvance();
      return;
    }
    onBackgroundClick({
      x: Math.max(0, Math.min(1, x)),
      y: Math.max(0, Math.min(1, y)),
    });
  }

  const interactive = phase === "ready" && !!imageUrl;
  const dimmed = phase === "transitioning";

  const sizeStyle = fullViewport
    ? { maxWidth: "100vw", maxHeight: "100dvh" }
    : { maxWidth: "96vw", maxHeight: "calc(100dvh - 200px)" };

  const placeholderWidth = fullViewport
    ? "min(100vw, calc(100dvh * 16 / 9))"
    : "min(96vw, calc((100dvh - 200px) * 16 / 9))";


  return (
    <div
      className={`flex flex-col items-center ${fullViewport ? "w-full h-full justify-center" : "w-full"}`}
    >
      {/* Hidden audio element — voice playback for the current beat */}
      {audioBase64 && (
        <audio
          key={audioBase64.slice(-48)}
          ref={audioRef}
          src={`data:${audioMime ?? "audio/wav"};base64,${audioBase64}`}
          preload="auto"
          onLoadedMetadata={handleAudioMetadata}
          onError={handleAudioError}
          className="hidden"
        />
      )}

      {imageUrl ? (
        <div
          className="relative inline-block"
          style={{ boxShadow: fullViewport ? "none" : SHADOW }}
        >
          {/* Background image — Runware CDN URL or data URI (mock mode).
              The width/height attributes are NOT rendered dimensions (w-auto
              h-auto + the maxWidth/maxHeight in sizeStyle still drive the
              final layout); they give the browser an intrinsic aspect ratio
              so that, while the bytes are still arriving from the CDN, the
              <img> reserves a 1792:1024 box instead of collapsing to a
              one-pixel sliver — fixes the "等很久 → 一根线 → 突然出图" jank. */}
          <img
            key={imageUrl.slice(-48)}
            ref={imgRef}
            src={imageUrl}
            width={1792}
            height={1024}
            alt="Generated scene"
            onClick={handleImageClick}
            draggable={false}
            className={`block w-auto h-auto select-none animate-fade-in transition-opacity duration-700 ease-out ${
              interactive ? "cursor-pointer" : "cursor-wait"
            } ${dimmed ? "opacity-40" : "opacity-100"}`}
            style={sizeStyle}
          />

          {!fullViewport && (
            <div className="absolute inset-x-0 top-0 h-10 bg-gradient-to-b from-clay-900/12 to-transparent pointer-events-none" />
          )}

          {/* 画面正上方右对齐的 slot —— 用 bottom-full + right-0 让它整体浮在图片之外、紧贴右上角 */}
          {!fullViewport && aboveCanvas && (
            <div className="absolute bottom-full right-0 mb-2 flex items-center gap-2">
              {aboveCanvas}
            </div>
          )}
          {!fullViewport && aboveCanvasLeft && (
            <div className="absolute bottom-full left-0 mb-2 flex items-center gap-2">
              {aboveCanvasLeft}
            </div>
          )}

          {beat && (
            <div className="absolute inset-0 flex flex-col justify-end pointer-events-none select-none">
              {choices.length > 0 && (
                <div className="pointer-events-auto px-[3%] pb-[1.5%] flex gap-[1.5%] items-stretch">
                  {choices.map((choice, i) => (
                    <ChoiceButton
                      key={choice.id}
                      index={i}
                      label={choice.label}
                      disabled={phase !== "ready"}
                      onClick={() => onSelectChoice(choice)}
                    />
                  ))}
                </div>
              )}

              {(beat.narration || beat.line) && (
                <div
                  className="pointer-events-none mx-[2%] mb-[2%] px-[3%] py-[2.2%] relative"
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
                  <span
                    className="absolute top-[6px] left-[8px] text-[10px] opacity-40 pointer-events-none"
                    style={{ color: "rgba(195,155,75,1)" }}
                    aria-hidden
                  >
                    ✦
                  </span>
                  <span
                    className="absolute top-[6px] right-[8px] text-[10px] opacity-40 pointer-events-none"
                    style={{ color: "rgba(195,155,75,1)" }}
                    aria-hidden
                  >
                    ✦
                  </span>

                  {beat.speaker && (
                    <p
                      className="font-serif text-[11px] md:text-[12px] smallcaps mb-[0.6em]"
                      style={{ color: "rgba(205,165,90,0.92)" }}
                    >
                      {beat.speaker}
                    </p>
                  )}

                  <p
                    className="font-serif leading-[1.85] text-[13px] md:text-[15px]"
                    style={{ color: "rgba(245,235,210,0.95)" }}
                  >
                    {typedBody}
                    {beat.speaker && beat.narration && (
                      <span
                        className={`block mt-[0.5em] italic text-[12px] md:text-[13px] transition-opacity duration-300 ${
                          typingDone ? "opacity-100" : "opacity-0"
                        }`}
                        style={{ color: "rgba(200,185,155,0.78)" }}
                        aria-hidden={!typingDone}
                      >
                        {beat.narration}
                      </span>
                    )}
                  </p>

                  {typingDone && beat.next.type === "continue" && (
                    <span
                      className="absolute bottom-[6px] right-[10px] text-[10px] animate-slow-pulse"
                      style={{ color: "rgba(195,155,75,0.7)" }}
                      aria-hidden
                    >
                      ▼
                    </span>
                  )}
                </div>
              )}
            </div>
          )}

          {(phase === "transitioning" || phase === "inserting-beat") && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <p className="text-[10px] smallcaps text-cream-50/70 animate-slow-pulse">
                {phase === "transitioning"
                  ? "AI · 正 · 在 · 描 · 画 · 下 · 一 · 幕"
                  : "AI · 正 · 在 · 想 · 你 · 看 · 到 · 了 · 什 · 么"}
              </p>
            </div>
          )}

          {pendingClick && (
            <>
              <div
                className="absolute rounded-full border border-ember-500 pointer-events-none"
                style={{
                  left: `${pendingClick.x * 100}%`,
                  top: `${pendingClick.y * 100}%`,
                  transform: "translate(-50%, -50%)",
                  width: 30,
                  height: 30,
                  animation:
                    "infiplot-ripple 1.6s cubic-bezier(0.16,1,0.3,1) infinite",
                }}
              />
              <div
                className="absolute rounded-full pointer-events-none"
                style={{
                  left: `${pendingClick.x * 100}%`,
                  top: `${pendingClick.y * 100}%`,
                  transform: "translate(-50%, -50%)",
                  width: 11,
                  height: 11,
                  background: "#D97A2E",
                  boxShadow:
                    "0 0 0 3px rgba(251,247,240,0.95), 0 0 14px rgba(217,122,46,0.55)",
                }}
              />
            </>
          )}
        </div>
      ) : (
        <div
          className="relative aspect-video bg-cream-200 flex flex-col items-center justify-center gap-4"
          style={{
            width: placeholderWidth,
            boxShadow: fullViewport ? "none" : SHADOW,
          }}
        >
          <div className="w-1.5 h-1.5 bg-clay-500 rounded-full animate-slow-pulse" />
          <p className="text-[9px] smallcaps text-clay-500 animate-slow-pulse">
            正 · 在 · 绘 · 制 · 第 · 一 · 幕
          </p>
          {/* 加载占位也挂同一对 slot，让右上 / 左上的操作按钮在第一帧就出现 */}
          {!fullViewport && aboveCanvas && (
            <div className="absolute bottom-full right-0 mb-2 flex items-center gap-2">
              {aboveCanvas}
            </div>
          )}
          {!fullViewport && aboveCanvasLeft && (
            <div className="absolute bottom-full left-0 mb-2 flex items-center gap-2">
              {aboveCanvasLeft}
            </div>
          )}
        </div>
      )}

    </div>
  );
}
