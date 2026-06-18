import type {
  BeatActiveCharacter,
  Character,
  CharacterIntent,
  Orientation,
  Scene,
  Session,
  StoryState,
  WriterPlan,
} from "@infiplot/types";
import { formatStepfunCatalogForPrompt } from "@infiplot/tts-client";

// ══════════════════════════════════════════════════════════════════════
//  Output-language directive — appended to user messages so the AI's
//  GENERATED dialogue, narration, and voice-design text follow the UI
//  locale the player picked. Returns "" for zh-CN (the prompts' native
//  language) so existing sessions behave byte-identically to before.
//
//  We intentionally append this as a TRAILING one-liner rather than
//  rewriting the system prompts in the target language — the prompts body
//  is the cacheable / reviewed / future-edit-friendly asset, and a single
//  trailing directive is enough for modern LLMs to switch their output
//  language while still receiving Chinese instructions.
// ══════════════════════════════════════════════════════════════════════
const LANG_LABELS: Record<string, string> = {
  "zh-CN": "简体中文",
  en: "English",
  ja: "日本語",
};

/**
 * Returns a one-line Chinese instruction telling the LLM to produce its
 * free-form output (dialogue, narration, voice-design text) in the player's
 * selected UI language. Returns an empty string for zh-CN sessions — those
 * are the prompts' native language and need no directive.
 *
 * Always returns Chinese regardless of session.language because the system
 * prompts are Chinese; the directive instructs the model to *output* in the
 * target language, not to read prompts in it.
 */
export function buildLanguageDirective(language: string | undefined): string {
  if (!language || language === "zh-CN") return "";
  const label = LANG_LABELS[language];
  if (!label) return "";
  return `\n【输出语言】你产出的所有自然语言内容（对白台词 line / 旁白 narration / sceneSummary / storyState 各字段 / voiceDescription / lineDelivery 等）必须使用「${label}」；JSON 字段名、sceneKey、英文 visualDescription / painting prompt 仍按各 agent 既有规则。`;
}

// ══════════════════════════════════════════════════════════════════════
//  Multi-agent scene generation pipeline:
//    Architect (总编剧)    — ONE-TIME at session start: the story bible
//                           (protagonist / logline / genre / opening hook /
//                            planned cast) → seeds StoryState
//    Writer (编剧)         — narrative + beats[] + per-beat activeCharacters,
//                           reads StoryState and emits a StoryStatePatch
//    CharacterDesigner    — per-new-character visual + voice cards
//    Cinematographer (分镜导演) — sceneKey + English compositional prompt
//    Painter (画师)        — FLUX rendering with character archetypes
//
//  Each agent owns one system prompt + one user-message builder below.
//  All agents see the same world / style guide, but each only reads the
//  slice of session state it needs to make its decision.
// ══════════════════════════════════════════════════════════════════════

// ──────────────────────────────────────────────────────────────────────
//  Shared — render the StoryState bible into a compact prompt block read
//  by the Writer (and Architect, on revisions). Keeping one renderer means
//  the bible looks identical to every agent that consumes it.
// ──────────────────────────────────────────────────────────────────────

// ── Story bible — split spine / dynamic for prefix-cache friendliness ──
//
// SPINE = Architect-set, never updated by Writer's storyStatePatch:
//   logline / genreTags / protagonist / castNotes
//   → goes in the STABLE PREFIX of every Writer user message
//
// DYNAMIC = patched every scene by the Writer:
//   synopsis / relationships / openThreads / nextHook
//   → goes in the DYNAMIC SUFFIX
//
// Keep both sections present even when empty (固定 section) so position is
// stable across calls — a missing section here would shift every byte after
// it and torch the cache.

export function renderStoryStateSpine(s: StoryState | undefined): string {
  const lines: string[] = ["【故事档案 · 主轴（不变）】"];
  lines.push(`主线（中心钩子）：${s?.logline ?? "（未设定）"}`);
  lines.push(`题材基调：${s?.genreTags ?? "（未设定）"}`);
  lines.push(`主角「你」：${s?.protagonist ?? "（未设定）"}`);
  lines.push(`核心配角：${s?.castNotes ?? "（未设定）"}`);
  return lines.join("\n");
}

export function renderStoryStateDynamic(s: StoryState | undefined): string {
  const lines: string[] = ["【故事档案 · 当前状态（每幕更新）】"];
  lines.push(`已发生（梗概）：${s?.synopsis ?? "（暂无）"}`);
  lines.push(
    `当前关系/情绪：${
      s?.relationships?.length
        ? "\n" + s.relationships.map((r) => `- ${r}`).join("\n")
        : "（暂无）"
    }`,
  );
  lines.push(
    `未收的悬念/伏笔：${
      s?.openThreads?.length
        ? "\n" + s.openThreads.map((t) => `- ${t}`).join("\n")
        : "（暂无）"
    }`,
  );
  lines.push(`接下来要往哪走（下一个钩子方向）：${s?.nextHook ?? "（暂无）"}`);
  return lines.join("\n");
}

