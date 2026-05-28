import type {
  BeatAudioRequest,
  BeatAudioResponse,
  Character,
  EngineConfig,
  InsertBeatRequest,
  InsertBeatResponse,
  Scene,
  SceneRequest,
  SceneResponse,
  Session,
  StartRequest,
  StartResponse,
  VisionRequest,
  VisionResponse,
} from "@yume/types";
import { annotateClick } from "./annotate";
import { directInsertBeat, directScene } from "./director";
import { mockImageBase64 } from "./mockImage";
import { render } from "./renderer";
import { interpret } from "./vision";
import { provisionVoicesForScene, synthesizeBeat } from "./voice";

function newSessionId(): string {
  return `s_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// TEMP: per-phase timing for latency diagnosis. Remove after we have data.
function tlog(label: string, t0: number): void {
  console.log(`${label}: ${Date.now() - t0}ms`);
}

// Merge new character entries into the registry by name. If a name already
// exists we preserve the existing voice (so a description revision never
// silently re-provisions a voice the player has already heard).
function mergeCharacters(existing: Character[], updates: Character[]): Character[] {
  if (updates.length === 0) return existing;
  const byName = new Map(existing.map((c) => [c.name, c]));
  for (const u of updates) {
    const prev = byName.get(u.name);
    byName.set(u.name, prev?.voice ? { ...u, voice: prev.voice } : u);
  }
  return Array.from(byName.values());
}

async function renderImage(
  config: EngineConfig,
  scene: Scene,
  styleGuide: string,
): Promise<string> {
  if (config.mockImage) return mockImageBase64();
  return render(config.image, scene, styleGuide);
}

async function provisionForScene(
  config: EngineConfig,
  session: Session,
  scene: Scene,
): Promise<{ characters: Character[] }> {
  if (!config.tts) return { characters: session.characters };
  return provisionVoicesForScene(config.tts, session, scene);
}

// ──────────────────────────────────────────────────────────────────────
//  startSession — first scene + image + voice provisioning. The actual
//  per-beat synth runs lazily via requestBeatAudio so MiMo's tail
//  latency never blocks the UI.
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

  const tDirect = Date.now();
  const { scene, characterUpdates } = await directScene(config.text, session);
  tlog("[start] directScene", tDirect);

  const preVoiceSession: Session = {
    ...session,
    characters: mergeCharacters(session.characters, characterUpdates),
  };

  const tImage = Date.now();
  const tProv = Date.now();
  const imagePromise = renderImage(config, scene, preVoiceSession.styleGuide)
    .then((r) => {
      tlog("[start] renderImage", tImage);
      return r;
    });
  const provPromise = provisionForScene(config, preVoiceSession, scene)
    .then((r) => {
      tlog("[start] provisionForScene", tProv);
      return r;
    });
  const [imageBase64, provRes] = await Promise.all([imagePromise, provPromise]);

  tlog("[start] TOTAL", tTotal);

  return {
    sessionId: session.id,
    scene,
    imageBase64,
    characters: provRes.characters,
  };
}

// ──────────────────────────────────────────────────────────────────────
//  requestScene — generate the NEXT scene + image + voice provisioning.
//  Used both on real scene transitions and on speculative prefetch.
// ──────────────────────────────────────────────────────────────────────

export async function requestScene(
  config: EngineConfig,
  req: SceneRequest,
): Promise<SceneResponse> {
  const tTotal = Date.now();

  const tDirect = Date.now();
  const { scene, characterUpdates } = await directScene(config.text, req.session);
  tlog("[scene] directScene", tDirect);

  const preVoiceSession: Session = {
    ...req.session,
    characters: mergeCharacters(req.session.characters, characterUpdates),
  };

  const tImage = Date.now();
  const tProv = Date.now();
  const imagePromise = renderImage(config, scene, preVoiceSession.styleGuide)
    .then((r) => {
      tlog("[scene] renderImage", tImage);
      return r;
    });
  const provPromise = provisionForScene(config, preVoiceSession, scene)
    .then((r) => {
      tlog("[scene] provisionForScene", tProv);
      return r;
    });
  const [imageBase64, provRes] = await Promise.all([imagePromise, provPromise]);

  tlog("[scene] TOTAL", tTotal);

  return {
    scene,
    imageBase64,
    characters: provRes.characters,
  };
}

// ──────────────────────────────────────────────────────────────────────
//  visionDecide — interprets a background click into intent + classify.
// ──────────────────────────────────────────────────────────────────────

export async function visionDecide(
  config: EngineConfig,
  req: VisionRequest,
): Promise<VisionResponse> {
  const annotated = await annotateClick(req.prevImageBase64, req.click);
  const current = req.session.history.at(-1)?.scene ?? null;
  return interpret(config.vision, annotated, current);
}

// ──────────────────────────────────────────────────────────────────────
//  requestInsertBeat — generates a transient in-scene beat (no image
//  regen, no voice). The client fires /api/beat-audio for the new beat
//  after this returns.
// ──────────────────────────────────────────────────────────────────────

export async function requestInsertBeat(
  config: EngineConfig,
  req: InsertBeatRequest,
): Promise<InsertBeatResponse> {
  const tTotal = Date.now();

  const tDirect = Date.now();
  const partial = await directInsertBeat(
    config.text,
    req.session,
    req.freeformAction,
  );
  tlog("[insert-beat] directInsertBeat", tDirect);

  // INSERT_BEAT prompt forbids new characters — promote disallowed-speaker
  // lines to narration so the player still sees the text (the client only
  // renders `line` when there is a `speaker`).
  if (
    partial.speaker &&
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
