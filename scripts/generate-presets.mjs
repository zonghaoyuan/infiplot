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

const STYLES = [
  "古典厚涂油画 (学术奇幻)",
  "极简中国水墨 (Image 0参考升级版)",
  "浮世绘",
  "莫高窟壁画风 (敦煌学)",
  "镶嵌画 (拜占庭/马赛克)",
  "彩绘玻璃 (哥特风)",
  "吉卜力治愈手绘",
  "京阿尼细腻日常",
  "新海诚唯美光影 (Image 2参考)",
  "赛博朋克 / 赛璐珞二次元",
  "Galgame CG 梦幻光影",
  "3D 动漫电影质感",
  "蒸汽波 (Vaporwave) 赛璐珞",
  "波普艺术 (Pop Art)",
  "故障艺术 (Glitch Art)",
  "剪纸艺术 (Papercut)",
  "科幻：太阳朋克 (Solar Punk)",
  "奇幻：爱手艺 (Lovecraftian Horror)",
  "现代惊悚：霓虹剪影 (Urban Noir)",
  "温馨推理：英式村庄 (Cozy Mystery)",
  "哥特言情：庄园废墟 (Gothic Romance)",
  "格林童话：暗黑森林 (Fairytale Noir)",
  "废土科幻 (Post-Apocalyptic)",
  "都市幻想：隐形世界 (Urban Fantasy)"
];

const SYSTEM_PROMPT = `你是一个顶级互动式视觉小说剧情策划和爆款短剧编剧。
你精通各种网文爽点与戏剧冲突冲突（例如：战神归来、赘婿亮剑、系统觉醒、都市异能、白月光、逆袭、豪门恩怨等各种爆款套路）。
请根据给定的 24 个艺术/视觉风格，分别从「男性向（面向男玩家）」和「女性向（面向女玩家）」视角，为每个风格策划一个极具戏剧张力、代入感极强的开场预设剧情。

每个预设剧情包含：
1. title: 故事标题（4-8字，吸睛爆款风格，例如《赘婿亮剑》《废柴嫡女》）
2. outline: 开场剧情简介 / 钩子（1-3句话，100字以内，充满悬念与强冲突，给玩家强烈的代入感与爽点）。例如："五年前我战死边境，灵柩送回家时她抱着儿子改嫁了。今天我站在他们的婚礼门口，新郎刚要骂人，跪在他面前的二十个保镖喊了我一声「上将」。"
3. style: 对应的风格名称（必须与输入一致）

要求：
- 请严格返回 JSON 格式，包含 "男性向" 数组（24个）和 "女性向" 数组（24个）。
- 不要返回任何 markdown 标记包裹的文本，只返回纯合法的 JSON 字符串。
- 确保数组中的元素严格对应输入的 24 个艺术风格（按顺序一一对应）。
- 内容必须极具网文爆款爽文短剧感，有强烈的冲突和反转。`;

const USER_PROMPT = `请按照顺序，为以下 24 个风格各生成一个男性向和一个女性向的预设故事卡片：
${STYLES.map((s, i) => `${i + 1}. ${s}`).join("\n")}

请严格按照如下 JSON 结构返回（不要有 \`\`\`json 标记，只输出纯 JSON）：
{
  "男性向": [
    { "title": "...", "outline": "...", "style": "古典厚涂油画 (学术奇幻)" },
    ...
  ],
  "女性向": [
    { "title": "...", "outline": "...", "style": "古典厚涂油画 (学术奇幻)" },
    ...
  ]
}`;

async function main() {
  console.log("[presets] Calling LLM API to generate 24 story presets...");
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
        { role: "user", content: USER_PROMPT }
      ],
      temperature: 0.85,
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
    // Strip potential markdown wrapper codeblocks if any
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

  console.log(`[presets] Successfully generated 48 stories in ${((Date.now() - t0)/1000).toFixed(1)}s.`);

  // Write new STORIES constant to apps/web/app/page.tsx
  console.log("[presets] Reading page.tsx...");
  let pageContent = readFileSync(PAGE_FILE, "utf8");

  // Format the STORIES constant string
  const storiesString = `const STORIES: Record<Gender, StoryContent[]> = {
  男性向: ${JSON.stringify(parsed["男性向"], null, 2)},
  女性向: ${JSON.stringify(parsed["女性向"], null, 2)}
};`;

  // Locate the old STORIES constant
  // Match `const STORIES: Record<Gender, StoryContent[]> = {` up to `};`
  const storiesRegex = /const STORIES: Record<Gender, StoryContent\[\]> = \{[\s\S]*?\n\};/m;
  if (!storiesRegex.test(pageContent)) {
    console.error("Could not find 'const STORIES: Record<Gender, StoryContent[]> = {' in page.tsx!");
    process.exit(1);
  }

  pageContent = pageContent.replace(storiesRegex, storiesString);
  writeFileSync(PAGE_FILE, pageContent, "utf8");
  console.log("[presets] Successfully updated page.tsx with the new 48 story cards!");
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
