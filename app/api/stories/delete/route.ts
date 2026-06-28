import { NextResponse } from "next/server";
import { requireUser } from "@/lib/supabase/guard";
import { cloudSoftDeleteStory } from "@/lib/persistence/cloudStore";

export const runtime = "nodejs";

// POST /api/stories/delete — body { id, rev, deletedAt } → { ok }. Propagates a
// soft-delete (tombstone) under the same optimistic-concurrency guard as push.
// requireUser 401s an unauthenticated commercial caller; on the open-source
// build cloudSoftDeleteStory short-circuits to false.
export async function POST(req: Request) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;

  let body: { id?: unknown; rev?: unknown; deletedAt?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const id = typeof body.id === "string" ? body.id : "";
  if (!id) {
    return NextResponse.json({ error: "missing id" }, { status: 400 });
  }
  // Validate rev/deletedAt as finite values (see push route rationale): reject
  // bad input with 400 rather than letting NaN/Infinity reach the PostgREST
  // filter or toISOString().
  if (typeof body.rev !== "number" || !Number.isFinite(body.rev) || body.rev <= 0) {
    return NextResponse.json({ error: "invalid rev" }, { status: 400 });
  }
  if (typeof body.deletedAt !== "number" || !Number.isFinite(body.deletedAt)) {
    return NextResponse.json({ error: "invalid deletedAt" }, { status: 400 });
  }

  const ok = await cloudSoftDeleteStory(id, body.rev, body.deletedAt);
  return NextResponse.json({ ok });
}
