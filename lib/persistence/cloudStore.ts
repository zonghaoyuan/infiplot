// Cloud story repository — server-only Supabase persistence for the COMMERCIAL
// build. Mirrors the local repository (lib/persistence/localStore.ts) so the
// reconcile engine (lib/persistence/cloudSync.ts) can treat the cloud as a layer
// over the local store.
//
// When AUTH_ENABLED is false (the open-source build) every method short-circuits
// to a safe value on its first line and never touches Supabase.
//
// Isolation is by RLS only: the SSR client carries the user's anon key + cookie,
// and every public.stories policy is keyed on auth.uid() = user_id — so no
// service_role key is used and no query needs a manual user filter for safety
// (the explicit .eq("user_id") below is belt-and-suspenders + index alignment).
//
// Optimistic concurrency:
//  - cloudSaveStory upserts via the upsert_story_if_newer RPC (needs INSERT-if-
//    absent + a conditional overwrite, which PostgREST upsert can't express).
//  - cloudSoftDeleteStory is UPDATE-only (a story never pushed has no cloud row
//    to tombstone), so it expresses the same rev→updatedAt guard with a
//    PostgREST .or() filter — no RPC needed.

import "server-only";

import type { Session } from "@infiplot/types";
import { coerceOrientation } from "@infiplot/types";
import { AUTH_ENABLED } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";
import type { SlimStoryBlob, StoryMeta, StorySyncMeta, StorySyncEnvelope } from "./types";
import { coerceEpoch } from "./types";

/** One row of public.stories (snake_case columns ↔ SlimStoryBlob + sync meta). */
type StoryRow = {
  id: string;
  user_id: string;
  world_setting: string;
  style_guide: string;
  orientation: string;
  scene_count: number;
  rev: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  session_jsonb: Session;
};

/** Resolve the authenticated user's id (= auth.uid()) from the SSR session, or
 *  null when unauthenticated. Repository-level (no NextResponse) so callers stay
 *  framework-agnostic; methods short-circuit to safe values on null. */
async function currentUserId(): Promise<string | null> {
  try {
    const supabase = await createClient();
    const claims = await supabase.auth.getClaims();
    return claims.data?.claims?.sub ?? null;
  } catch {
    return null;
  }
}

function rowToBlob(row: StoryRow): SlimStoryBlob {
  return {
    id: row.id,
    worldSetting: row.world_setting ?? "",
    styleGuide: row.style_guide ?? "",
    orientation: coerceOrientation(row.orientation),
    sceneCount: row.scene_count ?? 0,
    rev: row.rev ?? 1,
    session: row.session_jsonb,
  };
}

function rowToMeta(row: StoryRow): StoryMeta {
  return {
    id: row.id,
    worldSetting: row.world_setting ?? "",
    styleGuide: row.style_guide ?? "",
    orientation: coerceOrientation(row.orientation),
    sceneCount: row.scene_count ?? 0,
    // coerceEpoch (not a raw new Date().getTime()) guards against an unparseable
    // timestamptz string yielding NaN, which would render as "Invalid Date" and
    // crash any client doing `new Date(updatedAt).getTime()`. Ordering is done
    // SQL-side (.order("updated_at") in cloudListStories), so these JS values
    // don't drive the sort. Same shared helper the local store uses.
    createdAt: coerceEpoch(row.created_at, 0),
    updatedAt: coerceEpoch(row.updated_at, 0),
  };
}

/** Full-blob projection for the sync layer: blob + (updatedAt, deletedAt) so
 *  reconcile has the LWW-ordering fields. Carries tombstones (deletedAt may be
 *  non-null) — a pulled cloud tombstone mirrors a remote soft-delete locally. */
function rowToEnvelope(row: StoryRow): StorySyncEnvelope {
  return {
    id: row.id,
    worldSetting: row.world_setting ?? "",
    styleGuide: row.style_guide ?? "",
    orientation: coerceOrientation(row.orientation),
    sceneCount: row.scene_count ?? 0,
    rev: row.rev ?? 1,
    session: row.session_jsonb,
    updatedAt: coerceEpoch(row.updated_at, 0),
    deletedAt: row.deleted_at ? coerceEpoch(row.deleted_at, 0) : null,
  };
}

// ── Public API ──────────────────────────────────────────────────────────────
//
// CONTRACT NOTE: the sync methods (manifest/pull/save/softDelete) speak the
// StorySyncEnvelope/StorySyncMeta shapes — the convergence envelope the
// reconcile engine maps StoryRecord ↔ envelope in one place. The legacy
// cloudLoadStory/cloudListStories (leaner SlimStoryBlob/StoryMeta) are retained
// for non-sync callers; reconcile does not use them.

/** Upsert one story for the current user via the optimistic-concurrency RPC.
 *  Returns `{ stored, won }`:
 *   - won=true  → our version is now the cloud row (fresh insert, winning
 *     update, or already-equal no-op);
 *   - won=false → a NEWER cloud row existed and was preserved; `stored` is that
 *     newer row so the caller can reconcile by pulling it back.
 *  Auth off / unauthenticated / write failure → `{ stored: null, won: false }`. */
