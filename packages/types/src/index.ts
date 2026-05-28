// ──────────────────────────────────────────────────────────────────────
//  Beat — one dialogue / narration moment within a Scene.
//  Multiple beats share the same background image; tapping or choosing
//  advances among them WITHOUT regenerating the image.
// ──────────────────────────────────────────────────────────────────────

export type Beat = {
  id: string;
  narration?: string;
  speaker?: string;
  line?: string;
  /** Free-form voice-acting direction for the line, sent to TTS only. Never displayed. */
  lineDelivery?: string;
  next: BeatNext;
};

export type BeatNext =
  | { type: "continue"; nextBeatId: string }
  | { type: "choice"; choices: BeatChoice[] };

export type BeatChoice = {
  id: string;
  label: string;
  effect: BeatChoiceEffect;
};

export type BeatChoiceEffect =
  | { kind: "advance-beat"; targetBeatId: string }
  | { kind: "change-scene"; nextSceneSeed: string };

// ──────────────────────────────────────────────────────────────────────
//  Scene — one background image + a graph of beats.
//  The Director emits an entire Scene per call; the player navigates
//  through its beats locally with zero network until exiting.
// ──────────────────────────────────────────────────────────────────────

export type Scene = {
  id: string;
  scenePrompt: string;
  beats: Beat[];
  entryBeatId: string;
};

export type SceneExit =
  | {
      kind: "choice";
      choiceId: string;
      label: string;
      nextSceneSeed: string;
    }
  | { kind: "freeform"; action: string };

export type SceneHistoryEntry = {
  scene: Scene;
  visitedBeatIds: string[];
  exit?: SceneExit;
};

// ──────────────────────────────────────────────────────────────────────
//  Characters & voices (TTS)
// ──────────────────────────────────────────────────────────────────────

export type CharacterVoice = {
  provider: "xiaomi";
  /** Xiaomi MiMo design output stored as reference audio for later clones. */
  referenceAudioBase64: string;
  mimeType: string;
};

export type Character = {
  name: string;
  /** Free-form voice design description; must begin with explicit gender. */
  description: string;
  voice?: CharacterVoice;
};

/** A single beat's synthesized audio, attached to the response. */
export type BeatAudio = {
  base64: string;
  mime: string;
};

// ──────────────────────────────────────────────────────────────────────
//  Session
// ──────────────────────────────────────────────────────────────────────

export type Session = {
  id: string;
  createdAt: number;
  worldSetting: string;
  styleGuide: string;
  history: SceneHistoryEntry[];
  /** Character registry — accumulates across scenes; voices persist for reuse. */
  characters: Character[];
};

// ──────────────────────────────────────────────────────────────────────
//  Vision
// ──────────────────────────────────────────────────────────────────────

export type ClickIntent = {
  freeformAction: string;
  reasoning: string;
};

export type VisionClassify = "insert-beat" | "change-scene";

// ──────────────────────────────────────────────────────────────────────
//  Provider config
// ──────────────────────────────────────────────────────────────────────

export type ProviderConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
};

export type TtsConfig = {
  baseUrl: string;
  apiKey: string;
  /** Base model name; adapter derives "-voicedesign" / "-voiceclone" suffixes. */
  speechModel: string;
};

export type EngineConfig = {
  text: ProviderConfig;
  image: ProviderConfig;
  vision: ProviderConfig;
  /** Optional — when missing the game runs silently (no TTS). */
  tts?: TtsConfig;
  /** When true the renderer returns a placeholder PNG instead of calling the image API. */
  mockImage?: boolean;
};

// ──────────────────────────────────────────────────────────────────────
//  API contracts
// ──────────────────────────────────────────────────────────────────────

export type StartRequest = {
  worldSetting: string;
  styleGuide: string;
};

export type StartResponse = {
  sessionId: string;
  scene: Scene;
  imageBase64: string;
  /** Character registry with voice references provisioned for new speakers. */
  characters: Character[];
};

// /api/scene — generates the next Scene, given session whose latest
// history entry has `exit` set. Also used for prefetch speculation
// (frontend synthesizes a speculative exit).
export type SceneRequest = {
  session: Session;
};

export type SceneResponse = {
  scene: Scene;
  imageBase64: string;
  characters: Character[];
};

// /api/beat-audio — lazily synthesize one beat's voice. Client fires this
// per beat after a scene loads; server has a per-call timeout so MiMo
// tail-latency cannot block the UI. A null audio response means "play silent."
//
// Payload deliberately slim: just the line to speak and the speaker's voice
// reference. The client extracts the voice from its local session.characters
// before posting — sending the full Session would force ~160KB of base64 per
// OTHER speaker plus the entire scene history to ride along for nothing.
export type BeatAudioRequest = {
  beat: {
    id: string;
    line: string;
    lineDelivery?: string;
  };
  voice: CharacterVoice;
};

export type BeatAudioResponse = {
  audio: BeatAudio | null;
};

// /api/vision — interprets a background click on the current image and
// classifies whether it should insert a beat (in-scene exploration) or
// trigger a scene change.
export type VisionRequest = {
  session: Session;
  prevImageBase64: string;
  click: { x: number; y: number };
};

export type VisionResponse = {
  intent: ClickIntent;
  classify: VisionClassify;
};

// /api/insert-beat — generates a single transient beat in response to
// a freeform vision action. Does NOT regenerate the image.
export type InsertBeatRequest = {
  session: Session;
  freeformAction: string;
};

/** Partial beat fields produced by the insert-beat director. */
export type InsertBeatPartial = {
  narration?: string;
  speaker?: string;
  line?: string;
  lineDelivery?: string;
};

export type InsertBeatResponse = {
  partial: InsertBeatPartial;
  characters: Character[];
};
