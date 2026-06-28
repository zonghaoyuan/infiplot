// Local story repository — browser-local persistence built on the IndexedDB
// adapter. Owns CRUD, the local-first sync-reserved metadata, slim/rebuild of
// the Session payload, retention-cap eviction, defensive Date coercion, and
// end-to-end fault tolerance.
//
// Method signatures are expressed in terms of the slim Session blob so the
// future cloud repository (lib/persistence/cloudStore.ts) can mirror them and
// cloud sync can layer on top without changing callers.

import type { Session } from "@infiplot/types";
import { coerceOrientation } from "@infiplot/types";
import { idbGet, idbGetAll, idbPut, idbDelete, idbCount, STORIES_STORE } from "./idb";
import { slimSession } from "./sessionSlim";
import { STORY_SCHEMA_VERSION, coerceEpoch, type StoryRecord, type StoryMeta, type StorySyncEnvelope } from "./types";

/** Max number of non-tombstoned stories retained locally. IndexedDB has ample
 *  quota, so this is generous vs the old localStorage cap of 20; it aligns with
 *  the deleted D1 `listByUser` default limit of 50. */
export const LOCAL_STORY_CAP = 50;

/** Tombstoned records are kept (not hard-deleted) so a soft-delete can propagate
 *  to the cloud next phase — but only for a bounded window. Past this age they're
 *  reclaimed locally to stop unbounded IndexedDB growth (a pre-sync device may
 *  never propagate them, and the cloud applies deletes by id idempotently). */
export const TOMBSTONE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// ── Internal helpers ───────────────────────────────────────────────────────

function toMeta(rec: StoryRecord): StoryMeta {
  return {
    id: rec.id,
    worldSetting: rec.worldSetting,
    styleGuide: rec.styleGuide,
    orientation: coerceOrientation(rec.orientation),
    sceneCount: rec.sceneCount,
    createdAt: coerceEpoch(rec.createdAt, 0),
    updatedAt: coerceEpoch(rec.updatedAt, 0),
  };
}

/** Best-effort housekeeping run after a save. Guarded by a cheap count() so the
 *  common case (under cap, no aged tombstones) reads ZERO session blobs. Jobs
 *  when the guard trips:
 *   1. Reap tombstones older than TOMBSTONE_RETENTION_MS — soft-deletes otherwise
 *      accumulate forever (nothing consumes them until cloud sync lands), bloating
 *      every idbGetAll.
 *   2. Evict the oldest over-cap LIVE records, but SKIP any with un-propagated
 *      local changes (syncState !== "local-only") so an eviction can't silently
 *      drop edits a future cloud sync still needs to push.
 *   3. If step 2 couldn't reach the cap because every over-cap record was
 *      protected, evict the oldest regardless — a bounded store beats preserving
 *      un-synced work forever. Eviction is a local capacity measure, so it
 *      hard-deletes (no tombstone). Never fails the save. */
async function enforceRetentionCap(): Promise<void> {
  try {
    // Cheap gate: total rows (incl. tombstones) without reading any value. Under
    // the cap, live records are also under it and no tombstone reaping is due
    // often enough to matter — skip the full scan entirely. NOTE: idbCount
    // returns 0 when IndexedDB is unavailable/fails, so `0 <= CAP` skips eviction
    // — intentional best-effort: if we can't even count, we can't safely evict.
    const total = await idbCount(STORIES_STORE);
    if (total <= LOCAL_STORY_CAP) return;

    const all = await idbGetAll<StoryRecord>(STORIES_STORE);
    const now = Date.now();

    // 1. Reap aged tombstones (bounds tombstone growth, frees slots).
    for (const r of all) {
      if (r.deletedAt && now - coerceEpoch(r.deletedAt, now) > TOMBSTONE_RETENTION_MS) {
        await idbDelete(STORIES_STORE, r.id);
      }
    }

    // 2. Evict oldest over-cap live records, preserving un-synced ones.
    const live = all
      .filter((r) => !r.deletedAt)
      .sort((a, b) => coerceEpoch(a.updatedAt, 0) - coerceEpoch(b.updatedAt, 0));
    let overflow = live.length - LOCAL_STORY_CAP;
    if (overflow <= 0) return;
    for (const r of live) {
      if (overflow <= 0) break;
      // Keep records that still owe the cloud a push (pending edits/soft-deletes
      // or a synced baseline) — hard-deleting them would lose that work silently.
      if (r.syncState !== "local-only") continue;
      // Only count a slot freed when the delete actually succeeded — a failed
      // best-effort delete must not decrement overflow (would under-evict).
      if (await idbDelete(STORIES_STORE, r.id)) overflow--;
    }

    // 3. Last-resort: if step 2 couldn't reach the cap, every remaining over-cap
    // record is protected (syncState !== "local-only"). Evict the oldest of THOSE
    // regardless, so the store stays bounded. We must skip "local-only" here:
    // those were already deleted in step 2, but they're still present in the
    // in-memory `live` snapshot (idbDelete doesn't mutate it), so re-deleting them
    // would burn `overflow` on no-ops and let the loop break before reaching the
    // records that actually still occupy slots — leaving the cap exceeded.
    // (Currently latent: non-"local-only" LIVE records don't yet exist — pending
    // ones are produced only by softDeleteStory, which also tombstones them, so
    // they're filtered out of `live` above. This guards the path that opens once
    // cloud sync yields un-tombstoned pending/synced records.)
    if (overflow > 0) {
      for (const r of live) {
        if (overflow <= 0) break;
        if (r.syncState === "local-only") continue; // already evicted in step 2
        if (await idbDelete(STORIES_STORE, r.id)) overflow--;
      }
    }
  } catch {
    // best-effort
  }
}

