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
  /**
   * Characters visible in this beat with their pose / expression for this moment.
   * Read by the Cinematographer when composing the scene's establishing shot —
   * the beat the entry beat lands in is the visual anchor for the image.
   */
  activeCharacters?: BeatActiveCharacter[];
  next: BeatNext;
};

export type BeatActiveCharacter = {
  name: string;
  /** Free-form 中文 description of pose / expression / what the character is doing. */
  pose?: string;
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
//  Orientation — session-wide image aspect, locked at session start.
//  "landscape" → 16:9 (1792×1024), the default for desktop / mobile-landscape.
//  "portrait"  → 9:16 (1024×1792), painted for mobile users holding the phone
//  upright so the scene fills the screen instead of letterboxing a widescreen
//  image. CSS object-fit then adapts the 9:16 frame to the exact device size.
// ──────────────────────────────────────────────────────────────────────

export type Orientation = "portrait" | "landscape";

/** Normalize an untrusted orientation value (from a request body, or a
 *  persisted session that predates the field) to a valid Orientation.
 *  Anything other than "portrait" falls back to "landscape" (back-compat). */
export function coerceOrientation(value: unknown): Orientation {
  return value === "portrait" ? "portrait" : "landscape";
}

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
  /**
   * Stable English slug identifying the visual scene's location + time,
   * e.g. "classroom-dusk", "rooftop-night". When the next Scene shares this
   * key, the Painter slots the previous Scene's image into Runware's
   * `referenceImages` (alongside character portraits) so the same physical
   * space stays visually consistent across cuts.
   */
  sceneKey?: string;
  /**
   * Runware UUID of this Scene's generated image. Cheapest form to send back
   * to Runware's `referenceImages` in subsequent calls (UUID > URL > base64
   * in transport cost). Not shown to the client — `imageUrl` is what renders.
   */
  imageUuid?: string;
  /**
   * Public CDN URL of this Scene's generated image. Returned to the client for
   * `<img src>` rendering; the client also feeds it through a Canvas 2D click
   * annotator before posting to `/api/vision` (see
   * `VisionRequest.annotatedImageBase64`).
   *
   * For MOCK_IMAGE=true this is a `data:image/svg+xml;...` data URI, not a
   * Runware URL — the client renders both forms transparently.
   */
  imageUrl?: string;
  /**
   * Orientation this scene's image was painted in. Mirrors the session's
   * locked orientation; recorded per-scene so the client can pick the right
   * intrinsic dimensions / object-fit even across legacy or mixed history.
   */
  orientation?: Orientation;
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
  /** Story memory immediately after this scene was generated. Used by imported
   *  story replays so continuing from an earlier shared scene preserves the
   *  right narrative context instead of jumping to the export-time final state. */
  storyStateAfter?: StoryState;
};

// ──────────────────────────────────────────────────────────────────────
//  Writer two-phase split
//
//  The Writer runs as TWO LLM calls so scene-image generation can begin
//  before the dialogue is fully written:
//    Phase A (WriterPlan) — the minimal skeleton the image pipeline needs:
//                           sceneSummary + sceneKey + the entry beat's
//                           on-stage roster + the full cast to design.
//    Phase B (beats)      — the full beats[] graph + storyStatePatch, written
//                           to honor the plan, overlapped with image gen.
//  The Cinematographer + character design + Painter all run off the Plan, so
//  Phase B's (longer) output is hidden behind the image pipeline.
// ──────────────────────────────────────────────────────────────────────