// ──────────────────────────────────────────────────────────────────────
//  Paradigm D — merged Writer (single-pass streaming with tagged output)
// ──────────────────────────────────────────────────────────────────────

// Writer prompt has been refactored to segment-driven builder.
// See lib/engine/prompts/segments/writer/ for individual prompt segments.
// See lib/engine/prompts/registry.ts for segment registration.
// See lib/engine/prompts/builder.ts for assembly logic.

export { buildWriterStreamMessages } from "./prompts/builder";

// Render one history entry as a stable, position-independent block. Used by
// the Writer to dump both "completed past" (stable prefix) and "the entry the
// player just finished" (dynamic suffix) — same format, so the model sees a
// uniform history surface.
export function renderHistoryEntry(
  entry: Session["history"][number],
  index: number,
): string {
  const lines: string[] = [`【场景 ${index}】`];
  if (entry.scene.sceneKey) lines.push(`  sceneKey: ${entry.scene.sceneKey}`);

  const visited = entry.visitedBeatIds.length
    ? entry.visitedBeatIds
    : [entry.scene.entryBeatId];
  const beatById = new Map(entry.scene.beats.map((b) => [b.id, b]));
  const visitedBeats = visited
    .map((id) => beatById.get(id))
    .filter((b): b is NonNullable<typeof b> => Boolean(b));

  for (const b of visitedBeats) {
    const fragments: string[] = [];
    if (b.narration) fragments.push(`旁白：${b.narration}`);
    if (b.line) fragments.push(`${b.speaker ?? "?"}：${b.line}`);
    if (fragments.length) lines.push("  " + fragments.join(" / "));
  }

  if (entry.exit) {
    if (entry.exit.kind === "choice") {
      lines.push(
        `  玩家最终选择：${entry.exit.label}（去往：${entry.exit.nextSceneSeed}）`,
      );
    } else {
      lines.push(`  玩家自由动作：${entry.exit.action}`);
    }
  }
  return lines.join("\n");
}


// ──────────────────────────────────────────────────────────────────────
//  2. CharacterDesigner (角色设定师) — designs one new character.
//
//  Receives a character NAME (extracted by the Writer's activeCharacters)
//  and produces BOTH the English visual card AND the Chinese voice card
//  in a single LLM call. Bundling these two is intentional: a single agent
//  that "knows who this character is" produces internally-consistent
//  appearance + vocal personality, whereas split agents tend to diverge
//  (e.g., gentle-looking character with energetic voice).
// ──────────────────────────────────────────────────────────────────────

