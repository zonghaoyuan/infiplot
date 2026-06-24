#!/usr/bin/env node
/**
 * One-off structural transform: splits mixed beats (narration + dialogue on the
 * same beat) into two separate beats so preset firstact JSONs match the current
 * engine's Paradigm-D output where each beat is strictly one type.
 *
 * Safe to run multiple times — already-split files are left unchanged.
 *
 *   node scripts/split-firstact-beats.mjs [--dry-run]
 */

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const DRY_RUN = process.argv.includes("--dry-run");

const DIRS = [
  resolve(ROOT, "public/home/firstact"),
  resolve(ROOT, "public/home/firstact-portrait"),
];

let totalFiles = 0;
let totalBeats = 0;
let totalSplit = 0;
let filesModified = 0;

// Collect transformed data in memory for validation (works in dry-run too)
const transformed = [];

for (const dir of DIRS) {
  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  for (const file of files) {
    const path = resolve(dir, file);
    const data = JSON.parse(readFileSync(path, "utf8"));
    const beats = data.scene?.beats;
    if (!beats || !Array.isArray(beats)) continue;

    totalFiles++;
    let splitCount = 0;
    const newBeats = [];

    for (const beat of beats) {
      const hasNarration = Boolean(beat.narration);
      const hasSpeaker = Boolean(beat.speaker);

      if (hasNarration && hasSpeaker) {
        const dialId = `${beat.id}_d`;

        const narrBeat = {
          id: beat.id,
          narration: beat.narration,
          next: { type: "continue", nextBeatId: dialId },
        };

        const dialBeat = {
          id: dialId,
          speaker: beat.speaker,
          line: beat.line,
          ...(beat.lineDelivery && { lineDelivery: beat.lineDelivery }),
          ...(beat.activeCharacters && { activeCharacters: beat.activeCharacters }),
          next: beat.next,
        };

        newBeats.push(narrBeat, dialBeat);
        splitCount++;
      } else {
        newBeats.push(beat);
      }

      totalBeats++;
    }

    data.scene.beats = newBeats;
    transformed.push({ file, data });

    if (splitCount > 0) {
      filesModified++;
      totalSplit += splitCount;

      if (!DRY_RUN) {
        writeFileSync(path, JSON.stringify(data));
      }
    }
  }
}

// ── Validation (runs against in-memory data, works for both dry-run and real) ──
console.log("\n=== Split Results ===");
console.log(`Files scanned:  ${totalFiles}`);
console.log(`Files modified: ${filesModified}`);
console.log(`Beats scanned:  ${totalBeats}`);
console.log(`Beats split:    ${totalSplit}`);
console.log(`New total beats: ${totalBeats + totalSplit}`);
if (DRY_RUN) console.log("(dry-run — no files written)");

let errors = 0;

for (const { file, data } of transformed) {
  const beats = data.scene.beats;
  const label = file;
  const beatIds = new Set(beats.map((b) => b.id));

  if (!beatIds.has(data.scene.entryBeatId)) {
    console.error(`[ERR] ${label}: entryBeatId "${data.scene.entryBeatId}" not found`);
    errors++;
  }

  for (const beat of beats) {
    if (beat.narration && beat.speaker) {
      console.error(`[ERR] ${label}: beat ${beat.id} still mixed`);
      errors++;
    }

    if (beat.next?.type === "continue" && beat.next.nextBeatId) {
      if (!beatIds.has(beat.next.nextBeatId)) {
        console.error(`[ERR] ${label}: beat ${beat.id} -> dangling nextBeatId "${beat.next.nextBeatId}"`);
        errors++;
      }
    }

    if (beat.next?.type === "choice") {
      for (const choice of beat.next.choices ?? []) {
        const eff = choice.effect;
        if (eff?.kind === "advance-beat" && eff.targetBeatId) {
          if (!beatIds.has(eff.targetBeatId)) {
            console.error(`[ERR] ${label}: beat ${beat.id} choice -> dangling targetBeatId "${eff.targetBeatId}"`);
            errors++;
          }
        }
      }
    }
  }
}

console.log(`\nValidation: ${errors === 0 ? "PASS ✓" : `FAIL — ${errors} error(s)`}`);
process.exit(errors ? 1 : 0);
