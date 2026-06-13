"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  DialogueHistoryModal,
  type DialogueHistoryItem,
} from "@/components/DialogueHistoryModal";
import type { Beat, BeatChoice, Orientation } from "@infiplot/types";

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
  disabledTitle,
  vertical,
  onClick,
}: {
  index: number;
  label: string;
  disabled: boolean;
  disabledTitle?: string;
  vertical: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      title={disabledTitle}
      onClick={onClick}
      className={`group relative ${vertical ? "w-full" : "flex-1 min-w-0"} px-4 py-3 text-left transition-all duration-200
        disabled:opacity-45 disabled:cursor-not-allowed`}
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
          className={`shrink-0 font-serif num ${vertical ? "text-[13px]" : "text-[11px]"}`}
          style={{ color: "rgba(195,155,75,0.9)" }}
        >
          {index + 1}.
        </span>
        <span
          className={`font-serif leading-snug ${vertical ? "text-[15px]" : "text-[13px] md:text-[14px]"}`}
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
  audioSrc,
  muted,
  phase,
  beat,
  pendingClick,
  onBackgroundClick,
  onAdvance,
  onSelectChoice,
  onFreeformInput,
  fullViewport = false,
  orientation = "landscape",
  playerName,
  visionClickEnabled = true,
  onOpenSettings,
  onImageReady,
  aboveCanvas,
  aboveCanvasLeft,
  belowCanvas,
  dialogueHistory = [],
  disabledChoiceIds = [],
  freeformDisabled = false,
}: {
  imageUrl: string | null;
  audioSrc: string | null;
  muted: boolean;
  phase: Phase;
  beat: Beat | null;
  pendingClick: { x: number; y: number } | null;
  onBackgroundClick: (click: { x: number; y: number }) => void;
  onAdvance: () => void;
  onSelectChoice: (choice: BeatChoice) => void;
  onFreeformInput?: (text: string) => void;
  fullViewport?: boolean;
  // 会话锁定的图片朝向。"portrait" 时整图铺满视口（object-fit:cover）、选项竖排、字号放大。
  orientation?: Orientation;
  playerName?: string;
  // 选择节点点击背景是否触发识图。关闭时背景点击保持静默，用户只能点选项。
  visionClickEnabled?: boolean;
  onOpenSettings?: () => void;
  onImageReady?: () => void;
  // 渲染在图片正上方、右对齐的 slot（画面外、紧贴右上角）。
  aboveCanvas?: ReactNode;
  // 渲染在图片正上方、左对齐的 slot（画面外、紧贴左上角），与 aboveCanvas 水平镜像。
  aboveCanvasLeft?: ReactNode;
  // 渲染在图片正下方、右对齐的 slot（画面外、紧贴右下角），与 aboveCanvas 垂直镜像。
  belowCanvas?: ReactNode;
  dialogueHistory?: DialogueHistoryItem[];
  disabledChoiceIds?: readonly string[];
  freeformDisabled?: boolean;
}) {
  const imgRef = useRef<HTMLImageElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [freeformOpen, setFreeformOpen] = useState(false);
  const [freeformText, setFreeformText] = useState("");
  const freeformInputRef = useRef<HTMLInputElement>(null);
  const displaySpeaker = (s: string | undefined) =>
    s === "你" && playerName ? playerName : s;
  const [audioDurationMs, setAudioDurationMs] = useState<number | undefined>(
    undefined,
  );

  const isChoiceBeat = beat?.next.type === "choice";
  const choices: BeatChoice[] = isChoiceBeat
    ? (beat!.next as { type: "choice"; choices: BeatChoice[] }).choices
    : [];
  const disabledChoices = new Set(disabledChoiceIds);

  const displayBody = beat?.speaker ? beat.line ?? "" : beat?.narration ?? "";
  const { shown: typedBody, done: typingDone, skip: skipTypewriter } =
    useTypewriter(displayBody, beat?.id ?? "", {
      targetDurationMs: audioDurationMs,
      waitForAudio: Boolean(audioSrc),
    });

  // ── Audio source change ──────────────────────────────────────────────
  // Reset duration when audio source changes; if loading takes too long,
  // unblock the typewriter via timeout so text doesn't stall.
  useEffect(() => {
    setAudioDurationMs(undefined);
    if (!audioSrc) return;
    const timer = setTimeout(() => {
      setAudioDurationMs((prev) => prev ?? 0);
    }, AUDIO_WAIT_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [audioSrc]);

  // ── Mute toggle ───────────────────────────────────────────────────────
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    el.muted = muted;
    el.playbackRate = SPEECH_RATE;
    if (!muted && audioSrc && el.paused) {
      el.play().catch(() => {
        // autoplay blocked — silent until next interaction
      });
    }
  }, [muted, audioSrc]);

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
    if (phase !== "ready" || !beat) return;
    if (!typingDone) {
      skipTypewriter();
      return;
    }
    if (beat.next.type === "continue") {
      onAdvance();
      return;
    }
    if (freeformDisabled || !visionClickEnabled || !imgRef.current) return;
    const el = imgRef.current;
    const rect = el.getBoundingClientRect();
    let x: number;
    let y: number;
    if (orientation === "portrait") {
      const nw = el.naturalWidth || 1024;
      const nh = el.naturalHeight || 1792;
      const scale = Math.max(rect.width / nw, rect.height / nh);
      const dispW = nw * scale;
      const dispH = nh * scale;
      x = (e.clientX - rect.left + (dispW - rect.width) / 2) / dispW;
      y = (e.clientY - rect.top + (dispH - rect.height) / 2) / dispH;
    } else {
      x = (e.clientX - rect.left) / rect.width;
      y = (e.clientY - rect.top) / rect.height;
    }
    onBackgroundClick({
      x: Math.max(0, Math.min(1, x)),
      y: Math.max(0, Math.min(1, y)),
    });
  }

  // Card swallows its own clicks so they never fall through to the image's
  // vision (识图) trigger: while typing a click completes the text, a continue
  // beat advances, and a choice beat stays inert (player must pick an option).
  function handleCardClick() {
    if (phase !== "ready" || !beat) return;
    if (!typingDone) {
      skipTypewriter();
      return;
    }
    if (beat.next.type === "continue") onAdvance();
  }

  const interactive = phase === "ready" && !!imageUrl;
  const imageClickable =
    interactive &&
    (!typingDone ||
      beat?.next.type === "continue" ||
      (visionClickEnabled && !freeformDisabled));
  const dimmed = phase === "transitioning";

  const portrait = orientation === "portrait";
  const intrinsicW = portrait ? 1024 : 1792;
  const intrinsicH = portrait ? 1792 : 1024;

  // Portrait (mobile) always fills the whole viewport with object-fit:cover so
  // the 9:16 image matches the exact device/window — no letterbox. Landscape
  // keeps the prior contain-style sizing so the full 16:9 frame stays visible.
  const sizeStyle: React.CSSProperties = portrait
    ? { width: "100%", height: "100%", objectFit: "cover" }
    : fullViewport
      ? { width: "100%", height: "100%", objectFit: "contain" }
      : { width: "100%", height: "100%" };

  const canvasStyle: React.CSSProperties = portrait
    ? { width: "100vw", height: "100dvh" }
    : {
        width: fullViewport
          ? "min(100vw, calc(100dvh * 16 / 9))"
          : "min(96vw, calc((100dvh - 200px) * 16 / 9))",
        aspectRatio: "16 / 9",
        maxHeight: fullViewport ? "100dvh" : "calc(100dvh - 200px)",
      };

  const placeholderStyle: React.CSSProperties = portrait
    ? { width: "100vw", height: "100dvh" }
    : {
        width: fullViewport
          ? "min(100vw, calc(100dvh * 16 / 9))"
          : "min(96vw, calc((100dvh - 200px) * 16 / 9))",
      };


  return (
    <div
      className={`flex flex-col items-center ${fullViewport ? "w-full h-full justify-center" : "w-full"}`}
    >
      {/* Hidden audio element — voice playback for the current beat */}
      {audioSrc && (
        <audio
          key={audioSrc.slice(-48)}
          ref={audioRef}
          src={audioSrc}
          preload="auto"
          onLoadedMetadata={handleAudioMetadata}
          onError={handleAudioError}
          className="hidden"
        />
      )}

      {imageUrl ? (
        <div
          className="relative"
          style={{ ...canvasStyle, boxShadow: fullViewport ? "none" : SHADOW }}
        >
          {/* The stable wrapper owns the frame size. Keeping overlay geometry
              independent of <img> decode/source swaps prevents controls from
              jumping when a newly generated image is committed. */}
          <img
            key={imageUrl}
            ref={imgRef}
            src={imageUrl}
            width={intrinsicW}
            height={intrinsicH}
            alt="Generated scene"
            onClick={handleImageClick}
            draggable={false}
            onLoad={() => {
              if (!onImageReady) return;
              const el = imgRef.current;
              if (!el) { onImageReady(); return; }
              const notify = () => { if (imgRef.current === el) onImageReady(); };
              el.decode().then(notify, notify);
            }}
            className={`block select-none animate-fade-in transition-opacity duration-700 ease-out ${
              imageClickable ? "cursor-pointer" : interactive ? "cursor-default" : "cursor-wait"
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
          {!fullViewport && belowCanvas && (
            <div className="absolute top-full right-0 mt-2 flex items-center gap-2">
              {belowCanvas}
            </div>
          )}

          {beat && (
            <div
              className="absolute inset-0 flex flex-col justify-end pointer-events-none select-none"
              style={
                portrait
                  ? { paddingBottom: "env(safe-area-inset-bottom)" }
                  : undefined
              }
            >
              {historyOpen && (
                <DialogueHistoryModal
                  items={dialogueHistory}
                  portrait={portrait}
                  onClose={() => setHistoryOpen(false)}
                  playerName={playerName}
                />
              )}

              {choices.length > 0 && (
                <div
                  className={`pointer-events-auto px-[3%] pb-[1.5%] flex items-stretch ${
                    portrait
                      ? "vn-scrollbar flex-col gap-2 max-h-[45dvh] overflow-y-auto"
                      : "gap-[1.5%]"
                  }`}
                >
                  {freeformOpen && onFreeformInput ? (
                    /* ── Expanded: full-width input replaces all choices ── */
                    <div
                      className="flex-1 flex items-center gap-2"
                      style={{
                        background: "rgba(20, 14, 8, 0.68)",
                        border: "1.5px solid rgba(180, 140, 80, 0.65)",
                        borderRadius: "6px",
                        backdropFilter: "blur(8px)",
                        WebkitBackdropFilter: "blur(8px)",
                        boxShadow: "0 2px 12px rgba(0,0,0,0.4), inset 0 1px 0 rgba(200,165,90,0.12)",
                        padding: "8px 12px",
                      }}
                    >
                      <input
                        ref={freeformInputRef}
                        value={freeformText}
                        onChange={(e) => setFreeformText(e.target.value.slice(0, 50))}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.nativeEvent.isComposing && freeformText.trim() && phase === "ready") {
                            onFreeformInput(freeformText.trim());
                            setFreeformOpen(false);
                            setFreeformText("");
                          } else if (e.key === "Escape") {
                            setFreeformOpen(false);
                            setFreeformText("");
                          }
                        }}
                        placeholder="输入你想说的或想做的..."
                        maxLength={50}
                        autoFocus
                        className="flex-1 min-w-0 bg-transparent border-none outline-none font-serif text-[14px] placeholder:text-[rgba(200,185,155,0.50)]"
                        style={{ color: "rgba(245,235,210,0.95)" }}
                      />
                      <button
                        type="button"
                        disabled={!freeformText.trim() || phase !== "ready"}
                        onClick={() => {
                          if (freeformText.trim()) {
                            onFreeformInput(freeformText.trim());
                            setFreeformOpen(false);
                            setFreeformText("");
                          }
                        }}
                        className="shrink-0 flex items-center justify-center w-8 h-8 rounded-sm transition-colors disabled:opacity-30"
                        style={{ color: "rgba(195,155,75,0.9)" }}
                      >
                        <i className="fa-solid fa-paper-plane text-[12px]" />
                      </button>
                      <button
                        type="button"
                        onClick={() => { setFreeformOpen(false); setFreeformText(""); }}
                        className="shrink-0 flex items-center justify-center w-8 h-8 rounded-sm transition-colors"
                        style={{ color: "rgba(200,185,155,0.55)" }}
                      >
                        <i className="fa-solid fa-xmark text-[13px]" />
                      </button>
                    </div>
                  ) : (
                    /* ── Collapsed: normal choices + small freeform trigger ── */
                    <>
                      {choices.map((choice, i) => (
                        <ChoiceButton
                          key={choice.id}
                          index={i}
                          label={choice.label}
                          disabled={phase !== "ready" || disabledChoices.has(choice.id)}
                          disabledTitle={disabledChoices.has(choice.id) ? "分享剧情未包含这条分支" : undefined}
                          vertical={portrait}
                          onClick={() => onSelectChoice(choice)}
                        />
                      ))}
                      {onFreeformInput && !freeformDisabled && (
                        <button
                          type="button"
                          disabled={phase !== "ready"}
                          onClick={() => {
                            setFreeformOpen(true);
                            requestAnimationFrame(() => freeformInputRef.current?.focus());
                          }}
                          className="group shrink-0 flex items-center justify-center transition-all duration-200 disabled:opacity-50 disabled:cursor-wait"
                          style={{
                            background: "rgba(20, 14, 8, 0.45)",
                            border: "1.5px dashed rgba(180, 140, 80, 0.40)",
                            borderRadius: "6px",
                            backdropFilter: "blur(8px)",
                            WebkitBackdropFilter: "blur(8px)",
                            width: portrait ? "100%" : "42px",
                            padding: portrait ? "10px 16px" : "0",
                          }}
                          title="自由输入"
                        >
                          <span
                            className="opacity-0 group-hover:opacity-100 absolute inset-0 rounded-[5px] transition-opacity duration-200 pointer-events-none"
                            style={{
                              background: "rgba(180,140,60,0.08)",
                              border: "1.5px dashed rgba(200,165,90,0.70)",
                            }}
                          />
                          {portrait ? (
                            <span className="relative flex items-center gap-2">
                              <i
                                className="fa-solid fa-pen-to-square text-[11px]"
                                style={{ color: "rgba(195,155,75,0.60)" }}
                              />
                              <span
                                className="font-serif text-[13px]"
                                style={{ color: "rgba(200,185,155,0.70)" }}
                              >
                                自由输入
                              </span>
                            </span>
                          ) : (
                            <i
                              className="fa-solid fa-pen-to-square text-[12px] relative"
                              style={{ color: "rgba(195,155,75,0.55)" }}
                            />
                          )}
                        </button>
                      )}
                    </>
                  )}
                </div>
              )}

              {(beat.narration || beat.line) && (
                <div
                  className="pointer-events-auto mx-[2%] mb-[2%] px-[3%] py-[2.2%] relative"
                  onClick={handleCardClick}
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
                      className={`font-serif smallcaps mb-[0.6em] ${
                        portrait ? "text-[13px]" : "text-[11px] md:text-[12px]"
                      }`}
                      style={{ color: "rgba(205,165,90,0.92)" }}
                    >
                      {displaySpeaker(beat.speaker)}
                    </p>
                  )}

                  <p
                    className={`font-serif leading-[1.85] ${
                      portrait ? "text-[16px]" : "text-[13px] md:text-[15px]"
                    }`}
                    style={{ color: "rgba(245,235,210,0.95)" }}
                  >
                    {typedBody}
                    {beat.speaker && beat.narration && (
                      <span
                        className={`block mt-[0.5em] italic transition-opacity duration-300 ${
                          portrait ? "text-[14px]" : "text-[12px] md:text-[13px]"
                        } ${typingDone ? "opacity-100" : "opacity-0"}`}
                        style={{ color: "rgba(200,185,155,0.78)" }}
                        aria-hidden={!typingDone}
                      >
                        {beat.narration}
                      </span>
                    )}
                  </p>

                  {typingDone && beat.next.type === "continue" && (
                    <span
                      className={`absolute bottom-[6px] ${onOpenSettings ? "right-[74px]" : "right-[42px]"} text-[10px] animate-slow-pulse`}
                      style={{ color: "rgba(195,155,75,0.7)" }}
                      aria-hidden
                    >
                      ▼
                    </span>
                  )}

                  {onOpenSettings && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenSettings();
                      }}
                      className="absolute bottom-[6px] right-[8px] flex h-7 w-7 items-center justify-center text-[rgba(195,155,75,0.78)] transition-colors hover:text-[rgba(245,235,210,0.96)]"
                      aria-label="打开设置"
                      title="设置"
                    >
                      <i className="fa-solid fa-gear text-[12px]" />
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setHistoryOpen(true);
                    }}
                    className={`absolute bottom-[6px] ${
                      onOpenSettings ? "right-[40px]" : "right-[8px]"
                    } flex h-7 w-7 items-center justify-center text-[rgba(195,155,75,0.78)] transition-colors hover:text-[rgba(245,235,210,0.96)]`}
                    aria-label="打开剧情回溯"
                    title="剧情回溯"
                  >
                    <i className="fa-solid fa-clock-rotate-left text-[12px]" />
                  </button>
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
          className={`relative bg-cream-200 flex flex-col items-center justify-center gap-4 ${
            portrait ? "" : "aspect-video"
          }`}
          style={{ ...placeholderStyle, boxShadow: fullViewport ? "none" : SHADOW }}
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
          {!fullViewport && belowCanvas && (
            <div className="absolute top-full right-0 mt-2 flex items-center gap-2">
              {belowCanvas}
            </div>
          )}
        </div>
      )}

    </div>
  );
}