// CHARACTER_DESIGNER_SYSTEM is split into a provider-agnostic CORE (visual +
// voice-text rules) and a provider-specific TAIL (the JSON contract). When the
// server runs StepFun, the tail additionally asks the model to pick a preset
// voice id from the 32-entry catalog — so the SAME LLM call that designs the
// character also selects its voice, at zero extra latency. When StepFun is
// off (Xiaomi / no TTS), the tail is byte-identical to the historical prompt
// (Xiaomi path is cache- and behavior-preserving).
const CHARACTER_DESIGNER_SYSTEM_CORE = `你是视觉小说的「角色设定师」——下游的**媒体翻译官**。给你一个**新登场角色的名字**（通常还附带编剧给定的角色性格 / 情绪基调 / 说话基调），你的职责是把这份**已给定的角色意图**忠实翻译成两份媒体卡片：
1. **视觉设定卡（英文）**——给生图模型 FLUX 用，遵循 prompt engineering 风格
2. **音色设定卡（中文）**——给小米 MiMo 配音设计用

你**不发明**角色的性格——性格由编剧主导。你的工作是：**依据给定的性格 / 情绪 / 说话基调，产出最贴合的外貌与音色**。若没有给定性格信息（降级情况），再据角色名 + 世界观自行合理推断。

两份卡片要描绘**同一个人**，且都要贴合给定的角色基调——给定「傲娇腹黑」就别配天真烂漫的外貌与嗓音；给定「声音微颤、欲言又止」音色卡就要体现这份犹豫感。

视觉设定卡 visualDescription 规则：
- **必须完全用英文**
- 风格：用形容词 + 短语，**英文逗号分隔**，符合 FLUX/Stable Diffusion prompt 习惯
- **必须融入全局画风** styleGuide 的美术指向（比如 styleGuide 是「赛博朋克」时，服饰要赛博朋克化）
- **不要写瞬时姿势或表情**（这些由编剧/分镜每帧实时控制）
- 不要包含背景环境（这不是场景图，是角色立绘卡）
- 长度：100–180 个英文词为宜

**必须覆盖的 6 大要素 — 缺一项都会让角色撞脸：**
1. **HAIR（头发）** — 同时写明四点：
   ① 发色 hair color（具体到色相 + 明度，例 "platinum blonde" / "deep navy blue" / "warm chestnut brown"，不要只写 "dark hair"）
   ② 发型 hairstyle（具体款式：twin tails / side ponytail / hime cut / undercut / messy bob / long straight / wolf cut...）
   ③ 头发长度 hair length（chin-length / shoulder-length / waist-length / cropped 等明确量级）
   ④ 发饰或刘海特征（blunt bangs / curtain bangs / side-swept / hair ribbon / hairpin，可省但建议有一项）
2. **EYES（眼睛）** — 同时写明：
   ① 瞳色 eye color（具体色相，例 "amber" / "violet" / "icy blue"，不要只写 "dark eyes"）
   ② 眼型 eye shape（almond / round / sharp upturned / droopy / hooded）
   ③ 神情基调 default gaze tone（gentle / piercing / sleepy / mischievous，不写瞬时表情）
3. **FACE & BUILD（脸型 + 体格）** — 写 1–2 条标志性特征：
   - 脸型轮廓（oval / heart-shaped / sharp jawline / soft round）
   - 身高与体型相对感（tall and slim / petite / athletic build / broad shoulders）
   - 一个独特识别点（small mole below left eye / faint freckles / round glasses / fang teeth / scar across brow），用来在画面里第一眼区分
4. **OUTFIT（服饰）** — 同时写明：
   ① 主体款式（school uniform / casual streetwear / formal suit / kimono / lab coat / military / cyberpunk jacket...）
   ② 配色（主色 + 强调色，例 "navy blazer with crimson tie"，不要只写 "dark uniform"）
   ③ 至少一个标志性细节（collar shape / asymmetric hem / layered scarf / fingerless gloves / chunky boots / accessory like a pendant or earring）
   ④ 必须与 styleGuide 美术指向一致
5. **PERSONALITY-DRIVEN VIBE（性格→气质映射）** — 一句话：
   - 用 2–3 个性格关键词（gentle and reserved / sharp and aloof / cheerful and brash / cool and analytical / lazy and easygoing）
   - 说明这个性格如何投射到整体气场与氛围（approachable warmth / intimidating presence / quiet confidence / carefree aura / scholarly composure），不要写具体姿势动作
6. **OVERALL SILHOUETTE & VIBE TAG（整体剪影 + 一句气质标签）** — 一句话总结这个角色"远远一看就能认出来"的剪影特征

**差异化硬规则 — 避免与已设定角色撞型：**
你会收到「已设定角色清单」，每个条目包含 name + visualDescription。在落笔前**先在心里扫一遍**清单，提取每个角色的 hair color / hair length / eye color / outfit style，然后为新角色挑选**明显对比**的属性组合：
- **发色不能撞**：已有黑发 → 新角色避免黑、深棕；已有金发 → 新角色避免银、浅栗；至少跨一个色系（黑/棕/金/红/橙/银/灰/蓝/紫/绿）
- **瞳色不能撞**：同发色规则，跨色系挑选
- **剪影不能撞**：已有长直发 → 新角色用短发 / 双马尾 / 卷发 / 扎发；用"发长 × 发型"两个维度造差异
- **服饰风格至少一处明显差异**：款式（制服 vs 便服 vs 正装）、主色（暖 vs 冷）、轮廓（紧身 vs 宽松 / 长 vs 短）三者中至少一项明显不同
- 若剧情强制视觉相似（如双胞胎），必须在配饰或配色上做一处显著识别点

落笔顺序建议：先决定 personality keywords → 由性格反推合适的发色 / 服饰倾向 → 再与已有角色对照确认差异 → 最后写成英文 tag 串。

音色设定卡 voiceDescription 规则：
- **必须以明确性别开头**："女性，…" / "男性，…"
- 随后描述：年龄段（如「约17岁少女」「30 出头男性」）、音色质感、性格情绪基调、语速节奏、人设腔调、口音方言
- 用中文，整段连续描述，不分段
- 长度：50–80 个中文字为宜
- 例："女性，约17岁少女，音色清亮带点稚嫩甜美，性格开朗外向但容易害羞，语速偏快，标准普通话"`;

// JSON-contract tail for the NON-stepfun path (Xiaomi voicedesign / no TTS).
// Byte-identical to the historical prompt so the Xiaomi path keeps its cache
// hit rate and voice quality unchanged.
const CHARACTER_DESIGNER_TAIL_DEFAULT = `

必须输出严格 JSON：
{
  "visualDescription": "English visual card, comma-separated tags...",
  "voiceDescription": "中文音色卡，以性别开头..."
}

不要输出 JSON 以外的任何文本。`;