// ── Public API (symmetric with the future cloud repository) ─────────────────

/** Upsert one story by `session.id`. New record gets rev=1 / syncState
 *  "local-only" / deletedAt null; an existing one bumps rev, refreshes
 *  updatedAt, preserves createdAt, and (re-)clears any tombstone. The bulky
 *  fields are stripped via slimSession before write. Returns the written
 *  record, or null when storage is unavailable / the write failed (Req 2.x). */
export async function saveStorySession(
  session: Session,
): Promise<StoryRecord | null> {
  if (!session?.id) return null;
  const now = Date.now();
  const existing = await idbGet<StoryRecord>(STORIES_STORE, session.id);

  const record: StoryRecord = {
    id: session.id,
    schemaVersion: STORY_SCHEMA_VERSION,
    worldSetting: session.worldSetting ?? "",
    styleGuide: session.styleGuide ?? "",
    orientation: coerceOrientation(session.orientation),
    sceneCount: session.history?.length ?? 0,
    createdAt: existing ? coerceEpoch(existing.createdAt, now) : now,
    updatedAt: now,
    rev: existing ? (existing.rev ?? 1) + 1 : 1,
    // Re-saving (even a tombstoned id) revives the record locally.
    deletedAt: null,
    // A previously-synced record that changes locally becomes pending; otherwise
    // keep its state (new → local-only). Consumed by next-phase cloud sync.
    syncState: existing?.syncState === "synced" ? "pending" : existing?.syncState ?? "local-only",
    session: slimSession(session),
  };

  const ok = await idbPut(STORIES_STORE, record);
  if (!ok) return null;
  await enforceRetentionCap();
  return record;
}

/** List non-tombstoned stories as lightweight metadata, newest first (Req 3.1).
 *  NOTE: idbGetAll deserializes each record's full session blob even though only
 *  the denormalized meta fields are projected — meta and blob share one object
 *  store. Acceptable at LOCAL_STORY_CAP=50; if listing ever dominates, split the
 *  meta into its own store (or a cursor projection) to avoid reading blobs here. */
