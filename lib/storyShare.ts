import type {
  Beat,
  Character,
  Orientation,
  Scene,
  SceneExit,
  Session,
  StoryState,
} from "@infiplot/types";

export const STORY_SHARE_STORAGE_KEY = "infiplot:story-import";

export type StoryShareDoc = {
  v: 1 | 2;
  kind: "infiplot-story";
  exportedAt: number;
  current: {
    sceneIndex: number;
    beatId?: string;
  };
  session: Session;
  /** Pre-synthesized per-beat audio (data:audio/...;base64,...). Keyed by
   *  `${sceneId}:${beatId}`. v2+ only — older files just have no audio and
   *  play silent on replay. Embedding keeps the share file self-contained
   *  so a friend can hear the recorded voices without their own TTS key. */
  audioByBeatId?: Record<string, string>;
};

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isOrientation(value: unknown): value is Orientation {
  return value === "portrait" || value === "landscape";
}

function isStoryState(value: unknown): value is StoryState {
  if (!isRecord(value)) return false;
  return (
    typeof value.logline === "string" &&
    typeof value.genreTags === "string" &&
    typeof value.protagonist === "string" &&
    typeof value.synopsis === "string" &&
    (value.castNotes === undefined || typeof value.castNotes === "string") &&
    (value.openThreads === undefined || isStringArray(value.openThreads)) &&
    (value.relationships === undefined || isStringArray(value.relationships)) &&
    (value.nextHook === undefined || typeof value.nextHook === "string")
  );
}

function isBeat(value: unknown): value is Beat {
  if (!isRecord(value) || typeof value.id !== "string") return false;
  if (value.narration !== undefined && typeof value.narration !== "string") return false;
  if (value.speaker !== undefined && typeof value.speaker !== "string") return false;
  if (value.line !== undefined && typeof value.line !== "string") return false;
  if (value.lineDelivery !== undefined && typeof value.lineDelivery !== "string") return false;
  if (value.activeCharacters !== undefined) {
    if (!Array.isArray(value.activeCharacters)) return false;
    for (const c of value.activeCharacters) {
      if (!isRecord(c) || typeof c.name !== "string") return false;
      if (c.pose !== undefined && typeof c.pose !== "string") return false;
    }
  }

  const next = value.next;
  if (!isRecord(next) || typeof next.type !== "string") return false;
  if (next.type === "continue") return typeof next.nextBeatId === "string";
  if (next.type !== "choice" || !Array.isArray(next.choices)) return false;
  return next.choices.every((choice) => {
    if (!isRecord(choice) || typeof choice.id !== "string" || typeof choice.label !== "string") {
      return false;
    }
    const effect = choice.effect;
    if (!isRecord(effect) || typeof effect.kind !== "string") return false;
    if (effect.kind === "advance-beat") return typeof effect.targetBeatId === "string";
    if (effect.kind === "change-scene") return typeof effect.nextSceneSeed === "string";
    return false;
  });
}

function isScene(value: unknown): value is Scene {
  if (!isRecord(value)) return false;
  if (typeof value.id !== "string" || typeof value.scenePrompt !== "string") return false;
  if (!Array.isArray(value.beats) || value.beats.length === 0) return false;
  if (!value.beats.every(isBeat)) return false;
  if (typeof value.entryBeatId !== "string") return false;
  if (!value.beats.some((beat) => beat.id === value.entryBeatId)) return false;
  if (value.imageUrl !== undefined && typeof value.imageUrl !== "string") return false;
  if (value.imageUrl === "") return false;
  if (value.sceneKey !== undefined && typeof value.sceneKey !== "string") return false;
  if (value.imageUuid !== undefined && typeof value.imageUuid !== "string") return false;
  if (value.orientation !== undefined && !isOrientation(value.orientation)) return false;
  return true;
}

function isSceneExit(value: unknown): value is SceneExit {
  if (!isRecord(value) || typeof value.kind !== "string") return false;
  if (value.kind === "freeform") return typeof value.action === "string";
  return (
    value.kind === "choice" &&
    typeof value.choiceId === "string" &&
    typeof value.label === "string" &&
    typeof value.nextSceneSeed === "string"
  );
}

function isCharacter(value: unknown): value is Character {
  if (!isRecord(value)) return false;
  return (
    typeof value.name === "string" &&
    typeof value.voiceDescription === "string" &&
    (value.visualDescription === undefined || typeof value.visualDescription === "string") &&
    (value.basePortraitUuid === undefined || typeof value.basePortraitUuid === "string") &&
    (value.basePortraitUrl === undefined || typeof value.basePortraitUrl === "string")
  );
}

