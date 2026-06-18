import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// Minimal config — the project is fully stateless (sessions live on the
// client), so no R2/KV/D1 incremental cache is needed.
//
// NOTE: The build script uses `next build --webpack` (not Turbopack) because
// OpenNext 1.19.x has a known chunk-loading issue with Turbopack SSR output
// on Workers (opennextjs/opennextjs-cloudflare#1258). Remove --webpack from
// package.json once the upstream fix lands.
export default defineCloudflareConfig();
