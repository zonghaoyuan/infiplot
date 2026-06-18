/**
 * Task 19: 收集3组多角色对话场景样本
 * 用于人工盲测评分（有个性/生活化，1-5分）
 *
 * 策略：使用不同世界设定和角色组合，生成多场景（start+2次scene续场），
 * 确保对话足够长且有分支选择。
 */

const BASE_URL = "https://infiplot.y-9e6.workers.dev";

const scenarios = [
  {
    id: "A",
    name: "校园日常·三角关系",
    worldSetting: "现代日本高中校园。樱花季的放学时刻，三个性格迥异的角色在学校天台展开一场关于暗恋对象的对话。故事聚焦于人物间的微妙情感和误解。",
    styleGuide: "anime illustration, soft pastel colors, warm lighting, gentle character expressions, school rooftop backdrop with cherry blossoms"
  },
  {
    id: "B",
    name: "悬疑推理·密室对峙",
    worldSetting: "1930年代上海法租界。一栋老洋房的书房里，三位嫌疑人被侦探召集。一场凶杀案的真相即将揭晓，每个人都有秘密。紧张的心理博弈在昏暗的灯光下展开。",
    styleGuide: "noir detective style, muted sepia tones, dramatic shadows, 1930s Shanghai architecture, dim lamp lighting"
  },
  {
    id: "C",
    name: "奇幻冒险·酒馆夜话",
    worldSetting: "中世纪奇幻世界的冒险者酒馆。三位刚完成一次失败任务的冒险者在角落的桌子旁借酒浇愁。精灵弓手在反思自己的失误，矮人战士在安慰同伴，人类法师则在计划下一步。他们之间有深厚的友情，也有未说出口的分歧。",
    styleGuide: "fantasy tavern, warm candlelight, medieval wooden interior, mugs of ale, adventuring gear on table"
  }
];