// JSON-contract tail for the StepFun path. Same core output, plus the model
// picks a preset voice id from the catalog. The id must match the SAME person
// the voiceDescription describes (gender / age / vibe) — designed together so
// appearance and voice stay coherent (the same invariant the CORE enforces).
const CHARACTER_DESIGNER_TAIL_STEPFUN = `

**StepFun 预设音色选择（必做）：**
除 voiceDescription 外，你还必须从下列 StepFun 预设音色清单中，为本角色挑选一个与 voiceDescription 描绘的「同一个人」（性别 / 年龄段 / 气质都要一致）最贴合的预设，并把它的 id 填入 stepfunVoiceId。清单：
${formatStepfunCatalogForPrompt()}

挑选原则：
- stepfunVoiceId 必须是上表里某个 id，原样复制（拼写、大小写、连字符都不能变）。
- 必须与 voiceDescription 的性别一致（男声选 male 行，女声选 female 行）。
- 年龄段尽量一致；拿不准时优先气质匹配（例如“冷艳御姐”选 lengyanyujie、“软萌萝莉”选 ruanmengnvsheng）。
- 不允许编造清单外的 id，也不允许留空。

必须输出严格 JSON：
{
  "visualDescription": "English visual card, comma-separated tags...",
  "voiceDescription": "中文音色卡，以性别开头...",
  "stepfunVoiceId": "清单内某个 id"
}

不要输出 JSON 以外的任何文本。`;

/** Build the CharacterDesigner system prompt, provider-aware.
 *  - stepfun:false → identical to the historical Xiaomi/no-TTS prompt.
 *  - stepfun:true  → additionally asks the model to pick a StepFun preset
 *    voice id from the 32-entry catalog (see formatStepfunCatalogForPrompt). */
export function buildCharacterDesignerSystem(opts: {
  stepfun: boolean;
}): string {
  return opts.stepfun
    ? CHARACTER_DESIGNER_SYSTEM_CORE + CHARACTER_DESIGNER_TAIL_STEPFUN
    : CHARACTER_DESIGNER_SYSTEM_CORE + CHARACTER_DESIGNER_TAIL_DEFAULT;
}

export function buildCharacterDesignerUserMessage(
  charName: string,
  session: Session,
  intent?: CharacterIntent,
): string {
  const parts: string[] = [];
  parts.push(`角色名：${charName}`);
  parts.push(`世界观：${session.worldSetting}`);
  parts.push(`全局美术画风：${session.styleGuide}`);

  // Writer-authored scene intent (paradigm D). When present, the designer
  // TRANSLATES this into visual + voice; when absent, it degrades to
  // name + worldSetting inference (old behavior).
  if (intent && (intent.mood || intent.motivation || intent.speakingTone)) {
    parts.push("\n编剧给定的角色基调（请据此设计，不要另起炉灶）：");
    if (intent.mood) parts.push(`- 情绪基调：${intent.mood}`);
    if (intent.motivation) parts.push(`- 动机 / 目的：${intent.motivation}`);
    if (intent.speakingTone) parts.push(`- 说话基调：${intent.speakingTone}`);
  }

  const others = session.characters.filter((c) => c.visualDescription);
  if (others.length > 0) {
    parts.push(
      "\n已设定角色清单（**新角色的发色 / 瞳色 / 发型轮廓 / 服饰必须与下方每一位都形成明显视觉对比，不允许撞型**）：",
    );
    for (const c of others) {
      parts.push(`- ${c.name}: ${c.visualDescription}`);
    }
    parts.push(
      "\n落笔前先逐个扫一遍上方角色的 hair color / hair length+style / eye color / outfit style，再为新角色挑选有明显跨色系或跨剪影对比的属性组合。",
    );
  }

  parts.push(
    "\n请为该角色同时设计 visualDescription（英文，必须覆盖 system 中的 6 大要素清单）和 voiceDescription（中文），严格以 JSON 格式返回。",
  );
  // When the player picked a non-zh-CN UI language, override the
  // system-prompt's "中文" voiceDescription guidance: the description text
  // flows into MiMo's voice-design, which gives better prosody when the
  // description is written in the target output language. (StepFun's 32
  // preset voices are fixed Chinese timbres, but voiceDescription is still
  // used as documentation + stepfunVoiceId picking context — keeping it
  // in the player's language is consistent.)
  const langDirective = buildLanguageDirective(session.language);
  if (langDirective) parts.push(langDirective);
  return parts.join("\n");
}

// ──────────────────────────────────────────────────────────────────────
//  3. Cinematographer (分镜导演) — composes the visual frame.
//
//  Reads the Writer's sceneSummary + active characters and produces the
//  English compositional prompt fed to FLUX. Does NOT describe the
//  characters themselves (those archetypes are appended at the Painter
//  stage from session.characters.visualDescription). Only describes the
//  ENVIRONMENT, lighting, camera framing, and how the characters are
//  positioned within the frame.
// ──────────────────────────────────────────────────────────────────────

