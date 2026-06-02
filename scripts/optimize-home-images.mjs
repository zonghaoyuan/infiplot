#!/usr/bin/env node
/**
 * Compresses the freshly generated public/home/*.png into much
 * smaller .webp files alongside them, then deletes the originals.
 * Crops each image to a 4:5 vertical aspect ratio (matching the homepage
 * StoryCard layout in app/page.tsx) using sharp's smart-attention cover
 * strategy, so the most salient subject stays in frame. Output webps
 * target 960×1200 at quality 78.
 */

import { readdirSync, statSync, unlinkSync } from "node:fs";
import { resolve, dirname, extname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIR = resolve(__dirname, "..", "public", "home");

// 4:5 final, 1200 long edge → 960×1200
const TARGET_W = 960;
const TARGET_H = 1200;
const QUALITY = 78;

const files = readdirSync(DIR).filter((f) => f.toLowerCase().endsWith(".png"));
let totalIn = 0;
let totalOut = 0;

for (const f of files) {
  const inPath = resolve(DIR, f);
  const outPath = resolve(DIR, basename(f, extname(f)) + ".webp");
  const inSize = statSync(inPath).size;
  totalIn += inSize;

  await sharp(inPath)
    .resize({
      width: TARGET_W,
      height: TARGET_H,
      fit: "cover",
      position: sharp.strategy.attention,
    })
    .webp({ quality: QUALITY, effort: 5 })
    .toFile(outPath);
  const outSize = statSync(outPath).size;
  totalOut += outSize;
  console.log(`${f.padEnd(16)} ${(inSize / 1024).toFixed(0).padStart(5)} KB → ${(outSize / 1024).toFixed(0).padStart(4)} KB`);
  unlinkSync(inPath);
}

console.log(
  `\nTotal: ${(totalIn / 1024 / 1024).toFixed(1)} MB → ${(totalOut / 1024 / 1024).toFixed(2)} MB`,
);
