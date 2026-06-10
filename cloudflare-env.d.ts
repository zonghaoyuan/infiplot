/**
 * Extend the global CloudflareEnv interface (declared by @opennextjs/cloudflare)
 * with infiplot's D1/R2/KV bindings.
 * See wrangler.jsonc for the binding configuration.
 */

interface CloudflareEnv {
  // D1 Database binding (wrangler.jsonc: d1_databases)
  DB: D1Database;

  // R2 Bucket binding (wrangler.jsonc: r2_buckets)
  R2_BUCKET: R2Bucket;

  // KV Namespace binding (wrangler.jsonc: kv_namespaces)
  KV: KVNamespace;
}
