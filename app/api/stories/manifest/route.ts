import { NextResponse } from "next/server";
import { requireUser } from "@/lib/supabase/guard";
import { cloudStoryManifest } from "@/lib/persistence/cloudStore";

export const runtime = "nodejs";

// GET /api/stories/manifest — the reconcile diff basis: every cloud row for the
// signed-in user (INCLUDING tombstones), projected to {id, rev, updatedAt,
// deletedAt} without the bulky session_jsonb. Pure passthrough to cloudStore;
// requireUser 401s an unauthenticated commercial-build caller, and on the
// open-source build (AUTH_ENABLED=false) cloudStoryManifest short-circuits to []
// without ever constructing a Supabase client.
export async function GET() {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;

  const items = await cloudStoryManifest();
  return NextResponse.json(
    { items },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
