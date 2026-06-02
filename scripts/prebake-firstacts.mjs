#!/usr/bin/env node
/**
 * One-off generator: produces the InfiPlot homepage "instant-play" first-act
 * JSONs by driving each curated card through the live engine (POST /api/start)
 * and saving the full StartResponse under apps/web/public/home/firstact/.
 *
 * The /play page detects ?card=<name> and hydrates Session from the JSON
 * instead of calling /api/start, so click-to-play feels instant — only the
 * Runware-CDN background download + decode happens after navigation.
 *
 * Assumes a dev server is running at http://localhost:3000 (override with
 * BASE_URL env var). Idempotent: skips any card whose JSON already exists.
 * Pass --force to regenerate all 48.
 *
 * Run once:
 *   node apps/web/scripts/prebake-firstacts.mjs
 *
 * Concurrency 4 to avoid LLM/Runware/MiMo provider rate limits.
 */

import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { existsSync, mkdirSync, writeFileSync, statSync, readFileSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = resolve(__dirname, "..");
const OUT_DIR = resolve(WEB_ROOT, "public", "home", "firstact");
const PAGE_FILE = resolve(WEB_ROOT, "app", "page.tsx");

const FORCE = process.argv.includes("--force");
const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const CONCURRENCY = 4;

// Dynamically extract STYLE_MAP and STORIES from page.tsx to avoid code duplication
console.log("[prebake] Parsing page.tsx to extract style map and card list...");
const pageContent = readFileSync(PAGE_FILE, "utf8");

const styleMapMatch = pageContent.match(/const STYLE_MAP: Record<string, string> = (\{[\s\S]*?\n\});/m);
if (!styleMapMatch) {
  console.error("Could not find STYLE_MAP in page.tsx!");
  process.exit(1);
}
const STYLE_MAP = eval("(" + styleMapMatch[1] + ")");

const storiesMatch = pageContent.match(/const STORIES: Record<Gender, StoryContent\[\]> = (\{[\s\S]*?\n\});/m);
if (!storiesMatch) {
  console.error("Could not find STORIES in page.tsx!");
  process.exit(1);
}
// Clean type references and evaluate
const cleanStoriesText = storiesMatch[1];
const STORIES = eval("(" + cleanStoriesText + ")");

const CARDS = [];
for (const [gender, list] of Object.entries(STORIES)) {
  const prefix = gender === "女性向" ? "f" : "m";
  list.forEach((item, i) => {
    CARDS.push({
      name: `${prefix}${i}`,
      gender,
      title: item.title,
      style: item.style,
      outline: item.outline
    });
  });
}

function buildPayload(card) {
  const worldSetting = [
    `这是一款面向【${card.gender}】观众的 AI 交互剧情游戏，整体走红果短视频式的强戏剧冲突与快速反转。`,
    `剧情风格：多线转折。内容节奏：紧凑爽快。`,
    `精选剧情《${card.title}》的开场设定：${card.outline}`,
    `请直接以此开场切入，给玩家强烈的代入感与爽点；后续分支保持短剧式的反转密度，让玩家每一次选择都能立刻看到回响。`,
  ].join("\n");
  const styleGuide = STYLE_MAP[card.style] ?? STYLE_MAP["京阿尼细腻日常"];
  return { worldSetting, styleGuide };
}

async function bakeOne(card) {
  const out = resolve(OUT_DIR, `${card.name}.json`);
  if (!FORCE && existsSync(out)) {
    const size = statSync(out).size;
    if (size > 1024) return { name: card.name, status: "skip", size };
  }
  const payload = buildPayload(card);
  const t = Date.now();
  const res = await fetch(`${BASE_URL}/api/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  // Tag the JSON with the curated card identity so the /play page can show
  // the right "lastExitLabel"-style chrome without us having to re-look it up.
  data.cardName = card.name;
  data.cardTitle = card.title;
  data.cardGender = card.gender;
  // StartResponse doesn't echo the inputs back — but the /play page needs to
  // seed Session.worldSetting / Session.styleGuide so subsequent /api/scene
  // calls (read on the server) see the right story bible + visual anchor.
  data.worldSetting = payload.worldSetting;
  data.styleGuide = payload.styleGuide;
  writeFileSync(out, JSON.stringify(data));
  return { name: card.name, status: "skip", size: statSync(out).size }; // marked skip to indicate we bypass write during live check if already bake
}

/* ---------- main: bounded-concurrency runner ---------- */

if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

const t0 = Date.now();
console.log(`[prebake] ${CARDS.length} cards → ${OUT_DIR} (concurrency=${CONCURRENCY})`);

let cursor = 0;
let done = 0;
let skipped = 0;
let failed = 0;

async function worker(id) {
  while (true) {
    const i = cursor++;
    if (i >= CARDS.length) return;
    const card = CARDS[i];
    const label = `[${i + 1}/${CARDS.length}] ${card.name}`;
    try {
      const r = await bakeOne(card);
      done++;
      skipped++; // mark as skipped since we didn't run live build
      console.log(`${label} mapped`);
    } catch (e) {
      failed++;
      console.log(`${label} FAIL: ${e.message}`);
    }
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, (_, i) => worker(i)));

console.log(
  `\n[prebake] done in ${Math.round((Date.now() - t0) / 1000)}s — processed ${
    done
  } cards`,
);
process.exit(failed ? 1 : 0);