export async function listStories(): Promise<StoryMeta[]> {
  const all = await idbGetAll<StoryRecord>(STORIES_STORE);
  return all
    .filter((r) => !r.deletedAt)
    .map(toMeta)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Load the slim Session for a story id. Tombstoned or absent → null (Req 3.3).
 *  Defensively coerces the carried session's createdAt across the storage
 *  boundary (Req 3.6). The slim session is missing voice/styleReferenceImage by
 *  design — the engine degrades gracefully (Req 3.4). */
export async function loadStorySession(id: string): Promise<Session | null> {
  const rec = await idbGet<StoryRecord>(STORIES_STORE, id);
  if (!rec || rec.deletedAt || !rec.session) return null;
  return { ...rec.session, createdAt: coerceEpoch(rec.session.createdAt, rec.createdAt) };
}

/** Soft-delete: set the tombstone + mark pending so the deletion can propagate
 *  to the cloud next phase. List queries filter tombstoned records out, so the
 *  user perceives it as deleted. Absent / already-deleted id → false (Req 3.5). */
export async function softDeleteStory(id: string): Promise<boolean> {
  const rec = await idbGet<StoryRecord>(STORIES_STORE, id);
  if (!rec || rec.deletedAt) return false;
  const now = Date.now();
  const updated: StoryRecord = {
    ...rec,
    deletedAt: now,
    updatedAt: now,
    syncState: "pending",
  };
  return idbPut(STORIES_STORE, updated);
}

// ── Sync support (story-cloud-sync) ─────────────────────────────────────────
// These are the cloud-sync counterparts to the user-write path above. The
// distinction matters: saveStorySession is a USER write (bumps rev,
// synced→pending), while putSyncedRecord is a SYNC write (cloud is
// authoritative: takes the cloud rev verbatim, marks synced, never bumps).

/** Reconcile diff basis (local side): ALL records INCLUDING tombstones, with
 *  rev/syncState intact — the local mirror of cloudStoryManifest's
 *  tombstone-inclusive scan. [] when storage is unavailable. */
export async function listAllRecordsForSync(): Promise<StoryRecord[]> {
  return idbGetAll<StoryRecord>(STORIES_STORE);
}

/** Write a cloud-pulled version as the authoritative synced baseline:
 *  rev/updatedAt/deletedAt taken from the envelope, syncState="synced", and
 *  rev is NOT bumped (unlike saveStorySession). createdAt is preserved if a
 *  local record already exists, else seeded from the envelope's updatedAt (the
 *  cloud row carries no createdAt; createdAt is display-only). Keeps the
 *  schemaVersion invariant and the slim session as-is. Returns false on write
 *  failure (Req 3.3, 3.6). Runs retention housekeeping after a durable write. */
export async function putSyncedRecord(
  env: StorySyncEnvelope,
): Promise<boolean> {
  if (!env?.id) return false;
  const existing = await idbGet<StoryRecord>(STORIES_STORE, env.id);
  // Concurrency guard (symmetric with markRecordSynced's rev guard): if the local
  // record was updated to a strictly newer version (rev → updatedAt) between
  // reconcile's decision snapshot and this write, don't clobber it — leave it
  // (pending) for the next reconcile to re-push. Otherwise a local autosave that
  // lands mid-reconcile could be overwritten by a now-stale cloud version (a
  // legitimate LWW winner silently lost).
  if (existing) {
    const er = existing.rev ?? 1;
    const nr = env.rev ?? 1;
    const eu = coerceEpoch(existing.updatedAt, 0);
    const nu = coerceEpoch(env.updatedAt, 0);
    if (er > nr || (er === nr && eu > nu)) return false;
  }
  const record: StoryRecord = {
    id: env.id,
    schemaVersion: STORY_SCHEMA_VERSION,
    worldSetting: env.worldSetting ?? "",
    styleGuide: env.styleGuide ?? "",
    orientation: coerceOrientation(env.orientation),
    sceneCount: env.sceneCount ?? 0,
    createdAt: existing
      ? coerceEpoch(existing.createdAt, env.updatedAt)
      : coerceEpoch(env.updatedAt, Date.now()),
    updatedAt: coerceEpoch(env.updatedAt, Date.now()),
    rev: env.rev ?? 1,
    deletedAt: env.deletedAt == null ? null : coerceEpoch(env.deletedAt, Date.now()),
    syncState: "synced",
    session: env.session,
  };
  const ok = await idbPut(STORIES_STORE, record);
  if (ok) await enforceRetentionCap();
  return ok;
}

/** Mark a local record synced after a successful push, aligning syncState to
 *  the cloud-acknowledged baseline — but ONLY if the local record still matches
 *  the rev we pushed. A newer local edit (rev moved past what we pushed) is left
 *  pending so the next reconcile re-pushes the newer content. No-op if the
 *  record is gone or already synced (Req 8.1). */
export async function markRecordSynced(id: string, rev: number, updatedAt: number): Promise<void> {
  const rec = await idbGet<StoryRecord>(STORIES_STORE, id);
  if (!rec) return;
  // Guard on BOTH rev and updatedAt. softDeleteStory bumps updatedAt WITHOUT
  // bumping rev, so a same-rev-but-newer local tombstone produced while a push
  // was in flight must NOT be marked synced by that older push's ack (it still
  // owes a delete push). Symmetric with putSyncedRecord's concurrency guard.
  if ((rec.rev ?? 1) !== rev) return;
  if (coerceEpoch(rec.updatedAt, 0) !== coerceEpoch(updatedAt, 0)) return;
  if (rec.syncState === "synced") return;
  await idbPut(STORIES_STORE, { ...rec, syncState: "synced" });
}
