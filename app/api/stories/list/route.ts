import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * GET /api/stories/list — TEMPORARILY DISABLED (2026-06-09)
 *
 * D1 persistence disabled until authentication integration.
 * Returns empty list so client falls back to localStorage-only mode.
 *
 * To re-enable: Restore original implementation after auth integration.
 */
export async function GET(_req: Request) {
  return NextResponse.json({ stories: [] });
}
