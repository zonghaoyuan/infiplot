#!/usr/bin/env node
/**
 * Translate prebaked firstact JSONs to target locales using an LLM.
 *
 * Reads TEXT_BASE_URL + TEXT_API_KEY from .env.local.
 * Default model: gemini-3.5-flash (override with --model or TRANSLATE_MODEL).
 *
 * Output: public/home/firstact-{locale}/ and firstact-portrait-{locale}/
 *
 * Usage:
 *   node scripts/translate-firstacts.mjs                        # en + ja
 *   node scripts/translate-firstacts.mjs --locale=en            # en only
 *   node scripts/translate-firstacts.mjs --only=m0,f1           # specific files
 *   node scripts/translate-firstacts.mjs --force                # overwrite existing
 *   node scripts/translate-firstacts.mjs --portrait             # portrait set only
 *   node scripts/translate-firstacts.mjs --stories              # also output story titles for locale files
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");
const ENV_FILE = resolve(rootDir, ".env.local");

// ── Load .env.local ──────────────────────────────────────────────────
function loadEnv() {
  if (!existsSync(ENV_FILE)) {
    console.error("Missing .env.local — need TEXT_BASE_URL + TEXT_API_KEY");
    process.exit(1);
  }
  const lines = readFileSync(ENV_FILE, "utf8").split("\n");
  const env = {};
  for (const line of lines) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].trim();
  }
  return env;
}

const env = loadEnv();
const BASE_URL = env.TEXT_BASE_URL;
const API_KEY = env.TEXT_API_KEY;
const MODEL = process.argv.find(a => a.startsWith("--model="))?.split("=")[1]
  || env.TRANSLATE_MODEL || "gemini-3.5-flash";

if (!BASE_URL || !API_KEY) {
  console.error("TEXT_BASE_URL and TEXT_API_KEY must be set in .env.local");
  process.exit(1);
}

// ── CLI args ─────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const force = args.includes("--force");
const portraitOnly = args.includes("--portrait");
const storiesMode = args.includes("--stories");
const localeArg = args.find(a => a.startsWith("--locale="))?.split("=")[1];
const onlyArg = args.find(a => a.startsWith("--only="))?.split("=")[1];
const LOCALES = localeArg ? localeArg.split(",") : ["en", "ja"];
const ONLY = onlyArg ? new Set(onlyArg.split(",")) : null;

const LOCALE_LABELS = { en: "English", ja: "Japanese (日本語)" };

// ── LLM caller ───────────────────────────────────────────────────────
async function callLLM(system, user, retries = 3) {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(`${BASE_URL}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${API_KEY}`,
        },
        body: JSON.stringify({
          model: MODEL,
          temperature: 0.3,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
        }),
      });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`HTTP ${res.status}: ${txt.slice(0, 200)}`);
      }
      const data = await res.json();
      return data.choices?.[0]?.message?.content ?? "";
    } catch (e) {
      console.warn(`  Attempt ${attempt + 1} failed: ${e.message}`);
      if (attempt < retries - 1) await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
      else throw e;
    }
  }
}

// ── Extract translatable fields from a firstact JSON ─────────────────
function extractTranslatableTexts(data) {
  const texts = {};

  if (data.cardTitle) texts["cardTitle"] = data.cardTitle;
  if (data.cardGender) texts["cardGender"] = data.cardGender;
  if (data.worldSetting) texts["worldSetting"] = data.worldSetting;

  // scene.beats
  if (data.scene?.beats) {
    for (let i = 0; i < data.scene.beats.length; i++) {
      const b = data.scene.beats[i];
      if (b.narration) texts[`beats[${i}].narration`] = b.narration;
      if (b.speaker) texts[`beats[${i}].speaker`] = b.speaker;
      if (b.line) texts[`beats[${i}].line`] = b.line;
      if (b.lineDelivery) texts[`beats[${i}].lineDelivery`] = b.lineDelivery;
      if (b.activeCharacters) {
        for (let j = 0; j < b.activeCharacters.length; j++) {
          const ac = b.activeCharacters[j];
          if (ac.name) texts[`beats[${i}].ac[${j}].name`] = ac.name;
          if (ac.pose) texts[`beats[${i}].ac[${j}].pose`] = ac.pose;
        }
      }
      if (b.next?.choices) {
        for (let j = 0; j < b.next.choices.length; j++) {
          const c = b.next.choices[j];
          if (c.label) texts[`beats[${i}].choice[${j}].label`] = c.label;
          if (c.effect?.nextSceneSeed) texts[`beats[${i}].choice[${j}].seed`] = c.effect.nextSceneSeed;
        }
      }
    }
  }

  // characters
  if (data.characters) {
    for (let i = 0; i < data.characters.length; i++) {
      const c = data.characters[i];
      if (c.name) texts[`char[${i}].name`] = c.name;
      if (c.voiceDescription) texts[`char[${i}].voiceDescription`] = c.voiceDescription;
    }
  }

  // storyState
  if (data.storyState) {
    const ss = data.storyState;
    for (const key of ["logline", "genreTags", "protagonist", "castNotes", "synopsis", "nextHook"]) {
      if (ss[key]) texts[`ss.${key}`] = ss[key];
    }
    if (Array.isArray(ss.openThreads)) {
      for (let i = 0; i < ss.openThreads.length; i++) {
        texts[`ss.openThreads[${i}]`] = ss.openThreads[i];
      }
    }
    if (Array.isArray(ss.relationships)) {
      for (let i = 0; i < ss.relationships.length; i++) {
        texts[`ss.relationships[${i}]`] = ss.relationships[i];
      }
    }
  }

  return texts;
}

// ── Apply translated texts back to a deep-cloned firstact JSON ───────
function applyTranslations(original, translations) {
  const data = JSON.parse(JSON.stringify(original));

  if (translations["cardTitle"]) data.cardTitle = translations["cardTitle"];
  if (translations["cardGender"]) data.cardGender = translations["cardGender"];
  if (translations["worldSetting"]) data.worldSetting = translations["worldSetting"];

  if (data.scene?.beats) {
    for (let i = 0; i < data.scene.beats.length; i++) {
      const b = data.scene.beats[i];
      const p = `beats[${i}]`;
      if (translations[`${p}.narration`]) b.narration = translations[`${p}.narration`];
      if (translations[`${p}.speaker`]) b.speaker = translations[`${p}.speaker`];
      if (translations[`${p}.line`]) b.line = translations[`${p}.line`];
      if (translations[`${p}.lineDelivery`]) b.lineDelivery = translations[`${p}.lineDelivery`];
      if (b.activeCharacters) {
        for (let j = 0; j < b.activeCharacters.length; j++) {
          if (translations[`${p}.ac[${j}].name`]) b.activeCharacters[j].name = translations[`${p}.ac[${j}].name`];
          if (translations[`${p}.ac[${j}].pose`]) b.activeCharacters[j].pose = translations[`${p}.ac[${j}].pose`];
        }
      }
      if (b.next?.choices) {
        for (let j = 0; j < b.next.choices.length; j++) {
          if (translations[`${p}.choice[${j}].label`]) b.next.choices[j].label = translations[`${p}.choice[${j}].label`];
          if (translations[`${p}.choice[${j}].seed`] && b.next.choices[j].effect) {
            b.next.choices[j].effect.nextSceneSeed = translations[`${p}.choice[${j}].seed`];
          }
        }
      }
    }
  }

  if (data.characters) {
    for (let i = 0; i < data.characters.length; i++) {
      if (translations[`char[${i}].name`]) data.characters[i].name = translations[`char[${i}].name`];
      if (translations[`char[${i}].voiceDescription`]) data.characters[i].voiceDescription = translations[`char[${i}].voiceDescription`];
    }
  }

  if (data.storyState) {
    const ss = data.storyState;
    for (const key of ["logline", "genreTags", "protagonist", "castNotes", "synopsis", "nextHook"]) {
      if (translations[`ss.${key}`]) ss[key] = translations[`ss.${key}`];
    }
    if (Array.isArray(ss.openThreads)) {
      for (let i = 0; i < ss.openThreads.length; i++) {
        if (translations[`ss.openThreads[${i}]`]) ss.openThreads[i] = translations[`ss.openThreads[${i}]`];
      }
    }
    if (Array.isArray(ss.relationships)) {
      for (let i = 0; i < ss.relationships.length; i++) {
        if (translations[`ss.relationships[${i}]`]) ss.relationships[i] = translations[`ss.relationships[${i}]`];
      }
    }
  }

  return data;
}

// ── Build LLM prompt ─────────────────────────────────────────────────
function buildPrompt(texts, targetLang) {
  const system = `You are a professional literary translator for an interactive story game (visual novel / galgame). Translate the given Chinese text into ${targetLang}.

Rules:
- This is a second-person narrative game. The player character is always addressed as "you" (or the equivalent in the target language).
- Preserve the tone, mood, and literary style of each text segment.
- Character names: transliterate or adapt naturally for the target language. Keep consistency within the same story.
- Do NOT translate text that is already in English (e.g. style descriptions, technical terms).
- For "voiceDescription" fields, translate the description but keep the voice acting direction style.
- For "worldSetting", translate the content but preserve any bracketed meta-instructions like 【男性向】.
- For "cardGender": 男性向→"Male-oriented"(en)/"男性向け"(ja), 女性向→"Female-oriented"(en)/"女性向け"(ja)
- Return ONLY a valid JSON object with the same keys mapping to translated values. No explanation.`;

  const user = `Translate these Chinese texts to ${targetLang}. Return a JSON object with the same keys:\n\n${JSON.stringify(texts, null, 2)}`;

  return { system, user };
}

// ── Parse LLM response ───────────────────────────────────────────────
function parseResponse(raw) {
  let cleaned = raw.trim();
  // Strip markdown code fences
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
  }
  return JSON.parse(cleaned);
}

// ── Concurrency pool ─────────────────────────────────────────────────
const CONCURRENCY = parseInt(process.env.TRANSLATE_CONCURRENCY || "10", 10);

async function runPool(tasks, concurrency) {
  const results = [];
  let idx = 0;
  async function worker() {
    while (idx < tasks.length) {
      const i = idx++;
      results[i] = await tasks[i]();
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker()));
  return results;
}

// ── Main ─────────────────────────────────────────────────────────────
async function main() {
  const dirs = portraitOnly
    ? [{ src: "firstact-portrait", suffix: "-portrait" }]
    : [
        { src: "firstact", suffix: "" },
        { src: "firstact-portrait", suffix: "-portrait" },
      ];

  const storyTitles = {}; // locale → { m0: { title, outline }, ... }

  for (const locale of LOCALES) {
    storyTitles[locale] = {};
    const langLabel = LOCALE_LABELS[locale] || locale;

    // Collect all translation tasks across dirs, then run in parallel
    const tasks = [];

    for (const { src, suffix } of dirs) {
      const srcDir = join(rootDir, "public/home", src);
      const outDir = join(rootDir, `public/home/${src}-${locale}`);
      mkdirSync(outDir, { recursive: true });

      const files = readdirSync(srcDir).filter(f => f.endsWith(".json")).sort();

      for (const file of files) {
        const name = file.replace(".json", "");
        if (ONLY && !ONLY.has(name)) continue;

        const outPath = join(outDir, file);
        if (!force && existsSync(outPath)) {
          console.log(`  [skip] ${src}-${locale}/${file} (exists)`);
          if (suffix === "") {
            try {
              const existing = JSON.parse(readFileSync(outPath, "utf8"));
              if (existing.cardTitle) {
                storyTitles[locale][name] = { title: existing.cardTitle };
              }
            } catch { /* ignore */ }
          }
          continue;
        }

        const srcPath = join(srcDir, file);
        const data = JSON.parse(readFileSync(srcPath, "utf8"));
        const texts = extractTranslatableTexts(data);
        const textCount = Object.keys(texts).length;

        if (textCount === 0) {
          console.log(`  [skip] ${src}-${locale}/${file} (no Chinese text)`);
          writeFileSync(outPath, JSON.stringify(data));
          continue;
        }

        // Queue the translation as a task
        tasks.push(async () => {
          console.log(`  [translate] ${src}-${locale}/${file} (${textCount} fields)...`);
          try {
            const { system, user } = buildPrompt(texts, langLabel);
            const raw = await callLLM(system, user);
            const translated = parseResponse(raw);

            const returnedKeys = Object.keys(translated);
            const coverage = returnedKeys.length / textCount;
            if (coverage < 0.5) {
              console.warn(`    ⚠ ${file}: low coverage (${(coverage * 100).toFixed(0)}%), retrying...`);
              const raw2 = await callLLM(system, user);
              const translated2 = parseResponse(raw2);
              Object.assign(translated, translated2);
            }

            const result = applyTranslations(data, translated);
            writeFileSync(outPath, JSON.stringify(result));
            console.log(`    ✓ ${file}: ${returnedKeys.length}/${textCount} fields`);

            if (suffix === "" && result.cardTitle) {
              storyTitles[locale][name] = { title: result.cardTitle };
            }
          } catch (e) {
            console.error(`    ✗ ${file}: ${e.message}`);
          }
        });
      }
    }

    if (tasks.length > 0) {
      console.log(`\n[${locale}] Translating ${tasks.length} files (concurrency: ${CONCURRENCY})...`);
      await runPool(tasks, CONCURRENCY);
    }
  }

  // Output story titles summary
  if (storiesMode || Object.values(storyTitles).some(v => Object.keys(v).length > 0)) {
    console.log("\n=== Story Titles for Locale Files ===");
    for (const [locale, titles] of Object.entries(storyTitles)) {
      console.log(`\n${locale}:`);
      for (const [name, data] of Object.entries(titles).sort()) {
        console.log(`  "${name}": "${data.title}",`);
      }
    }
  }

  console.log("\nDone!");
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