export type WriterPlan = {
  /** 中文 scene synopsis (location + time + mood + key event + opening hook).
   *  The sole input the Cinematographer composes the establishing shot from. */
  sceneSummary: string;
  /** English location+time slug for cross-scene visual continuity. */
  sceneKey?: string;
  /** Beat id the player lands on when entering the scene. Phase B must emit a
   *  beat with this id (reconciled if it doesn't). */
  entryBeatId: string;
  /** Every NPC name that appears anywhere in this scene. Drives character
   *  design (card + portrait + voice) IN PARALLEL with Phase B beat writing, so
   *  the whole cast is provisioned by the time the scene returns. Phase B may
   *  only use names from this list (plus the POV "你"). Never includes the player. */
  cast: string[];
  /** The entry beat's on-stage roster (who's visible + pose when the player
   *  lands). Drives the Cinematographer's framing and the entry-beat portraits
   *  the Painter anchors to. Never includes the POV player. */
  entryActiveCharacters: BeatActiveCharacter[];
  /** The entry beat's speaker — an NPC name, "你" (player speaking), or
   *  undefined for a pure narration/environment entry. Drives shot selection. */
  entrySpeaker?: string;
};

// ──────────────────────────────────────────────────────────────────────
//  Paradigm D — Writer single-pass streaming plan extensions.
//
//  In paradigm D the Writer streams one tagged response: <plan> → <story>
//  → <choices>. WriterScenePlan is the parsed <plan> segment: the existing
//  WriterPlan skeleton PLUS per-character scene intents (and story bible on
//  first scene), handed to the downstream media translators the instant
//  </plan> closes.
// ──────────────────────────────────────────────────────────────────────

/** Per-scene performance intent for one character, authored by the Writer in
 *  the <plan> segment. Ephemeral (this scene only) — distinct from the
 *  persistent CharacterPersona card. Feeds downstream media translators. */
export type CharacterIntent = {
  name: string;
  /** 本幕情绪基调。 */
  mood?: string;
  /** 本幕动机 / 目的。 */
  motivation?: string;
  /** 本幕说话基调（指导对白质感 + TTS lineDelivery）。 */
  speakingTone?: string;
};

/** Parsed <plan> tag: the existing WriterPlan shape plus per-character scene
 *  intents and optional story bible (first scene only). The optional extension
 *  keeps any degraded / minimal plan valid — downstream consumers see a
 *  WriterPlan superset. */
export type WriterScenePlan = WriterPlan & {
  /** 各角色本幕表现意图，供 </plan> 闭合时分发下游媒体翻译官。 */
  characterIntents?: CharacterIntent[];
  /** 故事圣经（仅开局产出）——稳定区字段。后续场景 plan 不含此字段。 */
  storyBible?: {
    logline: string;
    genreTags: string;
    protagonist: string;
    castNotes?: string;
  };
};

// ──────────────────────────────────────────────────────────────────────
//  Characters & voices (TTS)
// ──────────────────────────────────────────────────────────────────────

export type CharacterVoice =
  | {
      provider: "xiaomi";
      /** Xiaomi MiMo design output stored as reference audio for later clones. */
      referenceAudioBase64: string;
      mimeType: string;
    }
  | {
      provider: "stepfun";
      /** StepFun preset voice ID (e.g. "cixingnansheng"). Selected by keyword
       *  matching against the LLM-written voiceDescription — no network call
       *  on provision (StepFun has no voicedesign endpoint), so this carries
       *  only the picked preset, not a clip. */
      voiceId: string;
      /** TTS model used at synth time (step-tts-mini / step-tts-2 / stepaudio-2.5-tts). */
      model: string;
      mimeType: string;
    };

// ──────────────────────────────────────────────────────────────────────
//  CharacterPersona — narrative / story dimension of a Character.
//  Merged into Character via intersection (all optional). Filled primarily
//  by the Writer's <plan> 思维链 (paradigm D); the CharacterDesigner then
//  realizes it into visual + voice cards. Absent on legacy sessions →
//  callers degrade to "name only". SENTINEL append-only: adding persona
//  only appends bytes to the stable prompt prefix — never reorders.
// ──────────────────────────────────────────────────────────────────────

export type CharacterPersona = {
  /** 背景 / 身份 / 核心设定。 */
  persona?: string;
  /** 性格标签，如 ["傲娇", "腹黑", "重情义"]。 */
  personalityTraits?: string[];
  /** 说话风格 / 口头禅 — 对白质感的关键。 */
  speakingStyle?: string;
  /** 2-3 条代表性对白，作为 few-shot 锚定语气。 */
  sampleDialogue?: string[];
  /** 与玩家("你")的关系 / 态度。 */
  relationshipToPlayer?: string;
  /** 隐藏信息 / 伏笔，可驱动后续反转（默认不外显）。 */
  secrets?: string[];
};