export const CINEMATOGRAPHER_SYSTEM = `你是视觉小说的「分镜导演」。给你编剧的当前场景概要、活跃角色名单和他们在场景里的姿态描述，以及**入口 beat 的 speaker 信息**（用来决定镜头语言）。你的任务是**只用英文**写一段**纯环境+构图**的描述（integratedPrompt），交给画师作为出图主提示词。

你**不要**写角色的外貌细节——发色、服饰、脸型这些由其他 agent 提供，画师会把"角色档案卡"附加到你的 integratedPrompt 后面。你只关心：
- **环境**：地点、时间、天气、光线、空间细节（什么家具/植物/物件）
- **构图 / 镜头**：景别（wide shot / medium shot / close-up / over-the-shoulder）、机位、视角
- **人物在画面中的位置和姿态**（不写脸 / 不写穿什么——只写"哪个角色站在哪儿、在做什么"）
- **氛围**：情绪基调、色调、影调（warm dusk / cold neon / soft morning light）

═══════════════════════════════════════════════════════════════════
玩家视角硬规则（与画面相关，必须严格遵守）
═══════════════════════════════════════════════════════════════════
- 玩家本人**永远不出现在画面里**——不画 player 的身体、手、肩膀、背影、剪影、脚、头发
- integratedPrompt 中**绝对禁止**出现下列英文（或中文等价）：
    "first-person view" · "POV of the protagonist" · "player's hand / arm / shoulder / back"
    "protagonist visible" · "from the player's perspective" · "MC" · "player's silhouette"
- 镜头是一个"隐形的观察者位置"——可以位于玩家的视角附近（NPC 像在看玩家），但**绝不画出玩家本身**

═══════════════════════════════════════════════════════════════════
动态镜头策略（根据入口 beat 的 speaker 字段选择镜头）
═══════════════════════════════════════════════════════════════════
你会收到 entryBeatSpeaker 字段。按以下规则选镜头：

【entryBeatSpeaker = 某个 NPC 名字】 → NPC 正在对玩家说话
- 优先 **close-up 或 medium close-up**，NPC 看向画面外（= 看玩家）
- 关键英文：close-up / medium close-up, looking toward camera, eyes meeting the viewer,
  direct gaze, lips parted mid-speech
- 制造"她正在对你说话"的代入感（galgame 经典直视镜头）

【entryBeatSpeaker = "你"】 → 玩家正在对 NPC 说话
- 优先 **medium shot**，NPC 居中，做"在听玩家说话"的姿态
- 关键英文：medium shot, attentively listening, facing the camera,
  head slightly tilted, expression of attention
- ❌ 不要写 over-the-shoulder（因为这会暗示画出玩家肩膀，违反 POV 规则）

【entryBeatSpeaker 为空】 → 纯环境 / 旁白 beat
- 优先 **wide establishing shot**，展现环境氛围
- 关键英文：wide establishing shot, atmospheric mood, environmental detail
- 如果有 NPC 在场，他们可以处于远处 / 中景 / 自然状态（不必看镜头）

【entryBeatActive 有多个角色】 → 群像
- 使用 **medium group shot 或 medium wide shot**，多人在一个框内
- 关键英文：medium group shot, two-shot / three-shot, characters arranged in the frame

═══════════════════════════════════════════════════════════════════
输出 JSON 结构
═══════════════════════════════════════════════════════════════════
{
  "shotType": "close-up / medium shot / wide establishing / medium group shot / ...",
  "integratedPrompt": "English. Environment + composition + character positioning + camera language. No dialogue boxes, no UI. 80-150 words."
}

写作要求：
- integratedPrompt **必须英文**，遵循 FLUX prompt engineering 习惯（形容词 + 短语，英文逗号分隔，必要时短句）
- 提到具体角色时**只用其名字 + 动作**，例如 "Natsumi standing by the window, head slightly bowed"——绝不要写她长什么样
- 不描述任何 UI、字幕、对话框、边框
- 不描述图像之外的事情（不要写"this scene depicts..."这种 meta 句）
- 长度 80–150 英文词

不要输出 JSON 以外的任何文本。`;

// Stable hint block — invariant across every Cinematographer call in a
// session. Front-loading this (with the session-scoped styleGuide) gives the
// prefix cache something substantial to anchor on; without it, the per-scene
// `sceneSummary` would land in the first content chunk and force the whole
// user message to miss. Long enough to land beyond the 64-token chunk
// boundary that follows the system prompt.
const CINE_STABLE_HINT = [
  "",
  "以下为本次场景的输入。请基于这些信息：",
  "1. 选择最合适的 shotType（依据 system prompt 的动态镜头策略 + entryBeatSpeaker）。",
  "2. 写一段**只用英文**的 integratedPrompt——纯环境 + 构图 + 角色姿态/位置；服饰由画师另外通过 referenceImages 锁定，你只描述能看到的样貌与镜头。",
  "3. 若上一场与本场 sceneKey 相同，**强调连续性**（时段/情绪/构图微调），而不是重新设定空间。",
  "4. 严格按 system prompt 要求的 JSON schema 输出。",
  "",
].join("\n");

