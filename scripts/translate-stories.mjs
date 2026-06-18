#!/usr/bin/env node
/**
 * Translate STORIES_BASE card data (title, outline, style, tags) and write
 * the translations into lib/i18n/locales/{en,ja}.ts as a `stories` section.
 *
 * Reads the same TEXT_* env vars as translate-firstacts.mjs.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");
const ENV_FILE = resolve(rootDir, ".env.local");

function loadEnv() {
  if (!existsSync(ENV_FILE)) {
    console.error("Missing .env.local");
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

async function callLLM(system, user, retries = 3) {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(`${BASE_URL}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${API_KEY}` },
        body: JSON.stringify({
          model: MODEL, temperature: 0.3,
          messages: [{ role: "system", content: system }, { role: "user", content: user }],
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const data = await res.json();
      return data.choices?.[0]?.message?.content ?? "";
    } catch (e) {
      console.warn(`  Attempt ${attempt + 1} failed: ${e.message}`);
      if (attempt < retries - 1) await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
      else throw e;
    }
  }
}

function parseResponse(raw) {
  let cleaned = raw.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
  }
  return JSON.parse(cleaned);
}

// Extract STORIES_BASE from page.tsx using a simple parser
function extractStories() {
  const pagePath = join(rootDir, "app/[locale]/page.tsx");
  const src = readFileSync(pagePath, "utf8");

  // Find the STORIES_BASE definition and extract male/female arrays
  const stories = { male: [], female: [] };
  const genders = ["男性向", "女性向"];

  for (const gender of genders) {
    const key = gender === "男性向" ? "male" : "female";
    // Find all story objects for this gender
    const regex = /\{\s*"title":\s*"([^"]+)",\s*"outline":\s*"([^"]+)",\s*"style":\s*"([^"]+)",\s*"tags":\s*\[([\s\S]*?)\]\s*\}/g;

    // Find the section start
    const sectionStart = src.indexOf(`${gender}: [`);
    if (sectionStart === -1) continue;

    // Find the matching end bracket
    let depth = 0;
    let sectionEnd = sectionStart;
    const startBracket = src.indexOf('[', sectionStart);
    for (let i = startBracket; i < src.length; i++) {
      if (src[i] === '[') depth++;
      if (src[i] === ']') depth--;
      if (depth === 0) { sectionEnd = i + 1; break; }
    }

    const section = src.slice(sectionStart, sectionEnd);
    let match;
    while ((match = regex.exec(section)) !== null) {
      const tags = match[4].split(",").map(t => t.trim().replace(/^"|"$/g, "")).filter(Boolean);
      stories[key].push({ title: match[1], outline: match[2], style: match[3], tags });
    }
  }

  console.log(`Extracted ${stories.male.length} male + ${stories.female.length} female stories`);
  return stories;
}

async function translateStories(stories, targetLocale, targetLang) {
  // Flatten into a translatable map
  const texts = {};
  for (const [gender, items] of Object.entries(stories)) {
    const prefix = gender === "male" ? "m" : "f";
    for (let i = 0; i < items.length; i++) {
      const s = items[i];
      texts[`${prefix}${i}.title`] = s.title;
      texts[`${prefix}${i}.outline`] = s.outline;
      texts[`${prefix}${i}.style`] = s.style;
      for (let j = 0; j < s.tags.length; j++) {
        texts[`${prefix}${i}.tags[${j}]`] = s.tags[j];
      }
    }
  }

  const system = `You are a professional game translator. Translate the given Chinese text to ${targetLang}.

Rules:
- "title" fields are story titles — keep them evocative and concise (2-5 words).
- "outline" fields are story synopses — translate naturally, preserve dramatic tone.
- "style" fields are visual art style descriptions — translate descriptively, keep parenthetical English terms.
- "tags" fields are short genre/theme tags — use standard genre terminology in the target language.
- For "cardGender": 男性向→"Male-oriented"(en)/"男性向け"(ja), 女性向→"Female-oriented"(en)/"女性向け"(ja)
- Return ONLY a valid JSON object with the same keys. No explanation.`;

  console.log(`Translating ${Object.keys(texts).length} story fields to ${targetLocale}...`);

  // Split into batches of ~80 keys to stay within token limits
  const keys = Object.keys(texts);
  const batchSize = 80;
  const allTranslated = {};

  for (let i = 0; i < keys.length; i += batchSize) {
    const batch = {};
    for (const k of keys.slice(i, i + batchSize)) {
      batch[k] = texts[k];
    }
    const user = `Translate to ${targetLang}:\n\n${JSON.stringify(batch, null, 2)}`;
    const raw = await callLLM(system, user);
    const result = parseResponse(raw);
    Object.assign(allTranslated, result);
    console.log(`  Batch ${Math.floor(i / batchSize) + 1}: ${Object.keys(result).length} fields`);
    if (i + batchSize < keys.length) await new Promise(r => setTimeout(r, 500));
  }

  return allTranslated;
}

function buildStoriesObject(translated, stories) {
  const result = { male: [], female: [] };
  for (const [gender, items] of Object.entries(stories)) {
    const prefix = gender === "male" ? "m" : "f";
    for (let i = 0; i < items.length; i++) {
      const s = items[i];
      const entry = {
        title: translated[`${prefix}${i}.title`] || s.title,
        outline: translated[`${prefix}${i}.outline`] || s.outline,
        style: translated[`${prefix}${i}.style`] || s.style,
        tags: s.tags.map((_, j) => translated[`${prefix}${i}.tags[${j}]`] || s.tags[j]),
      };
      result[gender].push(entry);
    }
  }
  return result;
}

function injectIntoLocaleFile(localePath, storiesData) {
  let content = readFileSync(localePath, "utf8");

  // Build the stories object as a TS string
  const lines = [`  stories: {`];
  for (const [gender, items] of Object.entries(storiesData)) {
    lines.push(`    ${gender}: [`);
    for (const item of items) {
      const tagsStr = item.tags.map(t => `"${t.replace(/"/g, '\\"')}"`).join(", ");
      lines.push(`      { title: "${item.title.replace(/"/g, '\\"')}", outline: "${item.outline.replace(/"/g, '\\"')}", style: "${item.style.replace(/"/g, '\\"')}", tags: [${tagsStr}] },`);
    }
    lines.push(`    ],`);
  }
  lines.push(`    genderLabels: { male: ${gender === "en" ? '"Male-oriented"' : '"男性向け"'}, female: ${gender === "en" ? '"Female-oriented"' : '"女性向け"'} },`);
  lines.push(`  },`);

  // Find the closing of the main export and insert before it
  // Look for the last `};` or `} as const;`
  const insertPoint = content.lastIndexOf("};");
  if (insertPoint === -1) {
    console.error(`Could not find insertion point in ${localePath}`);
    return;
  }

  content = content.slice(0, insertPoint) + lines.join("\n") + "\n" + content.slice(insertPoint);
  writeFileSync(localePath, content);
  console.log(`Injected stories into ${localePath}`);
}

async function main() {
  const stories = extractStories();
  if (stories.male.length === 0 && stories.female.length === 0) {
    console.error("No stories extracted from page.tsx");
    process.exit(1);
  }

  const locales = [
    { code: "en", lang: "English", file: "en.ts" },
    { code: "ja", lang: "Japanese (日本語)", file: "ja.ts" },
  ];

  for (const { code, lang, file } of locales) {
    const translated = await translateStories(stories, code, lang);
    const storiesData = buildStoriesObject(translated, stories);

    // Write as standalone JSON for reference
    const outPath = join(rootDir, `lib/i18n/stories-${code}.json`);
    writeFileSync(outPath, JSON.stringify(storiesData, null, 2));
    console.log(`Wrote ${outPath}`);
  }

  console.log("\nDone! Stories JSON files written to lib/i18n/stories-{en,ja}.json");
  console.log("These will be loaded dynamically in the page component.");
}

main().catch(e => { console.error(e); process.exit(1); });
