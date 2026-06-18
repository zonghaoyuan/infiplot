#!/usr/bin/env node
/**
 * 交互剧情演练 — 模拟真实玩家游玩，记录长文本剧情到 Markdown。
 *
 * 流程：start → 沿 beat 图推进 → 遇 choice 选分支 → 中途 insert-beat 自由交互
 *       → change-scene 换场 → 循环。完整记录旁白/内心独白/对白 + 分支 + 自由交互。
 *
 * 用法：node scripts/playthrough-demo.mjs
 */

import { writeFile } from "node:fs/promises";

const BASE = "https://infiplot.y-9e6.workers.dev";
const OUT = "G:\\infiplot\\.spec-workflow\\specs\\narrative-depth-redesign\\playthrough-demos-v2.md";

// 三个不同题材的开局 + 每局的「自由交互动作」脚本（模拟玩家点击/输入）
const PLAYTHROUGHS = [
  {
    id: "A",
    title: "校园暗恋·雨天的天台",
    worldSetting:
      "现代日本高中。梅雨季的午后，你（第二人称男生）暗恋着同班的吉他社少女，今天偶然发现她独自在天台避雨弹唱。围绕青涩暗恋与少女不为人知的心事展开。",
    styleGuide: "anime illustration, soft rainy atmosphere, warm muted tones",
    // 模拟玩家在场景内的自由交互（insert-beat）
    freeformActions: [
      "悄悄走近，假装只是来收衣服，偷看她的侧脸",
      "鼓起勇气问她：这首歌是写给谁的？",
    ],
  },
  {
    id: "B",
    title: "悬疑·深夜便利店",
    worldSetting:
      "现代都市。凌晨三点，你（第二人称）是值夜班的便利店店员。一个浑身湿透、神色慌张的女人冲进店里，反锁了门，说有人在追她。窗外的雨夜里似乎真有黑影徘徊。",
    styleGuide: "noir, neon-lit convenience store at night, rain on windows",
    freeformActions: [
      "不动声色地按下柜台下的报警按钮，同时观察她的反应",
      "递给她一杯热咖啡，低声问：到底发生了什么？",
    ],
  },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 把一个 beat 渲染成 Markdown 片段
function renderBeat(beat, playerName) {
  const lines = [];
  // narration 先行
  if (beat.narration) lines.push(`*${beat.narration}*`);
  // speaker + line
  if (beat.speaker && beat.line) {
    const who = beat.speaker === "你" ? (playerName || "你") : beat.speaker;
    const delivery = beat.lineDelivery ? ` _(${beat.lineDelivery})_` : "";
    if (beat.speaker === "你") {
      lines.push(`**${who}（心声）**：${beat.line}`);
    } else {
      lines.push(`**${who}**：「${beat.line}」${delivery}`);
    }
  } else if (beat.line) {
    lines.push(beat.line);
  }
  return lines.join("\n\n");
}

// 沿 beat 图走一条线性路径，遇到第一个 choice 就返回（带可选项）
// 返回 { rendered: string[], exitChoice, beats }
function walkScene(scene, playerName) {
  const byId = new Map(scene.beats.map((b) => [b.id, b]));
  const rendered = [];
  const visited = new Set();
  let cur = byId.get(scene.entryBeatId) ?? scene.beats[0];
  let exitChoice = null;
  let chosenLabel = null;

  while (cur && !visited.has(cur.id)) {
    visited.add(cur.id);
    const frag = renderBeat(cur, playerName);
    if (frag) rendered.push(frag);

    if (cur.next.type === "continue") {
      cur = byId.get(cur.next.nextBeatId);
      continue;
    }
    // choice 节点：列出所有选项，选一个
    const choices = cur.next.choices;
    const choiceLines = choices.map(
      (c, i) =>
        `   ${i === 0 ? "👉" : "  "} [${c.effect.kind === "change-scene" ? "换场" : "场内"}] ${c.label}`,
    );
    rendered.push(`\n**【可选分支】**\n${choiceLines.join("\n")}`);

    // 策略：优先选第一个 change-scene 推进剧情；没有则选第一个 advance-beat
    const sceneChange = choices.find((c) => c.effect.kind === "change-scene");
    const picked = sceneChange ?? choices[0];
    chosenLabel = picked.label;
    rendered.push(`\n> 🎮 玩家选择：**${picked.label}**`);

    if (picked.effect.kind === "change-scene") {
      exitChoice = picked;
      break;
    } else {
      // advance-beat：跳到目标 beat 继续走
      cur = byId.get(picked.effect.targetBeatId);
    }
  }

  return { rendered, exitChoice, chosenLabel };
}

async function postJSON(path, body) {
  const r = await fetch(BASE + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`${path} ${r.status}: ${t.slice(0, 200)}`);
  }
  return r.json();
}