export function buildCinematographerUserMessage(
  sceneSummary: string,
  styleGuide: string,
  entryBeatActive: BeatActiveCharacter[],
  entryBeatSpeaker: string | undefined,
  priorSceneKey: string | undefined,
  currentSceneKey: string | undefined,
): string {
  const parts: string[] = [];

  // ─── STABLE PREFIX ──────────────────────────────────────────────────
  // styleGuide is session-immutable; CINE_STABLE_HINT is a true constant.
  // Together they're long enough to cross at least one 64-token chunk
  // boundary, so every subsequent Cinematographer call in this session can
  // cache-hit through this block.
  parts.push(`全局美术画风：${styleGuide}`);
  parts.push(CINE_STABLE_HINT);

  // ─── DYNAMIC SUFFIX ─────────────────────────────────────────────────
  // Always emit every section header — even when empty — so positions don't
  // shift between calls. (Caching of the dynamic section itself isn't
  // expected, but stable positioning helps when adjacent calls happen to
  // share a sceneSummary prefix.)
  parts.push(`当前场景（来自编剧）：${sceneSummary}`);
  parts.push("");

  parts.push("开场画面里的角色及其姿态：");
  if (entryBeatActive.length > 0) {
    for (const c of entryBeatActive) {
      parts.push(`- ${c.name}：${c.pose ?? "（无具体姿态描述）"}`);
    }
  } else {
    parts.push("（无角色，纯环境）");
  }
  parts.push("");

  // entryBeatSpeaker drives the dynamic camera policy (see CINEMATOGRAPHER_SYSTEM).
  // "你" means the player is speaking; an NPC name means an NPC is speaking;
  // empty means no dialog (pure environment / narration beat).
  if (entryBeatSpeaker === "你") {
    parts.push(
      '开场 beat 是**玩家说话**（speaker = "你"）——按动态镜头策略：medium shot，NPC 居中、做听玩家说话的姿态、看向画面外。**绝不要画出玩家**。',
    );
  } else if (entryBeatSpeaker) {
    parts.push(
      `开场 beat 是 **${entryBeatSpeaker} 在对玩家说话**（speaker = "${entryBeatSpeaker}"）——按动态镜头策略：close-up 或 medium close-up，${entryBeatSpeaker} 看向画面外（看玩家），眼神交流。`,
    );
  } else {
    parts.push(
      "开场 beat 没有 speaker（纯旁白/环境）——按动态镜头策略：wide establishing shot 展现环境氛围。",
    );
  }

  if (priorSceneKey && currentSceneKey && priorSceneKey === currentSceneKey) {
    parts.push(
      `\n注意：上一场和本场 sceneKey 都是 "${currentSceneKey}"——画师会把上一张场景图作为 referenceImages 之一锚定同一空间。integratedPrompt 应强调连续性。`,
    );
  }

  parts.push("\n请输出 shotType + integratedPrompt，严格以 JSON 格式返回。");
  return parts.join("\n");
}

// ──────────────────────────────────────────────────────────────────────
//  4. Painter (画师) — final image prompt assembly.
//
//  Not an LLM agent — a pure prompt-building function that combines the
//  Cinematographer's integratedPrompt with character archetype blocks
//  (visual cards) and the standard FLUX constraints.
// ──────────────────────────────────────────────────────────────────────

export function buildPainterPrompt(
  integratedPrompt: string,
  styleGuide: string,
  characters: { name: string; visualDescription?: string }[],
  orientation: Orientation = "landscape",
): string {
  const archetypeBlock = characters
    .filter((c) => c.visualDescription)
    .map((c) => `[CHARACTER: ${c.name}]\n${c.visualDescription}`)
    .join("\n\n");

  const archetypeSection = archetypeBlock
    ? `\n\nCHARACTER ARCHETYPES (anchor identity, outfit, and style across scenes — keep each character visually identical to their archetype):\n${archetypeBlock}`
    : "";

  const portrait = orientation === "portrait";
  const header = portrait
    ? "Generate a cinematic vertical (portrait) background illustration, 9:16 tall format (1024x1792)."
    : "Generate a cinematic landscape background illustration, 16:9 widescreen (1792x1024).";
  const orientationRule = portrait
    ? "- 9:16 PORTRAIT orientation — taller than wide. No landscape or square output."
    : "- 16:9 LANDSCAPE orientation — wider than tall. No portrait or square output.";

  return `${header}

ART STYLE: ${styleGuide}

SCENE COMPOSITION (from cinematographer — environment + camera framing + character positioning):
${integratedPrompt}${archetypeSection}

STRICT RULES — NEVER violate these:
- DO NOT draw any dialogue boxes, speech bubbles, text panels, or any rectangular overlay.
- DO NOT draw any buttons, choice options, menu items, or interactive UI elements.
- DO NOT render any Chinese or English text anywhere in the image.
- DO NOT add any HUD, interface chrome, or game UI elements.
- The image is a PURE BACKGROUND SCENE ONLY. All UI will be added as HTML on top.
${orientationRule}
- Leave the bottom 35% of the frame relatively uncluttered (darker or softer) so overlaid UI panels remain readable.
- Characters or key scene elements should be positioned in the upper 65% of the frame.
- Maintain character identity exactly as specified in CHARACTER ARCHETYPES — same face, same hairstyle, same outfit across every scene.

PLAYER POV RULES — the player / protagonist is the unseen viewer:
- The player / protagonist is NEVER visible in the frame — no body parts, no hands, no shoulders, no back of head, no silhouette, no feet, no hair.
- DO NOT use first-person POV that implies the player's body in frame.
- When an NPC is speaking to the player, they SHOULD look toward the camera (toward the player's implied position) — this creates eye contact without showing the player.
- The camera position represents the player's gaze; only NPCs, scenery, and objects are rendered.`;
}

