import "server-only";

import { eq, and, sql } from "drizzle-orm";
import type { DbInstance } from "../client";
import { featuredStories } from "../schema";
import type { FeaturedStory } from "../schema";

/**
 * Featured Story Repository - encapsulates D1 access for homepage featured stories.
 *
 * Provides: listByGender (active only, sorted by sortOrder), incrementClick (analytics).
 */
export class FeaturedRepository {
  constructor(private db: DbInstance) {}

  /**
   * List active featured stories for a given gender, ordered by sortOrder.
   *
   * @param gender "male" or "female"
   * @returns Array of FeaturedStory (only isActive=1, sorted by sortOrder ASC)
   */
  async listByGender(gender: "male" | "female"): Promise<FeaturedStory[]> {
    return this.db
      .select()
      .from(featuredStories)
      .where(and(eq(featuredStories.gender, gender), eq(featuredStories.isActive, 1)))
      .orderBy(featuredStories.sortOrder);
  }

  /**
   * Increment click count for a featured story (analytics).
   *
   * @param id Featured story ID (e.g. "m0", "f12")
   * @returns true if updated, false if not found
   */
  async incrementClick(id: string): Promise<boolean> {
    const result = await this.db
      .update(featuredStories)
      .set({ clickCount: sql`${featuredStories.clickCount} + 1` })
      .where(eq(featuredStories.id, id));

    // Drizzle D1 update returns { success, meta: { changes }, results }
    return ((result as any).meta?.changes ?? 0) > 0;
  }
}
