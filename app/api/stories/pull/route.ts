import { NextResponse } from "next/server";
import { requireUser } from "@/lib/supabase/guard";
import { cloudPullBlobs } from "@/lib/persistence/cloudStore";

export const runtime = "nodejs";

// Cap per request — reconcile chunks its pull set, so one call never asks for an
// unbounded id list (a denial-of-wallet / oversized-response guard).
const MAX_PULL_IDS = 200;

// POST /api/stories/pull — body { ids: string[] } → { blobs: StorySyncEnvelope[] }
// (full payloads, INCLUDING tombstones, for write-back into the local store).
// Pure passthrough to cloudStore; same auth/short-circuit story as manifest.
export async function POST(req: Request) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;

  let body: { ids?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const ids = Array.isArray(body.ids)
    ? body.ids
        .filter((x): x is string => typeof x === "string" && x.length > 0)
        .slice(0, MAX_PULL_IDS)
    : [];

  const blobs = await cloudPullBlobs(ids);
  return NextResponse.json({ blobs });
}