function stripCharacterVoices(characters: Character[]): Character[] {
  return characters.map((character) => {
    const { voice: _voice, ...rest } = character;
    return rest;
  });
}

function sanitizeSessionForShare(session: Session): Session {
  return {
    ...session,
    characters: stripCharacterVoices(session.characters),
  };
}

export function createStoryShareDoc(
  session: Session,
  current: { sceneIndex: number; beatId?: string },
  audioByBeatId?: Record<string, string>,
): StoryShareDoc {
  const hasAudio = !!audioByBeatId && Object.keys(audioByBeatId).length > 0;
  return {
    v: hasAudio ? 2 : 1,
    kind: "infiplot-story",
    exportedAt: Date.now(),
    current,
    session: sanitizeSessionForShare(session),
    ...(hasAudio ? { audioByBeatId } : {}),
  };
}

export function storyShareFilename(doc: StoryShareDoc): string {
  return `infiplot-story-${doc.exportedAt.toString(36)}.infiplot`;
}

export function parseStoryShareDoc(value: unknown): StoryShareDoc {
  if (!isRecord(value)) throw new Error("这不是有效的剧情分享文件");
  if (value.kind !== "infiplot-story" || (value.v !== 1 && value.v !== 2)) {
    throw new Error("剧情分享文件格式不支持");
  }
  if (typeof value.exportedAt !== "number" || !Number.isFinite(value.exportedAt)) {
    throw new Error("剧情分享文件缺少导出时间");
  }
  if (
    !isRecord(value.current) ||
    !Number.isInteger(value.current.sceneIndex) ||
    (value.current.sceneIndex as number) < 0
  ) {
    throw new Error("剧情分享文件缺少当前位置");
  }
  if (
    value.current.beatId !== undefined &&
    typeof value.current.beatId !== "string"
  ) {
    throw new Error("剧情分享文件当前位置不合法");
  }

  const session = value.session;
  if (!isRecord(session)) throw new Error("剧情分享文件缺少会话数据");
  if (typeof session.id !== "string" || typeof session.createdAt !== "number") {
    throw new Error("剧情分享文件会话信息不完整");
  }
  if (typeof session.worldSetting !== "string" || typeof session.styleGuide !== "string") {
    throw new Error("剧情分享文件缺少故事设定");
  }
  if (!Array.isArray(session.history) || session.history.length === 0) {
    throw new Error("剧情分享文件没有可载入的剧情");
  }
  if (!Array.isArray(session.characters) || !session.characters.every(isCharacter)) {
    throw new Error("剧情分享文件角色数据不合法");
  }
  if (session.storyState !== undefined && !isStoryState(session.storyState)) {
    throw new Error("剧情分享文件剧情记忆不合法");
  }
  if (session.styleReferenceImage !== undefined && typeof session.styleReferenceImage !== "string") {
    throw new Error("剧情分享文件风格参考图不合法");
  }
  if (session.orientation !== undefined && !isOrientation(session.orientation)) {
    throw new Error("剧情分享文件画面方向不合法");
  }
  if (session.playerName !== undefined && typeof session.playerName !== "string") {
    throw new Error("剧情分享文件玩家名不合法");
  }

  for (const entry of session.history) {
    if (!isRecord(entry) || !isScene(entry.scene)) {
      throw new Error("剧情分享文件场景数据不合法");
    }
    if (!isStringArray(entry.visitedBeatIds) || entry.visitedBeatIds.length === 0) {
      throw new Error("剧情分享文件游玩路径不合法");
    }
    if (entry.exit !== undefined && !isSceneExit(entry.exit)) {
      throw new Error("剧情分享文件场景出口不合法");
    }
    if (entry.storyStateAfter !== undefined && !isStoryState(entry.storyStateAfter)) {
      throw new Error("剧情分享文件剧情记忆快照不合法");
    }
  }

  let audioByBeatId: Record<string, string> | undefined;
  if (value.audioByBeatId !== undefined) {
    if (!isRecord(value.audioByBeatId)) {
      throw new Error("剧情分享文件配音数据不合法");
    }
    const cleaned: Record<string, string> = {};
    for (const [k, v] of Object.entries(value.audioByBeatId)) {
      if (typeof v === "string" && v.startsWith("data:")) cleaned[k] = v;
    }
    if (Object.keys(cleaned).length > 0) audioByBeatId = cleaned;
  }

  const doc = value as StoryShareDoc;
  return {
    ...doc,
    session: sanitizeSessionForShare(doc.session),
    ...(audioByBeatId ? { audioByBeatId } : {}),
  };
}
