import type {
  BeatAudioRequest,
  BeatAudioResponse,
  EngineConfig,
  InsertBeatRequest,
  InsertBeatResponse,
  Session,
  SceneRequest,
  SceneResponse,
  StartRequest,
  StartResponse,
  VisionRequest,
  VisionResponse,
} from "@infiplot/types";
import { runArchitect } from "./agents/architect";
import { directInsertBeat, directScene } from "./director";
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
): Promise<StartResponse> {
  const tTotal = Date.now();

  const session: Session = {
    id: newSessionId(),
    createdAt: Date.now(),
    worldSetting: req.worldSetting.trim(),
    styleGuide: req.styleGuide.trim(),
    history: [],
    characters: [],
  };

  // Stage 0 — Architect: expand the terse world/style prompt into a story
  // bible BEFORE the first scene. Serial by necessity (the opening Writer
  // reads session.storyState), but it gives the whole story a spine from beat
  // one — the latency is offset by the director's portrait/voice overlap win.
  const tArchitect = Date.now();
  session.storyState = await runArchitect(config.text, session);
  tlog("[start] Architect", tArchitect);

  const { scene, sceneImageUrl, characters, storyState } = await directScene(
    config,
    session,
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
): Promise<SceneResponse> {
  const tTotal = Date.now();

  const { scene, sceneImageUrl, characters, storyState } = await directScene(
    config,
    req.session,
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
