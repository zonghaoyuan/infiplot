// Network bridge — the ONLY fetch layer between the local store / reconcile
// engine and the cloud story API. Browser-only (imports the public AUTH_ENABLED
// flag, never the server-only cloudStore).
//
// Two-layer short-circuit:
//  1. AUTH_ENABLED=false (open-source build) → every method returns a safe empty
//     value on its first line and NEVER issues a request.
//  2. The signed-in gate is enforced ONCE by the caller — the reconcile engine
//     checks isAuthed() before touching this bridge — so methods here don't
//     re-run getUser() per call. If an unauthenticated request slips through
//     anyway, the route 401s and the fault-tolerant fetch below maps it to the
//     same safe empty value.
//
// Every request is fully fault-tolerant: any non-2xx / network error / parse
// failure resolves to a safe value and never throws (best-effort sync).

import { AUTH_ENABLED } from "@/lib/supabase/config";
import type { StorySyncMeta, StorySyncEnvelope } from "./types";

async function postJson<T>(url: string, body: unknown): Promise<T | null> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** GET the cloud manifest (all rows incl. tombstones, lightweight). [] on any
 *  failure / auth off. */
export async function pullManifest(): Promise<StorySyncMeta[]> {
  if (!AUTH_ENABLED) return [];
  try {
    const res = await fetch("/api/stories/manifest", { method: "GET", cache: "no-store" });
    if (!res.ok) return [];
    const data = (await res.json()) as { items?: unknown };
    return Array.isArray(data.items) ? (data.items as StorySyncMeta[]) : [];
  } catch {
    return [];
  }
}

/** Pull full envelopes for the given ids. [] on empty ids / failure / auth off. */
export async function pullBlobs(ids: string[]): Promise<StorySyncEnvelope[]> {
  if (!AUTH_ENABLED || ids.length === 0) return [];
  const data = await postJson<{ blobs?: unknown }>("/api/stories/pull", { ids });
  return Array.isArray(data?.blobs) ? (data.blobs as StorySyncEnvelope[]) : [];
}

/** Push one envelope through the optimistic-concurrency RPC. Returns the
 *  `{ stored, won }` result, or null on failure / auth off (caller leaves the
 *  record pending for the next reconcile). */
export async function pushBlob(
  env: StorySyncEnvelope,
): Promise<{ stored: StorySyncEnvelope | null; won: boolean } | null> {
  if (!AUTH_ENABLED) return null;
  return postJson<{ stored: StorySyncEnvelope | null; won: boolean }>(
    "/api/stories/push",
    env,
  );
}

/** Propagate a soft-delete tombstone. false on failure / auth off / not-newer. */
export async function pushDelete(
  id: string,
  rev: number,
  deletedAt: number,
): Promise<boolean> {
  if (!AUTH_ENABLED) return false;
  const data = await postJson<{ ok?: boolean }>("/api/stories/delete", {
    id,
    rev,
    deletedAt,
  });
  return data?.ok ?? false;
}
