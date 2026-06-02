#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { readFileSync, writeFileSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = resolve(__dirname, "..");
const ENV_FILE = resolve(WEB_ROOT, ".env.local");
const PAGE_FILE = resolve(WEB_ROOT, "app", "page.tsx");

/* ---------- env loading ---------- */
function loadEnv(path) {
  const txt = readFileSync(path, "utf8");
  const env = {};
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const k = line.slice(0, eq).trim();
    let v = line.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    env[k] = v;
  }
  return env;
}

const env = loadEnv(ENV_FILE);
const BASE_URL = env.TEXT_BASE_URL;
const API_KEY = env.TEXT_API_KEY;
const MODEL = env.TEXT_MODEL;

if (!BASE_URL || !API_KEY || !MODEL) {
  console.error("Missing TEXT_BASE_URL / TEXT_API_KEY / TEXT_MODEL in", ENV_FILE);
  process.exit(2);
}

const SYSTEM_PROMPT = `你是一个网络小说与微短剧标签分类专家。
请根据给定的故事列表（包含标题、简介和风格），为每个故事贴上 2 到 3 个最契合的网文/短剧中文标签标签。
常见的标签分类例如：
- 核心设定：系统、重生、穿越、异能、修仙、魔法、读心术、金手指、空间、神医、兵王
- 核心爽点：逆袭、打脸、爽文、甜宠、虐渣、虐心、逆袭、赘婿、装逼、扮猪吃虎
- 题材分类：都市玄幻、都市爱情、古风言情、科幻废土、暗黑童话、悬疑烧脑、豪门恩怨、校园日常

要求：
- 请严格返回 JSON 格式，包含 "男性向" 数组和 "女性向" 数组，且结构与输入的一致，但每个对象增加 "tags" 字段（包含 2-3 个小标签，例如 ["都市爱情", "系统", "逆袭"]）。
- 不要返回任何 markdown 标记包裹的文本，只返回纯合法的 JSON 字符串。
- 确保元素数量和顺序与输入 100% 一致。`;

async function main() {
  console.log("[tags] Reading page.tsx...");
  let pageContent = readFileSync(PAGE_FILE, "utf8");

  // Extract STORIES
  const storiesMatch = pageContent.match(/const STORIES: Record<Gender, StoryContent\[\]> = (\{[\s\S]*?\n\});/m);
  if (!storiesMatch) {
    console.error("Could not find STORIES in page.tsx!");
    process.exit(1);
  }
  
  const STORIES = eval("(" + storiesMatch[1] + ")");
  console.log("[tags] Extracted STORIES. Male count:", STORIES["男性向"]?.length, "Female count:", STORIES["女性向"]?.length);

  console.log("[tags] Calling LLM API to generate tag pills for all stories...");
  const t0 = Date.now();
  const url = BASE_URL.replace(/\/$/, "") + "/chat/completions";
  
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${API_KEY}`
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `请为以下故事列表批量生成标签，并以 JSON 格式输出：\n${JSON.stringify(STORIES, null, 2)}` }
      ],
      temperature: 0.5,
      response_format: { type: "json_object" }
    })
  });

  if (!res.ok) {
    const txt = await res.text();
    console.error(`HTTP error ${res.status}: ${txt}`);
    process.exit(1);
  }

  const data = await res.json();
  const rawText = data.choices?.[0]?.message?.content;
  if (!rawText) {
    console.error("No content in LLM response", JSON.stringify(data));
    process.exit(1);
  }

  let parsed;
  try {
    const cleanJsonText = rawText.replace(/^```json\s*/i, "").replace(/```$/, "").trim();
    parsed = JSON.parse(cleanJsonText);
  } catch (e) {
    console.error("Failed to parse JSON from LLM output. Raw content:\n", rawText);
    process.exit(1);
  }

  if (!parsed["男性向"] || !parsed["女性向"] || parsed["男性向"].length !== 24 || parsed["女性向"].length !== 24) {
    console.error("Invalid output structure or item count mismatch. Male count:", parsed["男性向"]?.length, "Female count:", parsed["女性向"]?.length);
    process.exit(1);
  }

  console.log(`[tags] Successfully generated tags in ${((Date.now() - t0)/1000).toFixed(1)}s.`);

  // Write new STORIES constant to apps/web/app/page.tsx
  const storiesString = `const STORIES: Record<Gender, StoryContent[]> = {
  男性向: ${JSON.stringify(parsed["男性向"], null, 2)},
  女性向: ${JSON.stringify(parsed["女性向"], null, 2)}
};`;

  pageContent = pageContent.replace(storiesMatch[0], storiesString);
  
  // Make sure StoryContent type includes tags in page.tsx
  pageContent = pageContent.replace(
    "type StoryContent = { title: string; outline: string; style: string };",
    "type StoryContent = { title: string; outline: string; style: string; tags: string[] };"
  );

  writeFileSync(PAGE_FILE, pageContent, "utf8");
  console.log("[tags] Successfully updated page.tsx with the stories including tags!");
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
