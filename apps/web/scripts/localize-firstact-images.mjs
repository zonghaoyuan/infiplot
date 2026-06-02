#!/usr/bin/env node
/**
 * Post-process for prebake-firstacts: each first-act JSON has imageUrl pointing
 * at https://im.runware.ai/... which adds ~1-2s of remote-CDN download on first
 * click. This script downloads every imageUrl to apps/web/public/home/firstscene/
 * (webp, compressed) and rewrites the JSON's imageUrl to the local /home/...
 * path, so click-to-play is bottlenecked only by JSON parse + local image
 * decode (sub-100ms).
 *
 * Idempotent: a JSON whose imageUrl already points at /home/firstscene/ is
 * skipped. Pass --force to re-download everything.
 *
 * Run once after prebake-firstacts.mjs completes:
 *   node apps/web/scripts/localize-firstact-images.mjs
 */

import { fileURLToPath } from "node:url";
import { dirname, resolve, basename, extname } from "node:path";
import {
  existsSync,
  mkdirSync,
  writeFileSync,
  statSync,
  readdirSync,
  readFileSync,
} from "node:fs";
import sharp from "sharp";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = resolve(__dirname, "..");
const FIRSTACT_DIR = resolve(WEB_ROOT, "public", "home", "firstact");
const FIRSTSCENE_DIR = resolve(WEB_ROOT, "public", "home", "firstscene");
const PUBLIC_LOCAL_PREFIX = "/home/firstscene/";
const MAX_EDGE = 1600;
const QUALITY = 80;

const FORCE = process.argv.includes("--force");

if (!existsSync(FIRSTACT_DIR)) {
  console.error(`Missing ${FIRSTACT_DIR} — run prebake-firstacts.mjs first.`);
  process.exit(2);
}
if (!existsSync(FIRSTSCENE_DIR)) mkdirSync(FIRSTSCENE_DIR, { recursive: true });

const files = readdirSync(FIRSTACT_DIR).filter((f) => f.toLowerCase().endsWith(".json"));
let downloaded = 0;
let skipped = 0;
let failed = 0;
let bytesIn = 0;
let bytesOut = 0;
const t0 = Date.now();

console.log(`[localize] ${files.length} JSONs → ${FIRSTSCENE_DIR}`);

for (const f of files) {
  const jsonPath = resolve(FIRSTACT_DIR, f);
  const name = basename(f, extname(f)); // m0, f31, etc.
  const localWebp = resolve(FIRSTSCENE_DIR, `${name}.webp`);
  const localPublicPath = `${PUBLIC_LOCAL_PREFIX}${name}.webp`;

  let json;
  try {
    json = JSON.parse(readFileSync(jsonPath, "utf8"));
  } catch (e) {
    failed++;
    console.log(`${name} FAIL parse: ${e.message}`);
    continue;
  }

  const url = json.imageUrl;
  if (!url) {
    failed++;
    console.log(`${name} FAIL: no imageUrl in JSON`);
    continue;
  }

  if (!FORCE && url.startsWith(PUBLIC_LOCAL_PREFIX) && existsSync(localWebp)) {
    skipped++;
    console.log(`${name} skip (already local)`);
    continue;
  }

  if (!url.startsWith("http")) {
    failed++;
    console.log(`${name} FAIL: imageUrl not http(s): ${url.slice(0, 60)}`);
    continue;
  }

  const t = Date.now();
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    bytesIn += buf.length;

    // Downscale to 1600px long edge (Runware paints at 1792×1024 by default —
    // the player canvas never needs more than ~1200-1600). Then webp 80.
    const img = sharp(buf);
    const meta = await img.metadata();
    const longEdge = Math.max(meta.width ?? 0, meta.height ?? 0);
    const resized = longEdge > MAX_EDGE
      ? img.resize({
          width: (meta.width ?? 0) >= (meta.height ?? 0) ? MAX_EDGE : undefined,
          height: (meta.height ?? 0) > (meta.width ?? 0) ? MAX_EDGE : undefined,
        })
      : img;
    await resized.webp({ quality: QUALITY, effort: 5 }).toFile(localWebp);

    const outSize = statSync(localWebp).size;
    bytesOut += outSize;
    json.imageUrl = localPublicPath;
    json.imageUrlRemote = url; // keep the Runware URL around for forensics
    writeFileSync(jsonPath, JSON.stringify(json));
    downloaded++;
    console.log(
      `${name} ok ${(buf.length / 1024).toFixed(0)} KB → ${(outSize / 1024).toFixed(0)} KB in ${((Date.now() - t) / 1000).toFixed(1)}s`,
    );
  } catch (e) {
    failed++;
    console.log(`${name} FAIL: ${e.message}`);
  }
}

console.log(
  `\n[localize] done in ${Math.round((Date.now() - t0) / 1000)}s — wrote ${downloaded} / skipped ${skipped} / failed ${failed}\n` +
    `[localize] bytes ${(bytesIn / 1024 / 1024).toFixed(1)} MB → ${(bytesOut / 1024 / 1024).toFixed(2)} MB`,
);
process.exit(failed ? 1 : 0);
