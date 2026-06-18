#!/usr/bin/env node

/**
 * Bundle Secret Scanner
 * Scans Next.js production build artifacts for leaked prompt secrets.
 * Usage: node scripts/scan-bundle-secrets.mjs
 * Exit 0 if clean, exit 1 if secrets found (for CI).
 */

import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

// Critical prompt constant names that MUST NOT appear in client bundle
const SECRET_PATTERNS = [
  "CHARACTER_WRITER_SYSTEM",
  "CHARACTER_DESIGNER_SYSTEM",
  "CINEMATOGRAPHER_SYSTEM",
  "ARCHITECT_SYSTEM",
  "WRITER_PLAN_SYSTEM",
  "WRITER_BEATS_SYSTEM",
  "VOICE_DESIGNER_SYSTEM",
  "FREEFORM_CLASSIFY_SYSTEM",
  "loadEngineConfig", // config.ts function should not leak
];

// Directories to scan (Next.js client bundle output)
const SCAN_DIRS = [
  ".next/static/chunks", // Client-side JS chunks
  ".next/static/css",    // CSS bundles (shouldn't have JS, but scan anyway)
];

/**
 * Recursively scan directory for files
 */
function* walkDir(dir) {
  try {
    const entries = readdirSync(dir);
    for (const entry of entries) {
      const fullPath = join(dir, entry);
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        yield* walkDir(fullPath);
      } else if (stat.isFile() && /\.(js|css)$/i.test(entry)) {
        yield fullPath;
      }
    }
  } catch (err) {
    // Directory might not exist yet (e.g. fresh clone before build)
    if (err.code !== "ENOENT") throw err;
  }
}

/**
 * Scan a single file for secret patterns
 */
function scanFile(filePath) {
  const content = readFileSync(filePath, "utf8");
  const found = [];

  for (const pattern of SECRET_PATTERNS) {
    if (content.includes(pattern)) {
      found.push(pattern);
    }
  }

  return found;
}

/**
 * Main scanner
 */
function main() {
  console.log("🔍 Scanning Next.js client bundles for leaked secrets...\n");

  let totalFiles = 0;
  let leaksFound = false;
  const leakReport = [];

  for (const dir of SCAN_DIRS) {
    for (const filePath of walkDir(dir)) {
      totalFiles++;
      const secrets = scanFile(filePath);
      if (secrets.length > 0) {
        leaksFound = true;
        leakReport.push({ file: filePath, secrets });
      }
    }
  }

  if (leaksFound) {
    console.error("❌ SECRET LEAK DETECTED!\n");
    for (const { file, secrets } of leakReport) {
      console.error(`  File: ${file}`);
      console.error(`  Leaked: ${secrets.join(", ")}\n`);
    }
    console.error(
      "Fix: Ensure lib/engine/prompts.ts and lib/config.ts have 'import \"server-only\"' at the top."
    );
    console.error(
      "     Verify no client components import these modules (directly or transitively).\n"
    );
    process.exit(1);
  }

  console.log(`✅ No secrets found in ${totalFiles} client bundle files.`);
  console.log("   Prompt isolation is intact.\n");
  process.exit(0);
}

main();
