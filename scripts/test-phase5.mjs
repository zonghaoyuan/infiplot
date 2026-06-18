#!/usr/bin/env node
/**
 * Phase 5 验证测试脚本
 *
 * 用途：
 * - Task 18: 禁词表验证（生成10场景，统计禁词）
 * - Task 20: CharacterPersona 注入验证
 * - Task 21: 世界书触发验证
 * - Task 22: Prompt Cache 命中率监控
 * - Task 23: Token 预算验证
 *
 * 使用方法：
 *   node scripts/test-phase5.mjs --task=18 --url=https://infiplot.y-9e6.workers.dev
 */

import { promises as fs } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 禁词表（来自 lib/engine/prompts/segments/writer/style-base.ts）
const FORBIDDEN_WORDS = [
  "一丝", "不易察觉", "鲜明对比", "喉结", "纽扣", "弧度",
  "不禁", "悄然", "涟漪", "交织"
];

// 命令行参数解析
const args = process.argv.slice(2).reduce((acc, arg) => {
  const [key, value] = arg.split("=");
  acc[key.replace("--", "")] = value || true;
  return acc;
}, {});

const BASE_URL = args.url || "https://infiplot.y-9e6.workers.dev";
const TASK = args.task || "18";

console.log(`🔍 Phase 5 验证测试 - Task ${TASK}`);
console.log(`📍 目标环境: ${BASE_URL}\n`);

