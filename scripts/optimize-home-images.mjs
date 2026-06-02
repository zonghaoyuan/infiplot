#!/usr/bin/env node
/**
 * Compresses the freshly generated public/home/*.png into much
 * smaller .webp files alongside them, then deletes the originals.
 * Output webps target ~1200px on the long edge and quality 78.
 */

import { readdirSync, statSync, unlinkSync } from "node:fs";
import { resolve, dirname, extname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIR = resolve(__dirname, "..", "public", "home");

const MAX_EDGE = 1200;
const QUALITY = 78;

const files = readdirSync(DIR).filter((f) => f.toLowerCase().endsWith(".png"));
let totalIn = 0;
let totalOut = 0;

for (const f of files) {
  const inPath = resolve(DIR, f);
  const outPath = resolve(DIR, basename(f, extname(f)) + ".webp");
  const inSize = statSync(inPath).size;
  totalIn += inSize;

  const img = sharp(inPath);
  const meta = await img.metadata();
  const longEdge = Math.max(meta.width ?? 0, meta.height ?? 0);
  const resized = longEdge > MAX_EDGE ? img.resize({ width: meta.width >= meta.height ? MAX_EDGE : undefined, height: meta.height > meta.width ? MAX_EDGE : undefined }) : img;
  await resized.webp({ quality: QUALITY, effort: 5 }).toFile(outPath);
  const outSize = statSync(outPath).size;
  totalOut += outSize;
  console.log(`${f.padEnd(16)} ${(inSize / 1024).toFixed(0).padStart(5)} KB → ${(outSize / 1024).toFixed(0).padStart(4)} KB`);
  unlinkSync(inPath);
}

console.log(
  `\nTotal: ${(totalIn / 1024 / 1024).toFixed(1)} MB → ${(totalOut / 1024 / 1024).toFixed(2)} MB`,
);