export type Character = {
  name: string;
  /**
   * 中文 voice-acting direction card. Must begin with explicit gender, then
   * age / timbre / personality / speed / accent. Fed to Xiaomi MiMo's
   * voicedesign endpoint when the voice is first provisioned.
   */
  voiceDescription: string;
  /**
   * English appearance card — comma-separated visual attributes following
   * Runware/FLUX prompt-engineering convention. Fed to the Painter as a
   * character archetype anchor so the same face/outfit/style stays consistent
   * across every scene this character appears in.
   */
  visualDescription?: string;
  /**
   * Runware UUID for the base portrait. Generated by the CharacterDesigner
   * once, reused as a `referenceImages` entry on every subsequent scene the
   * character appears in. UUID is the cheapest reference form for Runware.
   */
  basePortraitUuid?: string;
  /**
   * Public CDN URL for the base portrait. Same image as `basePortraitUuid`;
   * kept around for the client (if it ever wants to render character cards)
   * and as a fallback reference form for `referenceImages` when UUID is absent.
   */
  basePortraitUrl?: string;
  /** Xiaomi MiMo voice reference audio. */
  voice?: CharacterVoice;
  /** StepFun preset voice id (e.g. "cixingnansheng"). Only present on
   *  characters designed while the server ran StepFun, OR on prebaked
   *  homepage cards enriched with a StepFun voice id. Lets the client send a
   *  lightweight beat-audio request (no ~220KB Xiaomi reference audio) when the
   *  server runs StepFun, and lets the server normalize an off-provider voice
   *  without a fresh provision. Validated against the catalog at synth time. */
  stepfunVoiceId?: string;
} & CharacterPersona;

/** A single beat's synthesized audio, attached to the response. */
export type BeatAudio = {
  base64: string;
  mime: string;
};

// ──────────────────────────────────────────────────────────────────────
//  StoryState — the persistent "story bible" + evolving narrative memory.
//
//  Created once at session start by the Architect agent (rich opening
//  planning), then carried across every scene and incrementally updated by
//  the Writer. This is the single throughline that keeps tone, cast, and
//  stakes coherent across scene cuts — without it each Writer call would
//  re-derive the whole arc from a flat beat log and drift.
//
//  Split into STABLE fields (set by the Architect, rarely change) and
//  VOLATILE fields (rewritten each scene via StoryStatePatch).
// ──────────────────────────────────────────────────────────────────────

export type StoryState = {
  // ── Stable (Architect-authored; persists unless deliberately revised) ──
  /** One-line central dramatic question / 主线钩子. */
  logline: string;
  /** Genre + tone tags anchoring the 爽点 framework, e.g. "甜宠 / 校园 / 慢热治愈". */
  genreTags: string;
  /** Second-person protagonist card: who 你 are, the immediate situation, the
   *  core want, and a flaw/secret. The audience proxy — never rendered. */
  protagonist: string;
  /** Key supporting cast and their relationship/tension with 你 (one per line). */
  castNotes?: string;

  // ── Volatile (rewritten each scene by the Writer's StoryStatePatch) ──
  /** Rolling, compressed synopsis of what has happened so far (~3-5 句). */
  synopsis: string;
  /** Unresolved hooks / mysteries / questions still owed to the player. */
  openThreads?: string[];
  /** Current relationship/emotion state per character, e.g.
   *  "夏海：好感升温，刚向你告白了一半". */
  relationships?: string[];
  /** Where the story is heading next — the conflict/reversal/suspense the
   *  next scene should drive toward. Seeds the next scene's hook. */
  nextHook?: string;
};

/** The volatile subset the Writer rewrites after each scene. Stable fields
 *  (logline/genreTags/protagonist/castNotes) are preserved by the merge. */