async function runPlaythrough(pt) {
  console.log(`\n${"═".repeat(56)}\n🎬 ${pt.id}: ${pt.title}\n${"═".repeat(56)}`);
  const md = [`## 剧本 ${pt.id}：${pt.title}\n`, `> 设定：${pt.worldSetting}\n`];

  // ── 开局 ──
  console.log("  [start] 开局...");
  const startData = await postJSON("/api/start", {
    worldSetting: pt.worldSetting,
    styleGuide: pt.styleGuide,
    orientation: "landscape",
  });

  let session = {
    id: startData.sessionId,
    createdAt: Date.now(),
    worldSetting: pt.worldSetting,
    styleGuide: pt.styleGuide,
    orientation: "landscape",
    storyState: startData.storyState,
    characters: startData.characters,
    history: [],
  };

  // bible 摘要
  const sb = startData.storyState;
  if (sb) {
    md.push(`### 故事档案（Architect）\n`);
    md.push(`- **logline**：${sb.logline ?? ""}`);
    md.push(`- **题材**：${sb.genreTags ?? ""}`);
    md.push(`- **主角**：${sb.protagonist ?? ""}`);
    if (sb.castNotes) md.push(`- **配角**：\n  ${String(sb.castNotes).replace(/\n/g, "\n  ")}`);
    md.push("");
  }

  let scene = startData.scene;
  const MAX_SCENES = 3;

  for (let s = 0; s < MAX_SCENES; s++) {
    console.log(`  [场景${s + 1}] ${scene.beats.length} beats, key=${scene.sceneKey}`);
    md.push(`### 第 ${s + 1} 幕${scene.sceneKey ? `（${scene.sceneKey}）` : ""}\n`);

    const { rendered, exitChoice } = walkScene(scene, undefined);
    md.push(rendered.join("\n\n"));

    // 记录本幕入 history（供后续 scene/insert-beat 携带）
    session.history.push({
      scene,
      visitedBeatIds: scene.beats.map((b) => b.id),
      exit: exitChoice
        ? { kind: "choice", choiceId: exitChoice.id, label: exitChoice.label, nextSceneSeed: exitChoice.effect.nextSceneSeed }
        : { kind: "choice", choiceId: "auto", label: "继续", nextSceneSeed: "故事继续推进" },
    });
    session.storyState = startData.storyState; // 会被 scene 响应更新

    // ── 自由交互（insert-beat）：每幕插一次，模拟玩家点击/输入 ──
    const action = pt.freeformActions[s];
    if (action) {
      console.log(`    [insert-beat] "${action.slice(0, 20)}..."`);
      md.push(`\n> 🖱️ 玩家自由行动：**${action}**\n`);
      try {
        await sleep(1500);
        const ib = await postJSON("/api/insert-beat", { session, freeformAction: action });
        const p = ib.partial;
        const frag = renderBeat(
          { narration: p.narration, speaker: p.speaker, line: p.line, lineDelivery: p.lineDelivery },
          undefined,
        );
        md.push(frag || "*（无回应）*");
        if (ib.characters) session.characters = ib.characters;
      } catch (e) {
        md.push(`*（insert-beat 失败：${e.message}）*`);
      }
    }

    md.push("");

    // ── 换场到下一幕 ──
    if (s < MAX_SCENES - 1) {
      console.log("    [scene] 换场生成下一幕...");
      await sleep(2000);
      try {
        const sceneData = await postJSON("/api/scene", { session });
        scene = sceneData.scene;
        session.storyState = sceneData.storyState;
        session.characters = sceneData.characters;
      } catch (e) {
        md.push(`*（换场失败：${e.message}）*\n`);
        break;
      }
    }
  }

  md.push(`\n---\n`);
  return md.join("\n");
}

async function main() {
  console.log("🎮 交互剧情演练");
  console.log(`📍 ${BASE}\n`);

  const doc = [
    `# 交互剧情演练样本\n`,
    `> 生成时间：${new Date().toISOString()}`,
    `> 环境：${BASE}`,
    `> 模型：gemini-3.1-flash-lite-preview`,
    `>`,
    `> 说明：模拟真实玩家游玩——开局 → 沿剧情推进 → 遇分支选择 → 中途自由交互（insert-beat）→ 换场。`,
    `> *斜体*=旁白/环境描写，**角色（心声）**=玩家内心独白，**角色**「」=NPC对白，👉=玩家所选分支，🖱️=玩家自由行动。\n`,
    `---\n`,
  ];

  for (const pt of PLAYTHROUGHS) {
    try {
      doc.push(await runPlaythrough(pt));
    } catch (e) {
      console.error(`  ❌ ${pt.id} 失败: ${e.message}`);
      doc.push(`## 剧本 ${pt.id}：${pt.title}\n\n*（生成失败：${e.message}）*\n\n---\n`);
    }
    await sleep(2000);
  }

  await writeFile(OUT, doc.join("\n"), "utf-8");
  console.log(`\n✅ 剧情已记录：${OUT}`);
}

main().catch((e) => {
  console.error("💥", e);
  process.exit(1);
});