// ──────────────────────────────────────────────────────────────────────
// Task 18: 禁词表验证
// ──────────────────────────────────────────────────────────────────────
async function task18_forbiddenWords() {
  console.log("📋 Task 18: 禁词表验证（生成10场景统计禁词）\n");

  const scenarios = [
    { type: "开局", seed: "一个平凡的清晨，主角醒来发现窗外有奇怪的光" },
    { type: "对话", seed: "两个角色在咖啡厅里讨论一个秘密" },
    { type: "动作", seed: "主角在图书馆里发现了一本禁书" },
    { type: "情感", seed: "两个朋友因为误会产生了隔阂" },
    { type: "悬疑", seed: "主角收到了一封没有署名的信" },
    { type: "冲突", seed: "主角和反派在天台对峙" },
    { type: "浪漫", seed: "两个人在雨中相遇" },
    { type: "惊悚", seed: "主角发现镜子里的倒影不是自己" },
    { type: "日常", seed: "主角在学校食堂排队买午饭" },
    { type: "转折", seed: "主角发现自己信任的人背叛了自己" }
  ];

  const results = [];
  let totalForbiddenCount = 0;
  let totalCharCount = 0;

  for (let i = 0; i < scenarios.length; i++) {
    const scenario = scenarios[i];
    console.log(`\n🎬 [${i + 1}/10] 场景类型: ${scenario.type}`);
    console.log(`   开场种子: ${scenario.seed}`);

    try {
      // 调用 /api/start
      const startRes = await fetch(`${BASE_URL}/api/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          worldSetting: "现代都市，有超自然元素",
          styleGuide: "写实风格，带一点魔幻色彩",
          openingPrompt: scenario.seed,
          orientation: "landscape"
        })
      });

      if (!startRes.ok) {
        console.error(`   ❌ API 错误: ${startRes.status}`);
        continue;
      }

      const data = await startRes.json();
      // StartResponse: { sessionId, scene, imageUrl, characters, storyState }
      const scene = data.scene;
      if (!scene || !scene.beats) {
        console.error(`   ❌ 场景数据缺失`, JSON.stringify(Object.keys(data)));
        continue;
      }

      // 提取所有文本
      const texts = scene.beats
        .map(b => [b.narration, b.line].filter(Boolean).join(" "))
        .join(" ");

      totalCharCount += texts.length;

      // 统计禁词
      const forbiddenFound = {};
      let sceneForbiddenCount = 0;
      for (const word of FORBIDDEN_WORDS) {
        const count = (texts.match(new RegExp(word, "g")) || []).length;
        if (count > 0) {
          forbiddenFound[word] = count;
          sceneForbiddenCount += count;
        }
      }

      totalForbiddenCount += sceneForbiddenCount;

      console.log(`   ✅ 生成成功 (${texts.length} 字)`);
      if (sceneForbiddenCount > 0) {
        console.log(`   ⚠️  禁词出现: ${sceneForbiddenCount} 次`);
        for (const [word, count] of Object.entries(forbiddenFound)) {
          console.log(`      - "${word}": ${count} 次`);
        }
      } else {
        console.log(`   ✨ 无禁词`);
      }

      results.push({
        type: scenario.type,
        seed: scenario.seed,
        textLength: texts.length,
        forbiddenCount: sceneForbiddenCount,
        forbiddenWords: forbiddenFound,
        sceneKey: scene.sceneKey,
        beatCount: scene.beats.length
      });

    } catch (err) {
      console.error(`   ❌ 请求失败: ${err.message}`);
    }

    // 避免 rate limit
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  // 输出统计结果
  console.log("\n\n" + "═".repeat(60));
  console.log("📊 Task 18 统计结果");
  console.log("═".repeat(60));
  console.log(`生成场景: ${results.length} / 10`);
  console.log(`总字数: ${totalCharCount.toLocaleString()} 字`);
  console.log(`禁词总数: ${totalForbiddenCount} 次`);
  console.log(`禁词密度: ${(totalForbiddenCount / totalCharCount * 10000).toFixed(2)} 次/万字`);
  console.log(`\n期望目标: 禁词出现率下降 >80% (需要对比旧版本基线)`);

  // 保存详细报告
  const reportPath = join(__dirname, "../.spec-workflow/specs/prompt-architecture-redesign/task18-report.json");
  await fs.writeFile(reportPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    summary: {
      scenesGenerated: results.length,
      totalChars: totalCharCount,
      totalForbiddenWords: totalForbiddenCount,
      forbiddenDensity: totalForbiddenCount / totalCharCount * 10000
    },
    details: results
  }, null, 2));

  console.log(`\n📄 详细报告已保存: ${reportPath}`);
}

// ──────────────────────────────────────────────────────────────────────
// Task 20: CharacterPersona 注入验证
// ──────────────────────────────────────────────────────────────────────
async function task20_personaInjection() {
  console.log("📋 Task 20: CharacterPersona 注入验证\n");

  const testCases = [
    {
      name: "傲娇女生测试",
      worldSetting: "现代校园",
      styleGuide: "轻松日常风格",
      openingPrompt: "主角在学校走廊遇到了同班的凛，她似乎有话要说",
      expectedPersona: {
        name: "凛",
        persona: "傲娇女生，外冷内热，喜欢主角但嘴硬",
        speakingStyle: "口头禅'哼'，短句，语气强硬但偶尔露出温柔",
        sampleDialogue: ["哼，才不是担心你呢！", "你…你别误会啊！"]
      }
    },
    {
      name: "沉默寡言少年测试",
      worldSetting: "现代校园",
      styleGuide: "安静温柔",
      openingPrompt: "主角在图书馆遇到了总是独自看书的少年樱",
      expectedPersona: {
        name: "樱",
        persona: "沉默寡言的少年，内心细腻，不善表达",
        speakingStyle: "惜字如金，多用省略号和短句，语气平静",
        sampleDialogue: ["嗯…", "……没什么。", "谢谢。"]
      }
    }
  ];

  const results = [];

  for (const testCase of testCases) {
    console.log(`\n🎭 ${testCase.name}`);
    console.log(`   角色: ${testCase.expectedPersona.name}`);
    console.log(`   Persona: ${testCase.expectedPersona.persona}`);
    console.log(`   说话风格: ${testCase.expectedPersona.speakingStyle}`);

    try {
      // 第一次调用 /api/start，然后手动注入 persona（模拟后续场景）
      const startRes = await fetch(`${BASE_URL}/api/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          worldSetting: testCase.worldSetting,
          styleGuide: testCase.styleGuide,
          openingPrompt: testCase.openingPrompt,
          orientation: "landscape"
        })
      });

      if (!startRes.ok) {
        console.error(`   ❌ API 错误: ${startRes.status}`);
        continue;
      }

      const data = await startRes.json();
      // Reconstruct a Session object from StartResponse
      const session = {
        id: data.sessionId,
        createdAt: Date.now(),
        worldSetting: testCase.worldSetting,
        styleGuide: testCase.styleGuide,
        history: [{
          scene: data.scene,
          visitedBeatIds: [data.scene.entryBeatId || data.scene.beats[0].id],
          exit: null
        }],
        characters: data.characters,
        storyState: data.storyState,
        orientation: "landscape"
      };

      // 手动注入角色 persona（模拟已设计的角色）
      const targetChar = session.characters.find(c => c.name === testCase.expectedPersona.name);
      if (targetChar) {
        Object.assign(targetChar, testCase.expectedPersona);
      } else {
        session.characters.push(testCase.expectedPersona);
      }

      // 调用 /api/scene 生成下一场景
      const sceneRes = await fetch(`${BASE_URL}/api/scene`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session })
      });

      if (!sceneRes.ok) {
        console.error(`   ❌ Scene API 错误: ${sceneRes.status}`);
        continue;
      }

      const sceneData = await sceneRes.json();
      // SceneResponse: { scene, imageUrl, characters, storyState }
      const scene = sceneData.scene;

      // 提取该角色的对白
      const characterLines = scene.beats
        .filter(b => b.speaker === testCase.expectedPersona.name && b.line)
        .map(b => ({
          line: b.line,
          delivery: b.lineDelivery
        }));

      console.log(`   ✅ 生成成功，${testCase.expectedPersona.name} 有 ${characterLines.length} 句对白`);

      if (characterLines.length > 0) {
        console.log(`   💬 对白示例:`);
        characterLines.slice(0, 3).forEach(l => {
          console.log(`      "${l.line}"${l.delivery ? ` [${l.delivery}]` : ""}`);
        });
      } else {
        console.log(`   ⚠️  该角色未说话（可能未出场）`);
      }

      results.push({
        testCase: testCase.name,
        character: testCase.expectedPersona.name,
        linesGenerated: characterLines.length,
        lines: characterLines,
        passed: characterLines.length > 0
      });

    } catch (err) {
      console.error(`   ❌ 请求失败: ${err.message}`);
    }

    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  // 输出统计
  console.log("\n\n" + "═".repeat(60));
  console.log("📊 Task 20 统计结果");
  console.log("═".repeat(60));
  console.log(`测试用例: ${results.length} / ${testCases.length}`);
  console.log(`通过用例: ${results.filter(r => r.passed).length}`);
  console.log(`\n💡 需要人工检查对白是否体现 persona 特征`);

  const reportPath = join(__dirname, "../.spec-workflow/specs/prompt-architecture-redesign/task20-report.json");
  await fs.writeFile(reportPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    results
  }, null, 2));

  console.log(`\n📄 详细报告已保存: ${reportPath}`);
}