export type StoryStatePatch = {
  synopsis?: string;
  openThreads?: string[];
  relationships?: string[];
  nextHook?: string;
};

// ──────────────────────────────────────────────────────────────────────
//  WorldBook — lightweight lore injection system.
//
//  Entries with position "constant" are always injected into the stable
//  prompt prefix. Entries with position "triggered" are scanned against
//  recent beat text and injected into the dynamic suffix when keywords
//  match. Priority controls ordering when multiple entries fire.
// ──────────────────────────────────────────────────────────────────────

export type WorldBookEntry = {
  id: string;
  /** Keywords that trigger this entry's injection (for triggered entries). */
  keys: string[];
  /** The lore content to inject into the prompt. */
  content: string;
  /** "constant" = always injected (stable prefix); "triggered" = keyword-matched (dynamic suffix). */
  position: "constant" | "triggered";
  /** Higher priority entries are injected first. Defaults to 0. */
  priority?: number;
};

export type WorldBook = {
  id: string;
  name: string;
  entries: WorldBookEntry[];
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
  /** Character registry — accumulates across scenes; voices + portraits persist for reuse. */
  characters: Character[];
  /**
   * Persistent story bible + evolving narrative memory. Set at session start
   * by the Architect, carried by the client across every /api/scene call, and
   * updated by the Writer each scene. Optional for back-compat with any
   * session payload created before this field existed.
   */
  storyState?: StoryState;
  /**
   * Optional user-uploaded style reference image (data URL — `data:image/...;base64,...`).
   * When set, the Painter prepends it to `referenceImages` on every scene so the
   * uploaded image anchors painting style (brush, color, mood) across the whole
   * session. Resized client-side before upload (~512px max dim) to keep session
   * payload small for /api/scene round-trips.
   */
  styleReferenceImage?: string;
  /**
   * Session-wide image orientation, locked at session start from the client's
   * device + orientation and carried on every /api/scene call so all scenes
   * share one aspect ratio. Absent → "landscape" (back-compat).
   */
  orientation?: Orientation;
  /**
   * Optional player-chosen display name. When set, NPC dialogue will address
   * the player by this name instead of the generic "你". Stored client-side
   * only (localStorage); never persisted server-side.
   */
  playerName?: string;
  /**
   * Active UI locale when the session was started, in BCP-47 form (e.g.
   * "zh-CN", "en", "ja"). The engine appends a single-line language directive
   * to the Architect / Writer user messages so AI-generated dialogue, beats,
   * and narration are produced in this language. Absent → "zh-CN" for
   * back-compat with sessions created before this field existed.
   */
  language?: string;
  /**
   * Optional world books for lore injection. "constant" entries are always in
   * the prompt; "triggered" entries inject when keywords match recent text.
   */
  worldBooks?: WorldBook[];
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

/**
 * Wire protocol used to talk to a model provider. Which values are valid
 * depends on the model role — each ai-client adapter accepts its own subset
 * and falls back to a sensible default for anything else:
 *
 *   openai_compatible  text / vision / image  — OpenAI Chat Completions +
 *                      `/images/generations` (self-implemented fetch; the
 *                      default for text/vision when unset)
 *   openai             image only             — OpenAI gpt-image via the
 *                      official OpenAI SDK, unlocks reference-image editing
 *                      (for text/vision use openai_compatible, which already
 *                      speaks OpenAI's format)
 *   runware            image only             — Runware task-array protocol
 *                      (self-implemented; the default for runware.ai URLs)
 */
export type ProviderProtocol =
  | "openai_compatible"
  | "openai"
  | "runware";

export type ProviderConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
  /**
   * Wire protocol. When unset, callers apply a role-specific default:
   * text/vision → "openai_compatible"; image → inferred from baseUrl
   * (runware.ai → "runware", otherwise "openai_compatible") so existing
   * deployments keep working without setting *_PROVIDER.
   */
  provider?: ProviderProtocol;
};

export type TtsConfig = {
  baseUrl: string;
  apiKey: string;
  /** Base model name; adapter derives "-voicedesign" / "-voiceclone" suffixes. */
  speechModel: string;
};