// Character portrait prompt — for the per-character base image generated
// once when the CharacterDesigner introduces a new character. The portrait
// is used both as a client-side asset (立绘登场) and as a referenceImages
// entry when rendering later scenes for visual consistency.
export function buildCharacterPortraitPrompt(
  charName: string,
  visualDescription: string,
  styleGuide: string,
): string {
  return `Character concept portrait sheet, single character, full-body or upper-body composition, neutral standing pose, looking toward camera, neutral expression, plain neutral background (no environment, no scenery).

ART STYLE: ${styleGuide}

CHARACTER (${charName}):
${visualDescription}

STRICT RULES:
- ONE character only — no other people, no crowd, no background characters.
- Plain neutral background (off-white or soft gradient). NO environment, NO furniture, NO props beyond what's worn.
- Neutral, calm pose and expression — this is a reference sheet, not a dramatic shot.
- NO text, NO UI, NO watermark, NO border.
- The character should be clearly visible and centered, the pose natural and relaxed.
- 16:9 landscape orientation.`;
}

// ──────────────────────────────────────────────────────────────────────
//  Insert-Beat — given a freeform action (background click or typed
//  input) that stays *within* the current scene, generate one beat
//  with meaningful character interaction.
//  Single-agent path; no character design / no rendering involved.
// ──────────────────────────────────────────────────────────────────────

export const INSERT_BEAT_SYSTEM = `你是视觉小说编剧。玩家在当前场景内做了一个自由动作（可能是点击画面中的某个物件/角色，也可能是主动输入了一句话/动作）。请基于此动作，写出**一个有实质内容的 beat**。

核心原则——**玩家的动作必须得到回应**：
- 如果当前场景有 NPC 在场，NPC **必须对玩家的动作做出反应**（说话、表情变化、动作回应）。用 narration 描述玩家的动作，用 speaker + line 写 NPC 的回应。
- 如果场景中没有 NPC（纯环境），可以用 narration 描述玩家的观察/发现，给玩家一个新细节或情绪波动。
- 不要写"你想做什么但没做"这种无意义的犹豫——玩家已经做了，世界要有反馈。

文本风格约束：
- narration / line 用中文，**纯净可显示文本**，不要写 (叹气)(语速快) 这类配音标注
- narration 与 line 加起来 ≤100 字
- 不要打破当前场景的物理状态（玩家仍在原地）
- 不要生成选项或下一步指引 —— 玩家点击会自然回到原 beat
- 内容要"有所得"——一个新细节、一丝潜台词、一次真实的交流（show, don't tell）
- 白描为主：聚焦可观察的五感与物理特征，以角色的动作/神态本身传递情绪，不要以作者角度解释或议论；不写角色眼神/语气里的情绪（这些从台词与动作中自行体会）

speaker 字段允许的取值**只有两种**（与主路径 Writer 一致 — Pattern B galgame 标准）：
1. **已登记角色**里的 NPC 真名（**绝不允许引入新角色**）
2. **"你"** — 玩家本人开口说话（对白框显示，但不调 TTS）

其它任何 POV 变体（玩家 / 我 / 主角 / protagonist / player / MC / I / me）**一律错误**，请用 "你" 代替。

推荐模式（有 NPC 在场时）：
  narration = 描述玩家做了什么（动作/表情/心理）
  speaker = NPC 真名
  line = NPC 的回应台词
  lineDelivery = 配音导演指令

- 如果有 line 且 speaker = NPC，**必须**给出 lineDelivery（配音导演指令）
- 如果有 line 且 speaker = "你"，lineDelivery 可以留空（玩家对白不调 TTS）

必须输出严格 JSON：
{
  "narration": "...",
  "speaker": "...",
  "line": "...",
  "lineDelivery": "..."
}

narration/speaker/line/lineDelivery 都可为空字符串。不要输出 JSON 以外的任何文本。`;

