#!/usr/bin/env node
/**
 * Localize character portrait URLs in prebaked first-act JSONs.
 *
 * Each first-act JSON carries characters[].basePortraitUrl pointing at
 * Runware CDN URLs that expire. This script downloads every portrait,
 * converts to WebP, and rewrites the JSON to point at a local static path.
 *
 * Idempotent: portraits already pointing at /home/firstportrait/ are skipped.
 * Pass --force to re-download everything.
 *
 *   node scripts/localize-firstact-portraits.mjs
 *   node scripts/localize-firstact-portraits.mjs --portrait
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
const PORTRAIT_MODE = process.argv.includes("--portrait");
const FIRSTACT_DIR = resolve(
  WEB_ROOT, "public", "home",
  PORTRAIT_MODE ? "firstact-portrait" : "firstact",
);
const OUT_DIR = resolve(
  WEB_ROOT, "public", "home",
  PORTRAIT_MODE ? "firstportrait-portrait" : "firstportrait",
);
const PUBLIC_PREFIX = PORTRAIT_MODE
  ? "/home/firstportrait-portrait/"
  : "/home/firstportrait/";
const MAX_EDGE = 768;
const QUALITY = 80;
const FORCE = process.argv.includes("--force");

if (!existsSync(FIRSTACT_DIR)) {
  console.error(`Missing ${FIRSTACT_DIR} — run prebake-firstacts.mjs first.`);
  process.exit(2);
}
if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

const files = readdirSync(FIRSTACT_DIR).filter((f) =>
  f.toLowerCase().endsWith(".json"),
);

let downloaded = 0;
let skipped = 0;
let failed = 0;
let bytesIn = 0;
let bytesOut = 0;
const t0 = Date.now();

console.log(`[portraits] ${files.length} JSONs → ${OUT_DIR}`);

for (const f of files) {
  const jsonPath = resolve(FIRSTACT_DIR, f);
  const cardName = basename(f, extname(f));

  let json;
  try {
    json = JSON.parse(readFileSync(jsonPath, "utf8"));
  } catch (e) {
    failed++;
    console.log(`${cardName} FAIL parse: ${e.message}`);
    continue;
  }

  const characters = json.characters;
  if (!Array.isArray(characters) || characters.length === 0) {
    skipped++;
    console.log(`${cardName} skip (no characters)`);
    continue;
  }

  let modified = false;

  for (let i = 0; i < characters.length; i++) {
    const char = characters[i];
    const webpName = `${cardName}_${i}.webp`;
    const localWebp = resolve(OUT_DIR, webpName);
    const localPublicPath = `${PUBLIC_PREFIX}${webpName}`;

    const currentUrl = char.basePortraitUrl ?? "";

    // Already localized
    if (
      !FORCE &&
      currentUrl.startsWith(PUBLIC_PREFIX) &&
      existsSync(localWebp)
    ) {
      skipped++;
      console.log(`${cardName}[${i}] ${char.name} skip (already local)`);
      continue;
    }

    // Determine the remote URL: either the current URL or the saved remote
    const remoteUrl =
      currentUrl.startsWith("http")
        ? currentUrl
        : char.basePortraitUrlRemote;

    if (!remoteUrl || !remoteUrl.startsWith("http")) {
      if (!currentUrl) {
        skipped++;
        console.log(`${cardName}[${i}] ${char.name} skip (no portrait)`);
      } else {
        failed++;
        console.log(
          `${cardName}[${i}] ${char.name} FAIL: no remote URL available`,
        );
      }
      continue;
    }

    const localWebpExists = existsSync(localWebp);
    const t = Date.now();

    try {
      let outSize;
      if (localWebpExists && !FORCE) {
        outSize = statSync(localWebp).size;
      } else {
        const res = await fetch(remoteUrl, { signal: AbortSignal.timeout(30_000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buf = Buffer.from(await res.arrayBuffer());
        bytesIn += buf.length;

        const img = sharp(buf);
        const meta = await img.metadata();
        const longEdge = Math.max(meta.width ?? 0, meta.height ?? 0);
        const resized =
          longEdge > MAX_EDGE
            ? img.resize({ width: MAX_EDGE, height: MAX_EDGE, fit: "inside" })
            : img;
        await resized.webp({ quality: QUALITY, effort: 5 }).toFile(localWebp);

        outSize = statSync(localWebp).size;
        bytesOut += outSize;
      }

      char.basePortraitUrl = localPublicPath;
      char.basePortraitUrlRemote = remoteUrl;
      modified = true;
      downloaded++;

      if (localWebpExists && !FORCE) {
        console.log(
          `${cardName}[${i}] ${char.name} ok (webp existed, rewrote JSON only) ${(outSize / 1024).toFixed(0)} KB`,
        );
      } else {
        console.log(
          `${cardName}[${i}] ${char.name} ok → ${(outSize / 1024).toFixed(0)} KB in ${((Date.now() - t) / 1000).toFixed(1)}s`,
        );
      }
    } catch (e) {
      failed++;
      console.log(`${cardName}[${i}] ${char.name} FAIL: ${e.message}`);
    }
  }

  if (modified) {
    writeFileSync(jsonPath, JSON.stringify(json));
  }
}

console.log(
  `\n[portraits] done in ${Math.round((Date.now() - t0) / 1000)}s — wrote ${downloaded} / skipped ${skipped} / failed ${failed}\n` +
    `[portraits] bytes ${(bytesIn / 1024 / 1024).toFixed(1)} MB → ${(bytesOut / 1024 / 1024).toFixed(2)} MB`,
);
process.exit(failed ? 1 : 0);