/** Which TTS provider the server is configured for (inferred from TtsConfig's
 *  base URL by lib/tts-client's isStepfun). Exposed to the client via the
 *  /api/tts-provider route so the play page can send only the voice fields
 *  the server actually needs — e.g. skip the ~220KB Xiaomi reference audio
 *  when the server runs StepFun (saving Fast Origin Transfer bandwidth).
 *  `null` means no server-side TTS (silent). BYO client TTS takes precedence
 *  over this signal. */
export type TtsProvider = "stepfun" | "xiaomi" | null;

// /api/tts-provider — lightweight GET returning the server's TTS provider so
// the client can shape beat-audio request bodies accordingly (see fetchBeatAudio
// in app/play/page.tsx). Response is a few dozen bytes; runs once per session.
export type TtsProviderResponse = {
  provider: TtsProvider;
};

export type EngineConfig = {
  text: ProviderConfig;
  image: ProviderConfig;
  vision: ProviderConfig;
  /** Optional — when missing the game runs silently (no TTS). */
  tts?: TtsConfig;
  /** When true the renderer returns a placeholder PNG instead of calling the image API. */
  mockImage?: boolean;
  /**
   * Per-attempt hard timeout (ms) for image-generation requests. Unset → no
   * client-side timeout (only the provider's own gateway limits apply, e.g.
   * Runware kills tasks at ~55s with a 504).
   */
  imageTimeoutMs?: number;
  /**
   * Painter scene-paint hedge threshold (ms). When the Tier-A (referenced)
   * paint hasn't completed after this long, a second identical request races
   * the first and the earlier result wins. Unset/0 → hedging disabled.
   * Derived from healthy-day Runware p95 (~14s); recommended 15000.
   */
  imageHedgeMs?: number;
};

// ──────────────────────────────────────────────────────────────────────
//  API contracts
// ──────────────────────────────────────────────────────────────────────

/**
 * BYOK (Bring Your Own Key) LLM credentials carried in request bodies.
 * Per-role: text/image/vision can be independently configured. Keys never
 * persist or log server-side — they only pass through request→config build
 * (see lib/config.ts buildByoEngineConfig). vision typically mirrors text.
 */
export type ByoLlmKeys = {
  text?: { provider: string; apiKey: string; baseUrl?: string; model?: string };
  image?: { provider: string; apiKey: string; baseUrl?: string; model?: string };
  vision?: { provider: string; apiKey: string; baseUrl?: string; model?: string };
};

export type StartRequest = {
  worldSetting: string;
  styleGuide: string;
  /** Optional user-uploaded style reference image — see Session.styleReferenceImage. */
  styleReferenceImage?: string;
  /**
   * When true the client supplied its own Xiaomi TTS key and will provision +
   * synth voices in the browser (key never touches our server). The route then
   * drops `config.tts` so the engine skips all server-side TTS work.
   */
  clientTts?: boolean;
  /**
   * Device orientation chosen at session start. "portrait" makes the engine
   * paint 9:16 vertical scene images (mobile, held upright); "landscape"
   * (default) keeps 16:9 widescreen. Locked for the whole session.
   */
  orientation?: Orientation;
  /** Optional player display name — see Session.playerName. */
  playerName?: string;
  /** Active UI locale — see Session.language. Drives the engine's language
   *  directive so AI output is generated in the player's chosen language. */
  language?: string;
  /**
   * BYOK: user-provided LLM keys. When present, server uses these to construct
   * EngineConfig instead of reading from env. Per-role: text/image/vision can
   * be independently configured. Keys never persist or log — they only pass
   * through request→config construction.
   */
  byo?: ByoLlmKeys;
};

// /api/parse-style-image — vision LLM extracts a textual painting-style
// prompt from a user-uploaded reference image. The same base64 is echoed
// back so the client can later pass it through to /api/start.
export type ParseStyleImageRequest = {
  /** Data URL: `data:image/...;base64,...`. */
  imageDataUrl: string;
};

