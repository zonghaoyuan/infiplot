import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { FeaturedRepository } from "@/lib/db/repositories/featuredRepo";

export const runtime = "nodejs";

/**
 * GET /api/stories/featured?gender=male
 *
 * List active featured stories for homepage display.
 * Fallback: D1 query fails → return empty array (homepage shows no cards, gracefully degrades).
 *
 * Query Params:
 *   gender: "male" | "female" (required)
 *
 * Response: { stories: FeaturedStory[] }
 * Errors: 400 (invalid gender), 500 (should not reach user - caught and degraded)
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const genderParam = searchParams.get("gender");

  // Validate gender
  if (!genderParam || !["male", "female"].includes(genderParam)) {
    return NextResponse.json(
      { error: "gender query parameter must be 'male' or 'female'" },
      { status: 400 },
    );
  }

  const gender = genderParam as "male" | "female";

  try {
    const db = getDb();
    const repo = new FeaturedRepository(db);

    const stories = await repo.listByGender(gender);

    return NextResponse.json({ stories });
  } catch (err) {
    // D1 unavailable or query failed - degrade to empty array
    // (homepage will show no cards but remain functional)
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[stories/featured] D1 query failed, returning empty array:", message);

    return NextResponse.json({ stories: [] });
  }
}
