import "server-only";

import { drizzle } from "drizzle-orm/d1";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import * as schema from "./schema";

/**
 * Get D1 database instance from Cloudflare Workers env binding.
 *
 * Usage in API routes:
 *   const db = getDb();
 *   const stories = await db.select().from(schema.stories).where(...);
 *
 * @throws Error if called outside Cloudflare Workers runtime (e.g. local dev without wrangler)
 */
export function getDb() {
  try {
    const { env } = getCloudflareContext();

    if (!env.DB) {
      throw new Error(
        "D1 binding 'DB' not found. " +
        "Ensure wrangler.jsonc has d1_databases configured and you're running via wrangler dev/deploy."
      );
    }

    return drizzle(env.DB, { schema });
  } catch (error) {
    // Re-throw with more context for debugging
    throw new Error(
      `Failed to get D1 database: ${error instanceof Error ? error.message : String(error)}. ` +
      "Make sure you're running in Cloudflare Workers context (wrangler dev/deploy)."
    );
  }
}

/**
 * Type alias for the Drizzle D1 database instance.
 * Useful for dependency injection and testing.
 */
export type DbInstance = ReturnType<typeof getDb>;
