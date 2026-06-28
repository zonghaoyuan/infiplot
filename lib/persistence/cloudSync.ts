// Reconcile engine — the bidirectional local↔cloud sync orchestration for the
// COMMERCIAL build. Browser-only. This is the single place that maps
// StoryRecord ↔ StorySyncEnvelope ↔ StorySyncMeta and owns every merge decision.
//
// Triggers (all best-effort, never throw, never block gameplay):
//  - syncOnLogin(): full reconcile on sign-in / authed mount, serialized so a
//    second trigger joins the in-flight run instead of racing it.
//  - pushOnSave(record): fire-and-forget single push after a local autosave.
//  - pushDeletion(id): fire-and-forget tombstone propagation after a soft-delete.
//
// Conflict policy is last-write-wins: rev wins; on a rev tie, the later
// updatedAt wins (decideAction). A losing side is overwritten — acceptable for
// single-player, full-snapshot galgame saves (see design.md conflict tradeoff).

import { AUTH_ENABLED } from "@/lib/supabase/config";
import { isAuthed } from "@/lib/authResume";
import {
  pullManifest,
  pullBlobs,
  pushBlob,
  pushDelete,
} from "./cloudSyncClient";
import {
  listAllRecordsForSync,
  putSyncedRecord,
  markRecordSynced,
} from "./localStore";
import { idbGet, STORIES_STORE } from "./idb";
import { coerceEpoch, type StoryRecord, type StorySyncMeta, type StorySyncEnvelope } from "./types";

// Keep in lockstep with the pull route's MAX_PULL_IDS.
const PULL_CHUNK = 200;

type ReconcileAction = "push" | "pull" | "delete-remote" | "noop";

/** Which side is newer by the LWW order (rev, then updatedAt). Pure. */
function newerSide(
  local: StoryRecord,
  cloud: StorySyncMeta,
): "local" | "cloud" | "equal" {
  const lr = local.rev ?? 1;
  const cr = cloud.rev ?? 1;
  if (lr > cr) return "local";
  if (lr < cr) return "cloud";
  const lu = coerceEpoch(local.updatedAt, 0);
  const cu = coerceEpoch(cloud.updatedAt, 0);
  if (lu > cu) return "local";
  if (lu < cu) return "cloud";
  return "equal";
}

/** Pure merge decision for one id (no I/O) — implements the design decision
 *  table incl. tombstone priority ("the newer operation wins"). A soft-delete
 *  carries (rev, updatedAt) and is compared like an edit. NOTE softDeleteStory
 *  does NOT bump rev, so within the SAME rev a later-updatedAt delete propagates
 *  and a later-updatedAt edit resurrects; ACROSS revs the rev-primary LWW order
 *  applies (a higher-rev edit beats a wall-clock-later but lower-rev delete).
 *  Exported for the decision-matrix test.
 *
 *  - only cloud, live     → pull
 *  - only cloud, tombstone→ noop (don't materialize an already-reaped / never-held
 *                            tombstone — avoids a 30-day-reap → re-pull-of-blob loop)
 *  - only local, live     → push
 *  - only local, tombstone→ noop (no cloud row to delete; reaped locally)
 *  - both, local newer    → tombstone ? delete-remote : push
 *  - both, cloud newer    → pull
 *  - both, equal          → noop (reconcile markSyncs if local not yet synced) */
export function decideAction(
  local: StoryRecord | undefined,
  cloud: StorySyncMeta | undefined,
): ReconcileAction {
  if (!local && cloud) return cloud.deletedAt ? "noop" : "pull";
  if (local && !cloud) return local.deletedAt ? "noop" : "push";
  if (!local || !cloud) return "noop"; // both undefined — unreachable in reconcile

  const side = newerSide(local, cloud);
  if (side === "local") return local.deletedAt ? "delete-remote" : "push";
  if (side === "cloud") return "pull";
  return "noop";
}