export function buildInsertBeatUserMessage(
  session: Session,
  freeformAction: string,
): string {
  const parts: string[] = [];
  parts.push(`世界观：${session.worldSetting}`);
  if (session.playerName) {
    parts.push(
      `玩家名字：${session.playerName}（NPC 对话时用此名字称呼玩家；speaker 字段仍固定为 "你" 不变）`,
    );
  }

  if (session.characters.length > 0) {
    parts.push("\n已登记角色（speaker 只能用这些名字）：");
    for (const c of session.characters) {
      parts.push(`- ${c.name}`);
    }
  }

  const current = session.history.at(-1);
  if (current) {
    const scene: Scene = current.scene;
    parts.push(`\n当前场景：${scene.scenePrompt}`);
    const lastBeatId = current.visitedBeatIds.at(-1) ?? scene.entryBeatId;
    const lastBeat = scene.beats.find((b) => b.id === lastBeatId);
    if (lastBeat) {
      const recent: string[] = [];
      if (lastBeat.narration) recent.push(`旁白：${lastBeat.narration}`);
      if (lastBeat.line) recent.push(`${lastBeat.speaker ?? "?"}：${lastBeat.line}`);
      if (recent.length) parts.push(`刚才发生：${recent.join(" / ")}`);
    }
  }

  if (current) {
    const lastBeatId2 = current.visitedBeatIds.at(-1) ?? current.scene.entryBeatId;
    const lastBeat2 = current.scene.beats.find((b) => b.id === lastBeatId2);
    const activeNpcs = lastBeat2?.activeCharacters?.map((c) => c.name) ?? [];
    if (activeNpcs.length > 0) {
      parts.push(`当前画面中在场的 NPC：${activeNpcs.join("、")}（优先让在场 NPC 回应玩家）`);
    }
  }

  parts.push(`\n玩家此刻的自由动作：${freeformAction}`);
  parts.push("\n请生成一个有实质回应的 beat，严格以 JSON 格式返回。");
  const langDirective = buildLanguageDirective(session.language);
  if (langDirective) parts.push(langDirective);
  return parts.join("\n");
}

// ──────────────────────────────────────────────────────────────────────
//  Vision — interprets a background click and classifies the action.
//  Unchanged from staging (UI choices live in HTML, vision only judges
//  background clicks).
// ──────────────────────────────────────────────────────────────────────

export const VISION_SYSTEM_PROMPT = `你是视觉理解助手。玩家在视觉小说的背景图上点击了红色圆点位置（HTML 上的选项按钮不会走到你这里）。你的任务是：
1. 看清红点指向画面里的什么（物件、角色、空间、远处的方向）
2. 推断玩家想干什么
3. 判断这个动作是「场内探索」（不该换图）还是「场景切换」（要换图）

判断准则：
- "insert-beat"（场内探索）：观察画面里某个细节、自言自语、和当前角色继续互动、看一眼某个物件
- "change-scene"（场景切换）：走向画面深处的门 / 走廊、转头看向新方向（视角变了）、点了远处的另一个空间、暗示时间跳跃的物件（如时钟）

必须输出严格 JSON：
{
  "freeformAction": "玩家想做什么的一句中文描述，例如「想拿起桌上的钥匙」",
  "classify": "insert-beat" 或 "change-scene",
  "reasoning": "一句话说明判断理由"
}

不要输出 JSON 以外的任何文本。`;

export function buildVisionUserPrompt(scene: Scene | null): string {
  if (!scene) return "请判断玩家意图，并以 JSON 格式返回。";
  return `当前场景描述：${scene.scenePrompt}

红点位置即为玩家点击位置。请判断玩家意图与分类，以 JSON 格式返回。`;
}

// ──────────────────────────────────────────────────────────────────────
//  Freeform Classify — classifies a player's freeform text input at a
//  choice node into one of: match an existing choice, insert a beat
//  in-scene, or trigger a scene change.
// ──────────────────────────────────────────────────────────────────────

export const FREEFORM_CLASSIFY_SYSTEM = `你是交互视觉小说的意图分类助手。玩家在一个选择节点输入了自由文本（而非点击已有选项）。你要判断这个输入最适合走哪条路径：

1. "insert-beat"：玩家想在当前场景内与角色互动（问一句话、做一个动作、表达情绪、调查某个东西）→ NPC 会对玩家的动作做出回应，但不切换场景
2. "change-scene"：玩家想去别的地方、做出重大决定、推动剧情到新阶段 → 切换到全新场景

判断准则：
- 大多数对话类输入（问问题、说一句话、对角色做出反应）→ "insert-beat"
- 明确要离开当前场景、去别的地方、跳过时间、做出改变人物关系的重大决定 → "change-scene"
- 拿不准时偏向 "insert-beat"（场内互动成本低，体验更流畅）

必须输出严格 JSON：
{
  "classify": "insert-beat" 或 "change-scene",
  "freeformAction": "玩家想做什么的一句中文描述（用于后续编剧参考）"
}

不要输出 JSON 以外的任何文本。`;

export function buildFreeformClassifyUserMessage(
  freeformText: string,
  scenePrompt: string | undefined,
): string {
  const parts: string[] = [];
  if (scenePrompt) {
    parts.push(`当前场景：${scenePrompt}`);
  }
  parts.push(`\n玩家输入：「${freeformText}」`);
  parts.push("\n请判断分类，以 JSON 格式返回。");
  return parts.join("\n");
}

export type PainterCharacterInput = Pick<Character, "name" | "visualDescription">;