export type ParseStyleImageResponse = {
  /** English style prompt suitable as a styleGuide (FLUX-friendly attributes). */
  stylePrompt: string;
};

export type StartResponse = {
  sessionId: string;
  scene: Scene;
  /** Public CDN URL (or data URI in MOCK_IMAGE mode) for the rendered scene background. */
  imageUrl: string;
  /** Character registry with voice references + visual cards provisioned. */
  characters: Character[];
  /** Story bible created by the Architect + updated by the opening scene's
   *  Writer. The client persists this into the session for later /api/scene calls. */
  storyState: StoryState;
};

// /api/scene — generates the next Scene, given session whose latest
// history entry has `exit` set. Also used for prefetch speculation
// (frontend synthesizes a speculative exit).
export type SceneRequest = {
  session: Session;
  /** See StartRequest.clientTts — drops server-side TTS for BYO-key clients. */
  clientTts?: boolean;
  /** See StartRequest.byo — BYOK LLM keys. */
  byo?: ByoLlmKeys;
};

export type SceneResponse = {
  scene: Scene;
  /** Public CDN URL (or data URI in MOCK_IMAGE mode) for the rendered scene background. */
  imageUrl: string;
  characters: Character[];
  /** Story bible after this scene's Writer applied its update. The client
   *  must persist this back into the session so the throughline survives the
   *  next scene cut. */
  storyState: StoryState;
};

// /api/beat-audio — lazily synthesize one beat's voice. Client fires this
// per beat after a scene loads; server has a per-call timeout so MiMo
// tail-latency cannot block the UI. A null audio response means "play silent."
export type BeatAudioRequest = {
  beat: {
    id: string;
    line: string;
    lineDelivery?: string;
  };
  /** The speaker's already-provisioned voice. Optional now — when the server
   *  runs a DIFFERENT provider than `voice.provider` (e.g. the client holds a
   *  Xiaomi voice from a prebaked card but the server runs StepFun), the
   *  client may omit `voice` and send `voiceDescription` + `stepfunVoiceId`
   *  instead to save the ~220KB reference-audio transfer. The server then
   *  re-provisions against its own provider before synthesizing. */
  voice?: CharacterVoice;
  /** Voice-design card (中文). Used by the server to re-provision when
   *  `voice` is absent or its provider doesn't match the server's TTS. */
  voiceDescription?: string;
  /** Speaker name — used as the StepFun provision salt for archetype spreading
   *  when the server falls back to pickStepfunVoiceId. */
  characterName?: string;
  /** Pre-selected StepFun preset id (from a live CharacterDesigner pick or a
   *  prebaked card). Honored directly when the server runs StepFun, skipping
   *  both the keyword scorer and a network provision. */
  stepfunVoiceId?: string;
};

export type BeatAudioResponse = {
  audio: BeatAudio | null;
};

// /api/vision — interprets a background click on the current image and
// classifies whether it should insert a beat (in-scene exploration) or
// trigger a scene change.
export type VisionRequest = {
  session: Session;
  /**
   * Raw PNG base64 (no `data:` prefix) of the scene image WITH the player's
   * click marker already drawn on it by the browser's Canvas 2D. The server
   * forwards this straight to the vision LLM as an OpenAI-compatible
   * image_url.
   *
   * Annotation lives client-side so the engine has no Node-native image
   * dependency (sharp doesn't run on Cloudflare Workers) and we save a
   * server-side image re-fetch per click.
   */
  annotatedImageBase64: string;
  /** See StartRequest.byo — BYOK LLM keys. */
  byo?: ByoLlmKeys;
};

export type VisionResponse = {
  intent: ClickIntent;
  classify: VisionClassify;
};

// /api/classify-freeform — classifies a player's freeform text input
// into one of three paths: match an existing choice, insert a beat
// in-scene, or trigger a scene change.
export type FreeformClassifyRequest = {
  session: Session;
  freeformText: string;
  /** See StartRequest.byo — BYOK LLM keys. */
  byo?: ByoLlmKeys;
};

export type FreeformClassify = "insert-beat" | "change-scene";

