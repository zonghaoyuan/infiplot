import type {
  BeatAudioRequest,
  BeatAudioResponse,
  EngineConfig,
  FreeformClassify,
  FreeformClassifyRequest,
  FreeformClassifyResponse,
  InsertBeatRequest,
  InsertBeatResponse,
  SceneStreamEvent,
  Session,
  SceneRequest,
  SceneResponse,
  StartRequest,
  StartResponse,
  VisionRequest,
  VisionResponse,
} from "@infiplot/types";
import { coerceOrientation } from "@infiplot/types";
import { chat } from "@infiplot/ai-client";
import { runArchitect } from "./agents/architect";
import { selectStyle } from "./agents/styleSelector";
import { directInsertBeat, directScene } from "./director";
import { STYLE_MAP } from "@/lib/options";
import { parseJsonLoose } from "./jsonParser";
import {
  FREEFORM_CLASSIFY_SYSTEM,
  buildFreeformClassifyUserMessage,
} from "./prompts";
import { synthesizeBeat } from "./voice";
import { interpret } from "./vision";

function newSessionId(): string {
  return `s_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function tlog(label: string, t0: number): void {
  console.log(`${label}: ${Date.now() - t0}ms`);
}

// ──────────────────────────────────────────────────────────────────────
//  startSession — initial Scene via the multi-agent pipeline.
//
//  directScene internally handles: Writer → (CharacterDesigner+
//  Cinematographer parallel) → Painter → upload. Voice provisioning and
//  portrait generation happen inside CharacterDesigner per new character,
//  so the orchestrator no longer needs to coordinate them separately.
// ──────────────────────────────────────────────────────────────────────

export async function startSession(
  config: EngineConfig,
  req: StartRequest,
  emit?: (event: SceneStreamEvent) => void,
): Promise<StartResponse> {
  const tTotal = Date.now();

  const session: Session = {
    id: newSessionId(),
    createdAt: Date.now(),
    worldSetting: req.worldSetting.trim(),
    styleGuide: req.styleGuide.trim(),
    history: [],
    characters: [],
    styleReferenceImage: req.styleReferenceImage?.trim() || undefined,
    orientation: coerceOrientation(req.orientation),
    playerName: req.playerName?.trim() || undefined,
  };

  // Stage 0 — Architect (+ optional auto style selection, in parallel).
  // Both only depend on worldSetting, so they run concurrently.
  console.log(
    `[start] worldSetting (${session.worldSetting.length} chars):\n${session.worldSetting}`,
  );
  const isAutoStyle = session.styleGuide === "auto";
  if (isAutoStyle) {
    session.styleGuide = "由 AI 根据剧情自动匹配最佳画风";
  }
  const tArchitect = Date.now();
  const [architectResult, autoStyleGuide] = await Promise.all([
    runArchitect(config.text, session),
    isAutoStyle
      ? selectStyle(config.text, session.worldSetting).catch((err) => {
          console.warn(`[styleSelector] failed, falling back to 吉卜力:`, err);
          return null;
        })
      : Promise.resolve(null),
  ]);
  session.storyState = architectResult;
  if (isAutoStyle) {
    session.styleGuide = autoStyleGuide ?? STYLE_MAP["吉卜力"]!;
    console.log(`[start] auto-selected style: ${session.styleGuide.slice(0, 60)}…`);
  }
  tlog("[start] Architect" + (isAutoStyle ? " + StyleSelector" : ""), tArchitect);
  console.log(
    `[start] storyBible: logline="${session.storyState.logline}" | genreTags="${session.storyState.genreTags}" | synopsis="${session.storyState.synopsis}"`,
  );

  const { scene, sceneImageUrl, characters, storyState } = await directScene(
    config,
    session,
    emit,
  );

  tlog("[start] TOTAL", tTotal);

  return {
    sessionId: session.id,
    scene,
    imageUrl: sceneImageUrl,
    characters,
    storyState,
  };
}

// ──────────────────────────────────────────────────────────────────────
//  requestScene — next Scene from existing session.
// ──────────────────────────────────────────────────────────────────────

export async function requestScene(
  config: EngineConfig,
  req: SceneRequest,
  emit?: (event: SceneStreamEvent) => void,
): Promise<SceneResponse> {
  const tTotal = Date.now();

  const { scene, sceneImageUrl, characters, storyState } = await directScene(
    config,
    req.session,
    emit,
  );

  tlog("[scene] TOTAL", tTotal);

  return {
    scene,
    imageUrl: sceneImageUrl,
    characters,
    storyState,
  };
}

// ──────────────────────────────────────────────────────────────────────
//  visionDecide — interprets a background click into intent + classify.
//  No change from staging — vision lives outside the scene-generation
//  pipeline.
// ──────────────────────────────────────────────────────────────────────

export async function visionDecide(
  config: EngineConfig,
  req: VisionRequest,
): Promise<VisionResponse> {
  const current = req.session.history.at(-1)?.scene ?? null;
  return interpret(config.vision, req.annotatedImageBase64, current);
}

// ──────────────────────────────────────────────────────────────────────
//  classifyFreeform — classifies a freeform text input at a choice node
//  into match-choice / insert-beat / change-scene. Single lightweight
//  LLM call; no image, no scene generation.
// ──────────────────────────────────────────────────────────────────────

export async function classifyFreeform(
  config: EngineConfig,
  req: FreeformClassifyRequest,
): Promise<FreeformClassifyResponse> {
  const current = req.session.history.at(-1)?.scene ?? null;
  const userMsg = buildFreeformClassifyUserMessage(
    req.freeformText,
    current?.scenePrompt,
  );

  const raw = await chat(config.text, [
    { role: "system", content: FREEFORM_CLASSIFY_SYSTEM },
    { role: "user", content: userMsg },
  ], { temperature: 0, tag: "freeform-classify" });

  const parsed = parseJsonLoose<{
    classify?: string;
    freeformAction?: string;
  }>(raw);

  const classify: FreeformClassify =
    parsed.classify === "change-scene" ? "change-scene" : "insert-beat";

  return {
    classify,
    freeformAction: parsed.freeformAction?.trim() || req.freeformText,
  };
}

// ──────────────────────────────────────────────────────────────────────
//  requestInsertBeat — single-agent transient beat (no image, no new
//  characters). Stays single-LLM by design — the INSERT_BEAT prompt
//  forbids new characters and there's nothing to render.
// ──────────────────────────────────────────────────────────────────────

export async function requestInsertBeat(
  config: EngineConfig,
  req: InsertBeatRequest,
): Promise<InsertBeatResponse> {
  const tTotal = Date.now();

  const partial = await directInsertBeat(
    config.text,
    req.session,
    req.freeformAction,
  );

  // INSERT_BEAT prompt forbids new NPCs — promote disallowed-speaker lines
  // to narration so the player still sees the text (the client only renders
  // `line` when there is a `speaker`).
  //
  // Exception (Pattern B): speaker = "你" is the player speaking. No
  // Character record exists for "你" (intentional — TTS is skipped), so we
  // must NOT demote it; the client renders the dialog box correctly.
  // directInsertBeat already normalized POV variants to "你" before this
  // guard, so a literal "你" here is always Pattern B player dialog.
  if (
    partial.speaker &&
    partial.speaker !== "你" &&
    !req.session.characters.some((c) => c.name === partial.speaker)
  ) {
    console.warn(
      `[insert-beat] unregistered speaker "${partial.speaker}" ignored`,
    );
    const promotedNarration =
      [partial.narration, partial.line].filter(Boolean).join("\n") || undefined;
    tlog("[insert-beat] TOTAL", tTotal);
    return {
      partial: {
        narration: promotedNarration,
        speaker: undefined,
        line: undefined,
        lineDelivery: undefined,
      },
      characters: req.session.characters,
    };
  }

  tlog("[insert-beat] TOTAL", tTotal);
  return { partial, characters: req.session.characters };
}

// ──────────────────────────────────────────────────────────────────────
//  requestBeatAudio — lazy per-beat synth. Returns audio:null on
//  timeout / failure / TTS disabled, so the client just plays silent.
// ──────────────────────────────────────────────────────────────────────

export async function requestBeatAudio(
  config: EngineConfig,
  req: BeatAudioRequest,
): Promise<BeatAudioResponse> {
  if (!config.tts) return { audio: null };
  const audio = await synthesizeBeat(config.tts, req.voice, req.beat);
  return { audio };
}