async function generateScenario(scenario) {
  console.log(`\n${"═".repeat(60)}`);
  console.log(`🎬 场景 ${scenario.id}: ${scenario.name}`);
  console.log(`${"═".repeat(60)}\n`);

  const allBeats = [];

  // Step 1: Start session
  console.log("  [1/3] 开始会话...");
  const startRes = await fetch(`${BASE_URL}/api/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      worldSetting: scenario.worldSetting,
      styleGuide: scenario.styleGuide,
      orientation: "landscape"
    })
  });

  if (!startRes.ok) {
    const err = await startRes.text().catch(() => "");
    console.error(`  ❌ Start 失败: ${startRes.status} ${err.slice(0, 200)}`);
    return null;
  }

  const startData = await startRes.json();
  const scene1 = startData.scene;
  allBeats.push({ sceneNum: 1, scene: scene1 });
  console.log(`  ✅ 场景1: ${scene1.beats.length} beats`);

  // Build session for next scene
  let session = {
    id: startData.sessionId,
    createdAt: Date.now(),
    worldSetting: scenario.worldSetting,
    styleGuide: scenario.styleGuide,
    orientation: "landscape",
    storyState: startData.storyState,
    characters: startData.characters,
    history: [{
      scene: scene1,
      visitedBeatIds: scene1.beats.map(b => b.id),
      exit: findFirstExit(scene1)
    }]
  };

  // Step 2: Generate scene 2
  console.log("  [2/3] 生成续场景...");
  await sleep(3000);
  const scene2Res = await fetch(`${BASE_URL}/api/scene`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session })
  });

  if (scene2Res.ok) {
    const scene2Data = await scene2Res.json();
    const scene2 = scene2Data.scene;
    allBeats.push({ sceneNum: 2, scene: scene2 });
    console.log(`  ✅ 场景2: ${scene2.beats.length} beats`);

    // Update session
    session.storyState = scene2Data.storyState;
    session.characters = scene2Data.characters;
    session.history.push({
      scene: scene2,
      visitedBeatIds: scene2.beats.map(b => b.id),
      exit: findFirstExit(scene2)
    });

    // Step 3: Generate scene 3
    console.log("  [3/3] 生成第三场景...");
    await sleep(3000);
    const scene3Res = await fetch(`${BASE_URL}/api/scene`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session })
    });

    if (scene3Res.ok) {
      const scene3Data = await scene3Res.json();
      const scene3 = scene3Data.scene;
      allBeats.push({ sceneNum: 3, scene: scene3 });
      console.log(`  ✅ 场景3: ${scene3.beats.length} beats`);
    } else {
      console.log(`  ⚠️  场景3 失败: ${scene3Res.status}`);
    }
  } else {
    console.log(`  ⚠️  场景2 失败: ${scene2Res.status}`);
  }

  return { scenario, scenes: allBeats };
}

function findFirstExit(scene) {
  for (const beat of scene.beats) {
    if (beat.next?.type === "choice" && beat.next.choices?.length > 0) {
      const choice = beat.next.choices[0];
      if (choice.effect?.kind === "change-scene") {
        return {
          kind: "choice",
          choiceId: choice.id,
          label: choice.label,
          nextSceneSeed: choice.effect.nextSceneSeed
        };
      }
    }
  }
  return { kind: "choice", choiceId: "fallback", label: "继续", nextSceneSeed: "故事继续" };
}

function formatSceneForDoc(sceneData, sceneNum) {
  const { scene } = sceneData;
  let md = `### 第${sceneNum}幕\n\n`;

  for (const beat of scene.beats) {
    // Narration
    if (beat.narration) {
      md += `*${beat.narration}*\n\n`;
    }
    // Dialogue
    if (beat.speaker && beat.line) {
      const delivery = beat.lineDelivery ? ` _(${beat.lineDelivery})_` : "";
      md += `**${beat.speaker}**：「${beat.line}」${delivery}\n\n`;
    }
    // Choices
    if (beat.next?.type === "choice" && beat.next.choices?.length > 0) {
      md += `---\n📌 **选择分支：**\n`;
      for (const c of beat.next.choices) {
        const effect = c.effect?.kind === "change-scene"
          ? `→ 换场: ${c.effect.nextSceneSeed}`
          : c.effect?.kind === "advance-beat"
          ? `→ 跳转: ${c.effect.targetBeatId}`
          : "";
        md += `- [ ] ${c.label} ${effect ? `*(${effect})*` : ""}\n`;
      }
      md += `\n`;
    }
  }

  return md;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  console.log("📋 Task 19: 收集对白质量盲测样本");
  console.log(`📍 目标环境: ${BASE_URL}\n`);

  const results = [];

  for (const scenario of scenarios) {
    const result = await generateScenario(scenario);
    if (result) results.push(result);
    await sleep(2000);
  }

  // Generate markdown document
  let doc = `# 对白质量盲测样本\n\n`;
  doc += `> 生成时间: ${new Date().toISOString()}\n`;
  doc += `> 环境: ${BASE_URL}\n`;
  doc += `> 模型: gemini-3.1-flash-lite-preview\n\n`;
  doc += `## 评分标准\n\n`;
  doc += `请对每组场景的对白质量进行评分（1-5分）：\n\n`;
  doc += `| 维度 | 1分 | 3分 | 5分 |\n`;
  doc += `|------|-----|-----|-----|\n`;
  doc += `| **有个性** | 所有角色说话一个味 | 能区分但不突出 | 角色鲜明、一看就知道谁说的 |\n`;
  doc += `| **生活化** | 像机器生成的套话 | 基本通顺但略僵 | 自然流畅、像真人会说的话 |\n\n`;
  doc += `---\n\n`;

  for (const result of results) {
    doc += `## 场景 ${result.scenario.id}: ${result.scenario.name}\n\n`;
    doc += `> 设定: ${result.scenario.worldSetting.slice(0, 80)}...\n\n`;

    for (const sceneData of result.scenes) {
      doc += formatSceneForDoc(sceneData, sceneData.sceneNum);
    }

    doc += `### 评分\n\n`;
    doc += `| 维度 | 评分 (1-5) | 备注 |\n`;
    doc += `|------|-----------|------|\n`;
    doc += `| 有个性 | | |\n`;
    doc += `| 生活化 | | |\n\n`;
    doc += `---\n\n`;
  }

  doc += `## 汇总\n\n`;
  doc += `| 场景 | 有个性 | 生活化 | 平均 |\n`;
  doc += `|------|--------|--------|------|\n`;
  doc += `| A |  |  |  |\n`;
  doc += `| B |  |  |  |\n`;
  doc += `| C |  |  |  |\n`;
  doc += `| **总平均** | | | |\n\n`;
  doc += `> 期望目标: 平均分 ≥ 4/5\n`;

  // Save document
  const { writeFile } = await import("node:fs/promises");
  const outPath = "G:\\infiplot\\.spec-workflow\\specs\\prompt-architecture-redesign\\task19-dialogue-samples.md";
  await writeFile(outPath, doc, "utf-8");
  console.log(`\n\n✅ 盲测文档已保存: ${outPath}`);

  // Also save raw JSON for reference
  const jsonPath = "G:\\infiplot\\.spec-workflow\\specs\\prompt-architecture-redesign\\task19-raw-scenes.json";
  await writeFile(jsonPath, JSON.stringify(results, null, 2), "utf-8");
  console.log(`📄 原始数据已保存: ${jsonPath}`);
}

main().catch(console.error);