export type FreeformClassifyResponse = {
  classify: FreeformClassify;
  freeformAction: string;
};

// /api/insert-beat — generates a single transient beat in response to
// a freeform vision action. Does NOT regenerate the image.
export type InsertBeatRequest = {
  session: Session;
  freeformAction: string;
  /** See StartRequest.clientTts — drops server-side TTS for BYO-key clients. */
  clientTts?: boolean;
  /** See StartRequest.byo — BYOK LLM keys. */
  byo?: ByoLlmKeys;
};

/** Partial beat fields produced by the insert-beat director. */
export type InsertBeatPartial = {
  narration?: string;
  speaker?: string;
  line?: string;
  lineDelivery?: string;
};

/** Multi-beat response: 1-3 beats. */
export type InsertBeatMulti = {
  beats: InsertBeatPartial[];
};

export type InsertBeatResponse = {
  partial: InsertBeatPartial;
  /** Additional beats beyond the first (for richer insert-beat interactions). */
  extraBeats?: InsertBeatPartial[];
  characters: Character[];
};

// ──────────────────────────────────────────────────────────────────────
//  Paradigm D — streaming primitives (chatStream / StreamRouter / SSE)
//
//  Output-side counterpart to prompt caching's input-side stable prefix
//  (the two are orthogonal). chatStream yields incremental text + an
//  end-of-stream usage promise. The StreamRouter slices the Writer's
//  tagged stream into plan/story/choices and dispatches downstream. API
//  routes serialize assembled fragments as SSE events for progressive
//  client playback.
// ──────────────────────────────────────────────────────────────────────

/** Token usage stats returned at stream end. Kept SDK-agnostic so the type
 *  file doesn't depend on any specific provider package. */
export type ChatStreamUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number };
};

/** Return shape of the streaming chat primitive (ai-client `chatStream`).
 *  `textStream` yields incremental chunks; `usage` resolves at stream end
 *  so `summarizeSdkUsage` cache accounting works unchanged. */
export type ChatStreamResult = {
  textStream: AsyncIterable<string>;
  usage: Promise<ChatStreamUsage | undefined>;
};

/** Callbacks the StreamRouter fires as it slices the Writer's tagged stream.
 *  All optional so a caller can subscribe to a subset. */
export type StreamRouterHandlers = {
  /** `</plan>` closed — dispatch downstream media translators in parallel. */
  onPlan?: (plan: WriterScenePlan) => void;
  /** `<story>` incremental text — push to client for progressive playback. */
  onBeat?: (beatChunk: string) => void;
  /** `</story>` closed — prose finalized, ready for splitting. */
  onStoryComplete?: (rawStory: string) => void;
  /** `</choices>` closed. */
  onChoices?: (choices: BeatChoice[]) => void;
};

/** Aggregate result of routing one Writer stream to completion. `degraded` is
 *  true when tag parsing fell back (missing / misordered / unclosed / timeout),
 *  per the degrade-before-main-path reliability rule. */
export type StreamRouterResult = {
  plan?: WriterScenePlan;
  beats: Beat[];
  choices?: BeatChoice[];
  /** Raw prose content of the <story> segment (not JSON-parsed). The director
   *  feeds this to proseSplitter to produce Beat[]. */
  rawStorySegment?: string;
  degraded: boolean;
};

/** Server → client SSE events for progressive scene playback (paradigm D).
 *  `TDone` is the terminal full-assembly payload — `SceneResponse` for
 *  `/api/scene`, `StartResponse` for `/api/start`. The prefetch path
 *  consumes events to `done` and reassembles a complete response. */
export type SceneStreamEvent<TDone = SceneResponse> =
  | { type: "plan"; plan: WriterScenePlan }
  | { type: "beat"; beat: Beat }
  | { type: "background"; imageUrl: string; sceneKey?: string }
  | { type: "voice"; name: string; voice: CharacterVoice }
  | { type: "choices"; choices: BeatChoice[] }
  | { type: "done"; response: TDone }
  | { type: "error"; message: string; degraded?: boolean };
