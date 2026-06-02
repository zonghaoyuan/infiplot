import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// Minimal config — the project is fully stateless (sessions live on the
// client), so no R2/KV/D1 incremental cache is needed.
export default defineCloudflareConfig();