// ──────────────────────────────────────────────────────────────────────
// Task 21: 世界书触发验证
// ──────────────────────────────────────────────────────────────────────
async function task21_worldBookTrigger() {
  console.log("📋 Task 21: 世界书触发验证\n");

  const worldBooks = [{
    id: "test-wb",
    name: "测试世界书",
    entries: [
      {
        id: "const-1",
        keys: [],
        content: "这所学校位于县城西郊，建校已有50年历史",
        position: "constant",
        priority: 10
      },
      {
        id: "trig-1",
        keys: ["教室", "上课"],
        content: "3年2班教室位于教学楼3层，共有42个座位，窗户朝南",
        position: "triggered",
        priority: 5
      },
      {
        id: "trig-2",
        keys: ["食堂", "午饭"],
        content: "学校食堂在一楼，有A、B两个窗口，A窗口供应盖饭，B窗口供应面食",
        position: "triggered",
        priority: 5
      }
    ]
  }];

  const scenarios = [
    { seed: "主角走进3年2班教室，准备上课", expectedTrigger: ["trig-1"], keywords: ["教室", "上课"] },
    { seed: "放学后，主角去学校食堂吃午饭", expectedTrigger: ["trig-2"], keywords: ["食堂", "午饭"] },
    { seed: "主角在操场上遇到了朋友", expectedTrigger: [], keywords: [] },
    { seed: "主角在图书馆看书", expectedTrigger: [], keywords: [] },
    { seed: "主角在教室里和同学讨论作业", expectedTrigger: ["trig-1"], keywords: ["教室"] }
  ];

  const results = [];

  for (let i = 0; i < scenarios.length; i++) {
    const scenario = scenarios[i];
    console.log(`\n🎬 [${i + 1}/${scenarios.length}] ${scenario.seed}`);
    console.log(`   期望触发: ${scenario.expectedTrigger.length > 0 ? scenario.expectedTrigger.join(", ") : "无"}`);

    try {
      // Step 1: /api/start to get a session (worldBooks injected afterward)
      const startRes = await fetch(`${BASE_URL}/api/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          worldSetting: `现代校园。${scenario.seed}`,
          styleGuide: "日常写实",
          orientation: "landscape"
        })
      });

      if (!startRes.ok) {
        console.error(`   ❌ Start API 错误: ${startRes.status}`);
        continue;
      }

      const startData = await startRes.json();
      // Reconstruct session with worldBooks injected
      const session = {
        id: startData.sessionId,
        createdAt: Date.now(),
        worldSetting: `现代校园。${scenario.seed}`,
        styleGuide: "日常写实",
        history: [{
          scene: startData.scene,
          visitedBeatIds: [startData.scene.entryBeatId || startData.scene.beats[0].id],
          exit: { kind: "choice", label: "继续", nextSceneSeed: scenario.seed }
        }],
        characters: startData.characters,
        storyState: startData.storyState,
        orientation: "landscape",
        worldBooks
      };

      // Step 2: /api/scene with worldBooks in session (this is where lore injection happens)
      const sceneRes = await fetch(`${BASE_URL}/api/scene`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session })
      });

      if (!sceneRes.ok) {
        console.error(`   ❌ Scene API 错误: ${sceneRes.status}`);
        continue;
      }

      const sceneData = await sceneRes.json();
      const scene = sceneData.scene;
      const texts = scene?.beats?.map(b => [b.narration, b.line].filter(Boolean).join(" ")).join(" ") || "";

      // 检查是否引用了世界书内容
      const constReferenced = texts.includes("县城西郊") || texts.includes("50年");

      const triggeredEntries = [];
      for (const expected of scenario.expectedTrigger) {
        const entry = worldBooks[0].entries.find(e => e.id === expected);
        if (entry) {
          const referenced = texts.includes("42个座位") || texts.includes("A、B两个窗口") ||
                             texts.includes("3层") || texts.includes("窗户朝南") ||
                             texts.includes("盖饭") || texts.includes("面食");
          if (referenced) triggeredEntries.push(expected);
        }
      }

      const passed = (scenario.expectedTrigger.length === 0 && triggeredEntries.length === 0) ||
                     (scenario.expectedTrigger.length > 0 && triggeredEntries.length > 0);

      console.log(`   ✅ 生成成功 (${texts.length} 字)`);
      console.log(`   Constant 条目引用: ${constReferenced ? "是" : "否"}`);
      console.log(`   Triggered 条目触发: ${triggeredEntries.length > 0 ? triggeredEntries.join(", ") : "无"}`);
      console.log(`   验证结果: ${passed ? "✓ 通过" : "✗ 失败"}`);

      results.push({
        seed: scenario.seed,
        expectedTrigger: scenario.expectedTrigger,
        actualTrigger: triggeredEntries,
        constReferenced,
        passed
      });

    } catch (err) {
      console.error(`   ❌ 请求失败: ${err.message}`);
    }

    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  // 输出统计
  console.log("\n\n" + "═".repeat(60));
  console.log("📊 Task 21 统计结果");
  console.log("═".repeat(60));
  console.log(`测试场景: ${results.length} / ${scenarios.length}`);
  console.log(`通过场景: ${results.filter(r => r.passed).length}`);
  console.log(`触发准确率: ${(results.filter(r => r.passed).length / results.length * 100).toFixed(1)}%`);
  console.log(`\n期望目标: 触发准确率 ≥90%`);

  const reportPath = join(__dirname, "../.spec-workflow/specs/prompt-architecture-redesign/task21-report.json");
  await fs.writeFile(reportPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    summary: {
      total: results.length,
      passed: results.filter(r => r.passed).length,
      accuracy: results.filter(r => r.passed).length / results.length
    },
    details: results
  }, null, 2));

  console.log(`\n📄 详细报告已保存: ${reportPath}`);
}

// ──────────────────────────────────────────────────────────────────────
// 主函数
// ──────────────────────────────────────────────────────────────────────
async function main() {
  try {
    switch (TASK) {
      case "18":
        await task18_forbiddenWords();
        break;
      case "20":
        await task20_personaInjection();
        break;
      case "21":
        await task21_worldBookTrigger();
        break;
      default:
        console.error(`❌ 未知任务: ${TASK}`);
        console.log(`\n可用任务: 18, 20, 21`);
        process.exit(1);
    }
  } catch (err) {
    console.error(`\n💥 执行失败: ${err.message}`);
    console.error(err.stack);
    process.exit(1);
  }
}

main();