/** StoryRecord → envelope for push (carries the LWW-ordering fields). */
function recordToEnvelope(rec: StoryRecord): StorySyncEnvelope {
  return {
    id: rec.id,
    worldSetting: rec.worldSetting ?? "",
    styleGuide: rec.styleGuide ?? "",
    orientation: rec.orientation,
    sceneCount: rec.sceneCount ?? 0,
    rev: rec.rev ?? 1,
    session: rec.session,
    updatedAt: coerceEpoch(rec.updatedAt, 0),
    deletedAt: rec.deletedAt == null ? null : coerceEpoch(rec.deletedAt, 0),
  };
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** Push one local record; on a lost optimistic-concurrency race (won=false)
 *  pull the newer cloud row back instead. Each step swallows its own errors. */
async function pushOne(rec: StoryRecord): Promise<void> {
  const res = await pushBlob(recordToEnvelope(rec));
  if (!res) return; // network/auth failure → leave pending for next reconcile
  if (res.won) {
    await markRecordSynced(rec.id, rec.rev ?? 1, coerceEpoch(rec.updatedAt, 0));
  } else if (res.stored) {
    await putSyncedRecord(res.stored); // we lost → adopt the newer cloud state
  }
}

/** Full bidirectional reconcile. Diffs the local set (incl. tombstones) against
 *  the cloud manifest, then applies each id's action, every item fault-tolerant
 *  (one failure skips that id, never the whole pass). */
async function reconcile(): Promise<void> {
  const [localRecords, manifest] = await Promise.all([
    listAllRecordsForSync(),
    pullManifest(),
  ]);
  const localById = new Map(localRecords.map((r) => [r.id, r]));
  const cloudById = new Map(manifest.map((m) => [m.id, m]));
  const allIds = new Set<string>([...localById.keys(), ...cloudById.keys()]);

  const toPull: string[] = [];
  const toPush: StoryRecord[] = [];
  const toDelete: StoryRecord[] = [];
  const toMarkSynced: StoryRecord[] = [];

  for (const id of allIds) {
    const local = localById.get(id);
    const cloud = cloudById.get(id);
    switch (decideAction(local, cloud)) {
      case "pull":
        toPull.push(id);
        break;
      case "push":
        if (local) toPush.push(local);
        break;
      case "delete-remote":
        if (local) toDelete.push(local);
        break;
      case "noop":
        // Already consistent on both sides but local not yet flagged synced —
        // align its syncState (guard on cloud existing so a local-only tombstone
        // isn't wrongly marked synced).
        if (local && cloud && local.syncState !== "synced") toMarkSynced.push(local);
        break;
    }
  }

  // Pull (batched, chunked to the route cap).
  for (const ids of chunk(toPull, PULL_CHUNK)) {
    try {
      const blobs = await pullBlobs(ids);
      for (const b of blobs) {
        try {
          await putSyncedRecord(b);
        } catch {
          /* skip this id */
        }
      }
    } catch {
      /* skip this chunk (consistent with the push/delete loops' fault isolation) */
    }
  }
  // Push.
  for (const rec of toPush) {
    try {
      await pushOne(rec);
    } catch {
      /* leave pending */
    }
  }
  // Tombstone propagation.
  for (const rec of toDelete) {
    try {
      const ok = await pushDelete(rec.id, rec.rev ?? 1, coerceEpoch(rec.deletedAt, Date.now()));
      if (ok) await markRecordSynced(rec.id, rec.rev ?? 1, coerceEpoch(rec.updatedAt, 0));
      // !ok → cloud has a newer row; the next reconcile pulls it back.
    } catch {
      /* leave pending */
    }
  }
  // Mark already-consistent records synced.
  for (const rec of toMarkSynced) {
    try {
      await markRecordSynced(rec.id, rec.rev ?? 1, coerceEpoch(rec.updatedAt, 0));
    } catch {
      /* best-effort */
    }
  }
}

// ── Public triggers ─────────────────────────────────────────────────────────

// Serialize full syncs: a second trigger joins the in-flight run rather than
// starting a concurrent reconcile (Req 4.3). Module-level, mirrors the play
// page's saveChain dedup idea.
let inFlight: Promise<void> | null = null;

/** Trigger a full reconcile on sign-in / authed mount. Serialized + best-effort;
 *  short-circuits when auth is off or the user isn't signed in. */
export async function syncOnLogin(): Promise<void> {
  if (!AUTH_ENABLED) return;
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      if (!(await isAuthed())) return;
      await reconcile();
    } catch {
      /* best-effort */
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

/** Fire-and-forget single push after a local autosave. Leaves the record pending
 *  on any failure so the next reconcile re-pushes it. */
export async function pushOnSave(record: StoryRecord): Promise<void> {
  if (!AUTH_ENABLED || !record?.id) return;
  try {
    if (!(await isAuthed())) return;
    await pushOne(record);
  } catch {
    /* leave pending */
  }
}

/** Fire-and-forget tombstone propagation after a local soft-delete. Reads the
 *  local tombstone for its rev/deletedAt, then pushes the delete. */
export async function pushDeletion(id: string): Promise<void> {
  if (!AUTH_ENABLED || !id) return;
  try {
    if (!(await isAuthed())) return;
    const rec = await idbGet<StoryRecord>(STORIES_STORE, id);
    if (!rec || !rec.deletedAt) return; // not a tombstone / already gone
    const ok = await pushDelete(id, rec.rev ?? 1, coerceEpoch(rec.deletedAt, Date.now()));
    if (ok) await markRecordSynced(id, rec.rev ?? 1, coerceEpoch(rec.updatedAt, 0));
  } catch {
    /* leave pending */
  }
}
