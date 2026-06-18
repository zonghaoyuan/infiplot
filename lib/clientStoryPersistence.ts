// Client-side story persistence helpers.
//
// Provides: anonymous user ID management, save/load functions that call
// /api/stories/* and fallback to localStorage when D1 is unavailable.

import type { Session, Scene, Character, StoryState } from "@infiplot/types";
import type { StorySaveInput, SceneSaveInput, CharacterSaveInput, StoryMeta, StoryLoadResult } from "@/lib/db/repositories/storyRepo";

const USER_ID_KEY = "infiplot:userId";
const SAVE_FALLBACK_KEY = "infiplot:savedStories";

// ── Anonymous User ID ────────────────────────────────────────────────────

export function getOrCreateUserId(): string {
  if (typeof window === "undefined") return "";
  try {
    let id = localStorage.getItem(USER_ID_KEY);
    if (!id) {
      id = `anon_${crypto.randomUUID()}`;
      localStorage.setItem(USER_ID_KEY, id);
    }
    return id;
  } catch {
    return `anon_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }
}

// ── Session → Save Input Conversion ─────────────────────────────────────

export function sessionToSaveInput(session: Session): {
  story: StorySaveInput;
  scenes: SceneSaveInput[];
  characters: CharacterSaveInput[];
} {
  const story: StorySaveInput = {
    id: session.id,
    userId: getOrCreateUserId(),
    worldSetting: session.worldSetting,
    styleGuide: session.styleGuide,
    styleReferenceImage: session.styleReferenceImage,
    orientation: (session.orientation as "portrait" | "landscape") ?? "landscape",
    storyState: session.storyState,
    status: "active",
  };

  const scenes: SceneSaveInput[] = (session.history ?? []).map(
    (entry, idx) => ({
      id: entry.scene.id,
      sceneKey: entry.scene.sceneKey,
      sceneSummary: entry.scene.scenePrompt,
      imageUrl: entry.scene.imageUrl ?? "",
      beats: entry.scene.beats,
      sortOrder: idx,
    }),
  );

  const characters: CharacterSaveInput[] = (session.characters ?? []).map(
    (c) => ({
      name: c.name,
      visualDescription: c.visualDescription,
      voiceDescription: c.voiceDescription,
      portrait:
        c.basePortraitUrl || c.basePortraitUuid
          ? { url: c.basePortraitUrl, uuid: c.basePortraitUuid }
          : undefined,
      voice: c.voice,
    }),
  );

  return { story, scenes, characters };
}

// ── Save ─────────────────────────────────────────────────────────────────

export type SaveResult =
  | { ok: true; storyId: string; source: "server" }
  | { ok: true; storyId: string; source: "localStorage" }
  | { ok: false; error: string };

export async function saveStory(session: Session): Promise<SaveResult> {
  // TEMPORARY: localStorage-only mode (D1 disabled until auth integration).
  // Anonymous D1 writes lack rate limiting / quota / ownership checks — an
  // abuse risk on a public registration-less site. Persist locally instead.
  return saveToLocalStorage(session);

  /* DISABLED: D1 server path (will re-enable after auth integration)
  const { story, scenes, characters } = sessionToSaveInput(session);

  try {
    const res = await fetch("/api/stories/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ story, scenes, characters }),
    });

    if (res.ok) {
      const data = (await res.json()) as { storyId: string };
      return { ok: true, storyId: data.storyId, source: "server" };
    }

    // Server failed - fallback to localStorage
    throw new Error(`Server returned ${res.status}`);
  } catch {
    // D1 unavailable or network error - fallback to localStorage
    return saveToLocalStorage(session);
  }
  */
}

function saveToLocalStorage(session: Session): SaveResult {
  try {
    const existing = loadFromLocalStorageAll();
    // Strip bulky fields before persistence to stay within localStorage quota
    // (~5-10MB across ALL keys). Without this, a multi-scene session with
    // several voiced characters serializes to 1-2MB+ (voice.referenceAudioBase64
    // is ~160KB each, styleReferenceImage 30-80KB), which can exceed quota and
    // — worse — block the main thread on the synchronous localStorage write,
    // freezing the subsequent navigation back to the home page. Both fields are
    // reconstructible: voices re-provision on the next /api/scene call, and
    // styleReferenceImage is cosmetic (engine regenerates gracefully without it).
    const slimSession: Session = {
      ...session,
      styleReferenceImage: undefined,
      characters: session.characters.map((c) => ({ ...c, voice: undefined })),
    };
    const entry = {
      id: session.id,
      worldSetting: session.worldSetting,
      styleGuide: session.styleGuide,
      sceneCount: session.history?.length ?? 0,
      savedAt: Date.now(),
      sessionJson: JSON.stringify(slimSession),
    };
    const updated = [entry, ...existing.filter((e) => e.id !== session.id)].slice(0, 20);
    localStorage.setItem(SAVE_FALLBACK_KEY, JSON.stringify(updated));
    return { ok: true, storyId: session.id, source: "localStorage" };
  } catch {
    return { ok: false, error: "无法保存到本地存储" };
  }
}

// ── Load ─────────────────────────────────────────────────────────────────

export async function loadStoryList(): Promise<StoryMeta[]> {
  // TEMPORARY: localStorage-only mode (D1 disabled until auth integration)
  const entries = loadFromLocalStorageAll();
  return entries.map((e) => ({
    id: e.id,
    userId: null, // anonymous
    worldSetting: e.worldSetting,
    styleGuide: e.styleGuide,
    orientation: "landscape", // localStorage doesn't store this, default
    status: "active",
    sceneCount: e.sceneCount,
    createdAt: new Date(e.savedAt),
    updatedAt: new Date(e.savedAt),
  }));

  /* DISABLED: D1 server path (will re-enable after auth integration)
  const userId = getOrCreateUserId();
  try {
    const res = await fetch(`/api/stories/list?userId=${encodeURIComponent(userId)}`);
    if (res.ok) {
      const data = (await res.json()) as { stories: StoryMeta[] };
      return data.stories;
    }
    return [];
  } catch {
    return [];
  }
  */
}

export async function loadStory(storyId: string): Promise<StoryLoadResult | null> {
  // TEMPORARY: localStorage-only mode — unused in current code (play page uses
  // loadFromLocalStorage directly). Returns null to maintain type compatibility.
  // Will be re-enabled when D1 is restored after auth integration.
  return null;

  /* DISABLED: D1 server path
  try {
    const res = await fetch(`/api/stories/${encodeURIComponent(storyId)}`);
    if (res.ok) {
      return (await res.json()) as StoryLoadResult;
    }
    return null;
  } catch {
    return null;
  }
  */
}

export async function deleteStory(storyId: string): Promise<boolean> {
  // TEMPORARY: localStorage-only mode
  try {
    const existing = loadFromLocalStorageAll();
    const updated = existing.filter((e) => e.id !== storyId);
    if (updated.length === existing.length) return false; // not found
    localStorage.setItem(SAVE_FALLBACK_KEY, JSON.stringify(updated));
    return true;
  } catch {
    return false;
  }

  /* DISABLED: D1 server path
  try {
    const res = await fetch(`/api/stories/${encodeURIComponent(storyId)}`, {
      method: "DELETE",
    });
    return res.ok;
  } catch {
    return false;
  }
  */
}

// ── localStorage fallback helpers ────────────────────────────────────────

type LocalStorageEntry = {
  id: string;
  worldSetting: string;
  styleGuide: string;
  sceneCount: number;
  savedAt: number;
  sessionJson: string;
};

function loadFromLocalStorageAll(): LocalStorageEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(SAVE_FALLBACK_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as LocalStorageEntry[];
  } catch {
    return [];
  }
}

export function loadFromLocalStorage(storyId: string): Session | null {
  const entries = loadFromLocalStorageAll();
  const entry = entries.find((e) => e.id === storyId);
  if (!entry) return null;
  try {
    return JSON.parse(entry.sessionJson) as Session;
  } catch {
    return null;
  }
}

// ── StoryLoadResult → Session Conversion ─────────────────────────────────

/**
 * Convert StoryLoadResult (API response from /api/stories/[id]) back to Session
 * shape consumed by app/play/page.tsx.
 */
export function storyLoadResultToSession(result: StoryLoadResult): Session {
  const { story, scenes, characters } = result;

  // Map scenes back to SceneHistoryEntry structure
  const history = scenes.map((s) => {
    const beats = s.beats ?? [];
    // entryBeatId is not persisted in D1 — recover it from the first beat.
    const entryBeatId = beats[0]?.id ?? "";
    return {
      scene: {
        id: s.id,
        sceneKey: s.sceneKey,
        scenePrompt: s.sceneSummary ?? "",
        imageUrl: s.imageUrl,
        beats,
        entryBeatId,
        orientation: s.orientation,
      },
      visitedBeatIds: entryBeatId ? [entryBeatId] : [], // rebuilt as user navigates
      exit: undefined,    // Not persisted in D1
    };
  });

  return {
    id: story.id,
    // createdAt crosses the JSON API boundary as an ISO string, so coerce it
    // back to an epoch the Session shape expects (number).
    createdAt: new Date(story.createdAt).getTime(),
    worldSetting: story.worldSetting,
    styleGuide: story.styleGuide,
    styleReferenceImage: story.styleReferenceImage,
    orientation: story.orientation,
    storyState: story.storyState,
    history,
    characters: characters.map((c) => ({
      name: c.name,
      voiceDescription: c.voiceDescription ?? "",
      visualDescription: c.visualDescription,
      basePortraitUuid: c.portrait?.uuid,
      basePortraitUrl: c.portrait?.url,
      voice: c.voice,
    })),
  };
}
