import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * POST /api/stories/save — TEMPORARILY DISABLED (2026-06-09)
 *
 * D1 persistence is disabled until an authentication system (better-auth) is
 * integrated. Without auth, anonymous writes to D1 have no rate limiting,
 * per-user quota, or ownership verification — an abuse/DoS risk on a public,
 * registration-less site. The client (lib/clientStoryPersistence.ts) now
 * persists stories to localStorage only; this 503 keeps the contract intact
 * for any caller that still hits the endpoint.
 *
 * The full D1 implementation lives in StoryRepository (lib/db/repositories/
 * storyRepo.ts), which is untouched. To re-enable after auth integration:
 * restore the handler to validate input + call `repo.save(...)` (see the
 * task-10 implementation log) and gate it behind an authenticated session.
 *
 * See: ARCHITECTURE_DESIGN.md Phase 2, memory tech_d1_anonymous_write_risk
 */
export async function POST(_req: Request) {
  return NextResponse.json(
    { error: "Server persistence temporarily disabled - using local storage" },
    { status: 503 },
  );
}
