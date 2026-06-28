import { NextResponse } from "next/server";
import { coerceOrientation } from "@infiplot/types";
import { requireUser } from "@/lib/supabase/guard";
import { cloudSaveStory } from "@/lib/persistence/cloudStore";
import { coerceEpoch, type StorySyncEnvelope } from "@/lib/persistence/types";

export const runtime = "nodejs";

// Matches story-pack's 12 MB doc ceiling — a slim Session (voice +
// styleReferenceImage stripped) is far smaller, so this only rejects
// pathological payloads, never normal saves.
const MAX_PUSH_BYTES = 12_000_000;

// POST /api/stories/push — body StorySyncEnvelope → { stored, won }. Pure
// passthrough to the optimistic-concurrency RPC; won=false means a newer cloud
// row was preserved. requireUser 401s an unauthenticated commercial caller; on
// the open-source build cloudSaveStory short-circuits to { stored:null, won:false }.
export async function POST(req: Request) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;

  // Pre-check Content-Length to reject an oversized body before buffering it.
  // The post-read byteLength check below still covers chunked/omitted headers.
  const contentLength = req.headers.get("content-length");
  if (contentLength && Number(contentLength) > MAX_PUSH_BYTES) {
    return NextResponse.json({ error: "payload too large" }, { status: 413 });
  }

  let raw: string;
  try {
    raw = await req.text();
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  if (Buffer.byteLength(raw, "utf8") > MAX_PUSH_BYTES) {
    return NextResponse.json({ error: "payload too large" }, { status: 413 });
  }

  let env: StorySyncEnvelope;
  try {
    env = JSON.parse(raw) as StorySyncEnvelope;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  if (!env?.id || typeof env.id !== "string") {
    return NextResponse.json({ error: "missing id" }, { status: 400 });
  }
  // Validate the LWW-ordering fields as finite values: a non-finite rev /
  // updatedAt would otherwise reach the RPC, throw at toISOString(), and surface
  // as a silent { stored:null, won:false } 200 — return 400 so the caller can
  // diagnose a bad request rather than mistake it for a normal lost conflict.
  if (typeof env.rev !== "number" || !Number.isFinite(env.rev) || env.rev <= 0) {
    return NextResponse.json({ error: "invalid rev" }, { status: 400 });
  }
  if (typeof env.updatedAt !== "number" || !Number.isFinite(env.updatedAt)) {
    return NextResponse.json({ error: "invalid updatedAt" }, { status: 400 });
  }
  if (
    env.deletedAt != null &&
    (typeof env.deletedAt !== "number" || !Number.isFinite(env.deletedAt))
  ) {
    return NextResponse.json({ error: "invalid deletedAt" }, { status: 400 });
  }

  // Defensive coercion at the trust boundary (the slim session itself is left to
  // the client — it's reconstructible and never security-sensitive after slim).
  const result = await cloudSaveStory({
    ...env,
    orientation: coerceOrientation(env.orientation),
    updatedAt: coerceEpoch(env.updatedAt, 0),
    deletedAt: env.deletedAt == null ? null : coerceEpoch(env.deletedAt, 0),
  });
  return NextResponse.json(result);
}
