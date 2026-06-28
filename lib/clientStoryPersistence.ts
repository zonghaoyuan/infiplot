// Client-side story persistence facade.
//
// Thin wrapper over the browser-local IndexedDB store (lib/persistence/localStore).
// Keeps a stable public contract for the UI (play page + "我的剧情" page) while the
// storage medium lives in lib/persistence. All D1 / server code paths were
// removed: open-source persistence is browser-local only; account-based cloud
// sync (Supabase) layers on next phase behind AUTH_ENABLED.

import type { Session } from "@infiplot/types";
import type { StoryMeta } from "@/lib/persistence/types";
import {
  saveStorySession,
  listStories,
  loadStorySession as loadSession,
  softDeleteStory,
} from "@/lib/persistence/localStore";
import { pushOnSave, pushDeletion } from "@/lib/persistence/cloudSync";

export type SaveResult =
  | { ok: true; storyId: string }
  | { ok: false; error: string };

/** Persist the current session locally (upsert by id). Safe to fire-and-forget:
 *  never throws, never blocks gameplay/navigation. */
export async function saveStory(session: Session): Promise<SaveResult> {
  const rec = await saveStorySession(session);
  if (!rec) return { ok: false, error: "无法保存到本地存储" };
  // Fire-and-forget cloud push. pushOnSave short-circuits when auth is off /
  // the user is signed out, so the open-source build sees no behavior change.
  void pushOnSave(rec);
  return { ok: true, storyId: rec.id };
}

/** List saved stories for the "我的剧情" page (newest first). */
export async function loadStoryList(): Promise<StoryMeta[]> {
  return listStories();
}

/** Load the full (slim) Session for a saved story, or null if absent/deleted. */
export async function loadStorySession(id: string): Promise<Session | null> {
  return loadSession(id);
}

/** Delete a saved story (soft-delete). Returns false if not found. */
export async function deleteStory(storyId: string): Promise<boolean> {
  const ok = await softDeleteStory(storyId);
  // Fire-and-forget tombstone propagation. pushDeletion short-circuits when auth
  // is off / signed out, so the open-source build sees no behavior change.
  if (ok) void pushDeletion(storyId);
  return ok;
}