export async function cloudSaveStory(
  env: StorySyncEnvelope,
): Promise<{ stored: StorySyncEnvelope | null; won: boolean }> {
  if (!AUTH_ENABLED) return { stored: null, won: false };
  const userId = await currentUserId();
  if (!userId) return { stored: null, won: false };
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("upsert_story_if_newer", {
      p_id: env.id,
      p_world: env.worldSetting ?? "",
      p_style: env.styleGuide ?? "",
      p_orientation: coerceOrientation(env.orientation),
      p_scene_count: env.sceneCount ?? 0,
      p_rev: env.rev ?? 1,
      p_updated_at: new Date(env.updatedAt).toISOString(),
      p_deleted_at: env.deletedAt ? new Date(env.deletedAt).toISOString() : null,
      p_session: env.session,
    });
    if (error || !data) return { stored: null, won: false };
    // The RPC `returns public.stories` (a single composite); supabase-js may
    // hand it back as the object or wrapped in an array — normalize both.
    const row = (Array.isArray(data) ? data[0] : data) as StoryRow | undefined;
    if (!row) return { stored: null, won: false };
    const stored = rowToEnvelope(row);
    // We won iff the stored row IS our version. A stale write returns the newer
    // cloud row, whose (rev, updatedAt) differ from what we sent → won=false.
    const won = stored.rev === env.rev && stored.updatedAt === env.updatedAt;
    return { stored, won };
  } catch {
    return { stored: null, won: false };
  }
}

/** Load one story's slim blob for the current user. Tombstoned / absent / not
 *  owned (RLS) → null. Retained for non-sync callers (reconcile uses
 *  cloudPullBlobs, which carries tombstones + sync-ordering fields). */
export async function cloudLoadStory(id: string): Promise<SlimStoryBlob | null> {
  if (!AUTH_ENABLED) return null;
  const userId = await currentUserId();
  if (!userId) return null;
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("stories")
      .select()
      .eq("id", id)
      .eq("user_id", userId)
      .is("deleted_at", null)
      .maybeSingle();
    if (error || !data) return null;
    return rowToBlob(data as StoryRow);
  } catch {
    return null;
  }
}

/** List the current user's non-tombstoned stories as lightweight metadata,
 *  newest first (mirrors localStore.listStories). Auth off / unauth → []. */
export async function cloudListStories(): Promise<StoryMeta[]> {
  if (!AUTH_ENABLED) return [];
  const userId = await currentUserId();
  if (!userId) return [];
  try {
    const supabase = await createClient();
    // Explicit column list (not select()) so the list query doesn't pull the
    // bulky session_jsonb — rowToMeta only needs the denormalized metadata.
    const { data, error } = await supabase
      .from("stories")
      .select(
        "id, world_setting, style_guide, orientation, scene_count, created_at, updated_at",
      )
      .eq("user_id", userId)
      .is("deleted_at", null)
      .order("updated_at", { ascending: false });
    if (error || !data) return [];
    return (data as StoryRow[]).map(rowToMeta);
  } catch {
    return [];
  }
}

/** Reconcile diff basis: ALL the current user's rows (INCLUDING tombstones),
 *  projected to lightweight {id, rev, updatedAt, deletedAt}. Explicit column
 *  list so it never pulls session_jsonb. Auth off / unauth → []. */
export async function cloudStoryManifest(): Promise<StorySyncMeta[]> {
  if (!AUTH_ENABLED) return [];
  const userId = await currentUserId();
  if (!userId) return [];
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("stories")
      .select("id, rev, updated_at, deleted_at")
      .eq("user_id", userId);
    if (error || !data) return [];
    return (data as StoryRow[]).map((row) => ({
      id: row.id,
      rev: row.rev ?? 1,
      updatedAt: coerceEpoch(row.updated_at, 0),
      deletedAt: row.deleted_at ? coerceEpoch(row.deleted_at, 0) : null,
    }));
  } catch {
    return [];
  }
}

/** Pull full envelopes for the given ids (INCLUDING tombstones — a pulled cloud
 *  tombstone mirrors a remote soft-delete locally). Empty ids / auth off /
 *  unauth → []. */
export async function cloudPullBlobs(
  ids: string[],
): Promise<StorySyncEnvelope[]> {
  if (!AUTH_ENABLED) return [];
  if (!ids.length) return [];
  const userId = await currentUserId();
  if (!userId) return [];
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("stories")
      .select()
      .eq("user_id", userId)
      .in("id", ids);
    if (error || !data) return [];
    return (data as StoryRow[]).map(rowToEnvelope);
  } catch {
    return [];
  }
}

/** Propagate a soft-delete (tombstone) for the current user, with the same
 *  optimistic-concurrency guard as the save RPC expressed as a PostgREST .or()
 *  filter: only stamp when the incoming version is newer (rev higher, or rev
 *  tie with a later updatedAt). UPDATE-only — a story never pushed has no cloud
 *  row and needs no tombstone (returns false, which the caller treats as
 *  "nothing to delete remotely"). Auth off / unauth / not-newer / absent →
 *  false. */
export async function cloudSoftDeleteStory(
  id: string,
  rev: number,
  deletedAt: number,
): Promise<boolean> {
  if (!AUTH_ENABLED) return false;
  const userId = await currentUserId();
  if (!userId) return false;
  try {
    const supabase = await createClient();
    const deletedIso = new Date(deletedAt).toISOString();
    const { data, error } = await supabase
      .from("stories")
      .update({ deleted_at: deletedIso, updated_at: deletedIso, rev })
      .eq("user_id", userId)
      .eq("id", id)
      // Quote the timestamptz value so PostgREST parses the colons/dots in the
      // ISO string as a literal, not filter syntax.
      .or(`rev.lt.${rev},and(rev.eq.${rev},updated_at.lt."${deletedIso}")`)
      .select("id");
    if (error || !data || data.length === 0) return false;
    return true;
  } catch {
    return false;
  }
}
