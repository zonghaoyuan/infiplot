import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * GET/DELETE /api/stories/[id] — TEMPORARILY DISABLED (2026-06-09)
 *
 * D1 persistence disabled until authentication integration.
 * Returns 404 so client handles gracefully (localStorage is the source of truth).
 *
 * To re-enable: Restore original implementation after auth integration.
 */
export async function GET(
  _req: Request,
  _context: { params: Promise<{ id: string }> },
) {
  return NextResponse.json(
    { error: "Server persistence temporarily disabled" },
    { status: 404 },
  );
}

export async function DELETE(
  _req: Request,
  _context: { params: Promise<{ id: string }> },
) {
  return NextResponse.json(
    { error: "Server persistence temporarily disabled" },
    { status: 404 },
  );
}
