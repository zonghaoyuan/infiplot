#!/usr/bin/env node
/**
 * Task 23: Token 预算估算
 *
 * 通过对比新旧 prompt 文本长度来估算 token 增量。
 *
 * 旧版本（1ae5ab1 之前）：
 * - WRITER_STREAM_SYSTEM: 约 140 行硬编码模板字符串
 *
 * 新版本（当前 prompt 架构改造后）：
 * - 8 个段落文件 + Context segments
 */

import { promises as fs } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 粗略估算：英文 ~4 chars/token，中文 ~1.5-2 chars/token
// 使用保守估算：混合文本 ~2.5 chars/token
const CHARS_PER_TOKEN = 2.5;

function estimateTokens(textOrLength) {
  const length = typeof textOrLength === "string" ? textOrLength.length : textOrLength;
  return Math.ceil(length / CHARS_PER_TOKEN);
}

async function readSegmentFiles() {
  const segmentDir = join(__dirname, "../lib/engine/prompts/segments/writer");
  const files = [
    "identity.ts",
    "cot.ts",
    "style-base.ts",
    "narrative-rules.ts",
    "dialogue.ts",
    "guardrails.ts",
    "pacing.ts",
    "format.ts"
  ];

  let totalChars = 0;
  const segments = [];

  for (const file of files) {
    const filePath = join(segmentDir, file);
    const content = await fs.readFile(filePath, "utf-8");

    // 提取 content 字段（多行模板字符串）
    const match = content.match(/content:\s*`([^`]*)`/s);
    if (match) {
      const segmentContent = match[1].trim();
      const chars = segmentContent.length;
      const tokens = estimateTokens(segmentContent);

      segments.push({
        file,
        chars,
        tokens,
        enabled: !file.includes("cot") // COT 默认关闭
      });

      if (!file.includes("cot")) {
        totalChars += chars;
      }
    }
  }

  return { segments, totalChars, totalTokens: estimateTokens(totalChars) };
}

async function estimateContextSegments() {
  // 估算 Context segments 的典型大小
  const estimates = {
    "world-style": 150,        // 世界观 + 画风
    "story-spine": 300,         // 故事骨架（logline + genreTags + protagonist）
    "character-cards": 500,     // 3个角色卡 * ~150 chars
    "prior-sceneKeys": 100,     // 5个 sceneKey
    "archived-history": 800,    // 2个已完结场景摘要
    "lore-constant": 200,       // 2-3个恒定知识条目
    "story-dynamic": 400,       // synopsis + openThreads + relationships + nextHook
    "last-beat": 200,           // 上一刻文本
    "transition-hint": 150,     // 转场提示
    "lore-triggered": 150       // 1-2个触发条目
  };

  const stableChars = estimates["world-style"] + estimates["story-spine"] +
                      estimates["character-cards"] + estimates["prior-sceneKeys"] +
                      estimates["archived-history"] + estimates["lore-constant"];

  const dynamicChars = estimates["story-dynamic"] + estimates["last-beat"] +
                       estimates["transition-hint"] + estimates["lore-triggered"];

  return {
    stable: { chars: stableChars, tokens: estimateTokens(stableChars) },
    dynamic: { chars: dynamicChars, tokens: estimateTokens(dynamicChars) }
  };
}

async function estimateOldPrompt() {
  // 旧版本 WRITER_STREAM_SYSTEM（已删除）的估算
  // 从 git history 可知约 140 行，平均每行 ~60 chars（中英混合）
  const estimatedLines = 140;
  const avgCharsPerLine = 60;
  const totalChars = estimatedLines * avgCharsPerLine;

  return {
    chars: totalChars,
    tokens: estimateTokens(totalChars)
  };
}

console.log("📊 Task 23: Token 预算估算\n");
console.log("═".repeat(60));

// 新版本 Prompt 段落
const { segments, totalChars: segmentChars, totalTokens: segmentTokens } = await readSegmentFiles();

console.log("\n【新版本：8 个 Prompt 段落】");
console.log("-".repeat(60));
for (const seg of segments) {
  const status = seg.enabled ? "✓" : "✗ (disabled)";
  console.log(`${status} ${seg.file.padEnd(25)} ${seg.chars.toString().padStart(5)} chars  ~${seg.tokens} tokens`);
}
console.log("-".repeat(60));
console.log(`启用段落总计:                     ${segmentChars.toString().padStart(5)} chars  ~${segmentTokens} tokens\n`);

// Context segments
const context = await estimateContextSegments();
console.log("【新版本：Context Segments 估算】");
console.log("-".repeat(60));
console.log(`Stable 区 (cached):               ${context.stable.chars.toString().padStart(5)} chars  ~${context.stable.tokens} tokens`);
console.log(`Dynamic 区 (每次变化):             ${context.dynamic.chars.toString().padStart(5)} chars  ~${context.dynamic.tokens} tokens`);
console.log("-".repeat(60));
console.log(`Context 总计:                     ${(context.stable.chars + context.dynamic.chars).toString().padStart(5)} chars  ~${context.stable.tokens + context.dynamic.tokens} tokens\n`);

// 新版本总计
const newTotalTokens = segmentTokens + context.stable.tokens + context.dynamic.tokens;
console.log("【新版本总计】");
console.log("-".repeat(60));
console.log(`Prompt 段落 + Context:            ~${newTotalTokens} tokens\n`);

// 旧版本估算
const oldPrompt = await estimateOldPrompt();
console.log("【旧版本估算（WRITER_STREAM_SYSTEM）】");
console.log("-".repeat(60));
console.log(`硬编码模板字符串 (~140 lines):     ${oldPrompt.chars.toString().padStart(5)} chars  ~${oldPrompt.tokens} tokens`);
console.log(`Context (buildWriterContext):     估算与新版本相近，~${context.stable.tokens + context.dynamic.tokens} tokens\n`);

const oldTotalTokens = oldPrompt.tokens + context.stable.tokens + context.dynamic.tokens;

// 对比
console.log("【对比结果】");
console.log("═".repeat(60));
console.log(`旧版本总计:                       ~${oldTotalTokens} tokens`);
console.log(`新版本总计:                       ~${newTotalTokens} tokens`);
const delta = newTotalTokens - oldTotalTokens;
console.log(`增量 (Δ):                         ~${delta > 0 ? '+' : ''}${delta} tokens`);
console.log();

if (Math.abs(delta) <= 1500) {
  console.log(`✅ Token 增量在可控范围内 (|Δ| ≤ 1500)`);
} else {
  console.log(`⚠️  Token 增量超出预期 (|Δ| > 1500)`);
}

console.log("\n💡 注意事项:");
console.log("   - 此估算基于文本长度，实际 token 数取决于 tokenizer");
console.log("   - Context segments 使用典型场景估算（3角色，2场景历史）");
console.log("   - 禁词表（10个词）增加 ~20 tokens");
console.log("   - 实际 token 消耗需通过 Anthropic API usage 统计验证");
console.log("\n📄 建议通过 wrangler tail 监控实际 token 消耗");
