import "server-only";

import { getCloudflareContext } from "@opennextjs/cloudflare";

/**
 * R2 Storage封装 - 用户生成图片持久化
 *
 * Phase 1: 优先使用 Runware CDN URL（零额外存储成本），R2 key 作为可选持久化。
 * Phase 2+: save 流程中可选地将场景图从 CDN fetch 后转存 R2，防 URL 过期。
 */

/**
 * Build R2 object key for image storage.
 *
 * Pattern: {storyId}/{kind}/{id}.webp
 *   - kind: "scene" | "portrait" | "style-ref"
 *   - id: scene.id | character.name | "ref"
 *
 * Example: s_abc123/scene/sc_1.webp, s_abc123/portrait/李华.webp
 */
export function buildImageKey(
  storyId: string,
  kind: "scene" | "portrait" | "style-ref",
  id: string,
): string {
  // Sanitize both storyId and id to avoid path traversal / key confusion
  const safeStoryId = storyId.replace(/[^a-zA-Z0-9_一-龥-]/g, "_");
  const safeId = id.replace(/[^a-zA-Z0-9_一-龥-]/g, "_");
  return `${safeStoryId}/${kind}/${safeId}.webp`;
}

/**
 * Upload image to R2 and return public URL.
 *
 * @param key R2 object key (use buildImageKey to generate)
 * @param data Image data (Buffer or Uint8Array)
 * @returns Public R2 URL (https://<public-domain>/<key>)
 * @throws Error if R2 upload fails or binding unavailable
 */
export async function uploadImage(
  key: string,
  data: Buffer | Uint8Array,
): Promise<string> {
  try {
    const { env } = getCloudflareContext();

    if (!env.R2_BUCKET) {
      throw new Error(
        "R2_BUCKET binding not found. " +
        "Ensure wrangler.jsonc has r2_buckets configured and you're running via wrangler."
      );
    }

    // Upload to R2 with WebP content-type
    await env.R2_BUCKET.put(key, data, {
      httpMetadata: {
        contentType: "image/webp",
      },
    });

    // Return public URL (assumes custom domain or R2 public bucket configured)
    // Phase 1: hardcode or read from env; Phase 2: configure in wrangler
    const publicDomain = process.env.R2_PUBLIC_DOMAIN ?? "https://r2.infiplot.example"; // Placeholder
    return `${publicDomain}/${key}`;
  } catch (error) {
    // Re-throw with context for caller to handle gracefully
    throw new Error(
      `R2 upload failed for key ${key}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Fetch image from URL and upload to R2 (for migrating Runware CDN → R2).
 *
 * @param url Source image URL (e.g. Runware CDN)
 * @param key R2 object key
 * @returns Public R2 URL, or null if fetch/upload fails (caller should fallback to original URL)
 */
export async function migrateImageToR2(
  url: string,
  key: string,
): Promise<string | null> {
  try {
    // Fetch image from CDN
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`[R2] Failed to fetch image from ${url}: HTTP ${res.status}`);
      return null;
    }

    const data = new Uint8Array(await res.arrayBuffer());

    // Upload to R2
    return await uploadImage(key, data);
  } catch (error) {
    // Log but don't throw - caller should gracefully fallback to CDN URL
    console.warn(
      `[R2] Migration failed for ${url} → ${key}:`,
      error instanceof Error ? error.message : error
    );
    return null;
  }
}
