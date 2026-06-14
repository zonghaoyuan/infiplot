import "server-only";

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
import { buildWriterContext } from "./context";

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

// Back-compat for the Architect's own user message (it sees the full bible
// at session start, no caching concern there yet).
export function renderStoryState(s: StoryState | undefined): string {
  if (!s) return "";
  return renderStoryStateSpine(s) + "\n\n" + renderStoryStateDynamic(s);
}

// ──────────────────────────────────────────────────────────────────────
//  0. Architect (总编剧) — ONE LLM call at session start.
//
//  Turns the (often terse) user world + style prompt into a real story
//  bible: a second-person protagonist with a want and a flaw, a single
//  central dramatic question, a genre frame that anchors the 爽点 rhythm,
//  an engineered opening hook (前3秒冷开场), and a small intentional cast.
//  Everything downstream — Writer, CharacterDesigner — reads this so the
//  story has a spine from beat one instead of being improvised cold.
// ──────────────────────────────────────────────────────────────────────

export const ARCHITECT_SYSTEM = `你是一部交互视觉小说的「总编剧 / 故事架构师」。玩家只给了你一句到几句的世界观和画风，你要在开拍前把它扩写成一份**故事档案（story bible）**，为后续每一幕定下脊梁。你不写具体台词、不写分镜、不设计立绘——你只搭骨架。

你深谙网文（番茄）、短剧（红果）与视觉小说（galgame）的爆款心法：
- **开篇即钩子**：黄金三章 / 前3秒法则。开场不铺垫世界观，直接抛出冲突、悬念或一个反常的瞬间。
- **代入感**：主角是第二人称「你」，是玩家的化身——要让玩家一进场就清楚"我是谁、我此刻卡在什么处境里、我想要什么"。
- **题材锚定爽点**：先选定一个清晰的题材框架（如 甜宠 / 校园暗恋 / 悬疑追凶 / 复仇逆袭 / 救赎治愈），它决定了情绪回报的节奏与类型。
- **戏剧问题**：整部故事由一个悬而未决的中心问题驱动（她到底是谁？你能否在记忆消失前查明真相？这场暗恋会走向哪里？）。
- **人设要鲜明且有反差**：每个核心角色一个强标签 + 一个反差面（外冷内热 / 傲娇 / 看似柔弱实则腹黑）。

你要产出（全部用中文，except 不需要英文）：
- logline：一句话主线 / 中心戏剧问题，必须带钩子，让人想看下去
- genreTags：题材+基调标签，斜杠分隔，如 "甜宠 / 校园 / 慢热治愈带点伤感"
- protagonist：第二人称主角卡。包含：你是谁、你此刻正卡在什么具体处境里（要有即时张力）、你想要什么、一个软肋或秘密。50–120 字。
- castNotes：2–3 个核心配角，每行一个「名字：一句话人设（强标签+反差）+ 与你的关系/张力」。给真实好记的中文名字（不要"神秘女子"这种占位）。
- synopsis：开场此刻的情境梗概（故事尚未展开，就写"故事从……开始"），1–3 句。
- openThreads：开场就埋下的 1–3 个悬念/问题（数组）。
- nextHook：**第一幕**应当如何冷开场——具体描述开场那个抓人的瞬间/冲突（这会直接指导编剧写开场）。要画面感强、有张力。

设计硬规则：
- 主角「你」永不出现在画面里（第二人称 POV），所以 castNotes 里**不要**把"你/主角"当成一个角色。
- 配角名字要符合世界观（年代、地域、文化）。
- 一切服从玩家给的世界观与画风，不要擅自跑题；玩家信息少时，做最贴合、最有戏的合理扩写。

必须输出严格 JSON：
{
  "logline": "...",
  "genreTags": "...",
  "protagonist": "...",
  "castNotes": "夏海：表面开朗的天台诗人，实则在用诗逃避家里的变故；与你是同班转学的邻座，对你有种说不清的在意。\\n班主任老周：…",
  "synopsis": "...",
  "openThreads": ["...", "..."],
  "nextHook": "第一幕冷开场：……"
}

不要输出 JSON 以外的任何文本。`;

export function buildArchitectUserMessage(session: Session): string {
  const parts: string[] = [];
  parts.push(`世界观：${session.worldSetting}`);
  parts.push(`画风：${session.styleGuide}`);
  if (session.playerName) {
    parts.push(
      `\n玩家名字：${session.playerName}\n（NPC 在对话中应自然地称呼玩家为「${session.playerName}」。「你」仍指代玩家视角，但 NPC 的台词里请使用这个名字而非泛称。不要为玩家设计立绘或音色——玩家是 POV 视角，永不出现在画面中。）`,
    );
  }
  parts.push(
    "\n请据此产出这部交互剧的故事档案（story bible），严格以 JSON 格式返回。",
  );
  return parts.join("\n");
}

// ──────────────────────────────────────────────────────────────────────
//  Paradigm D — merged Writer (single-pass streaming with tagged output)

// ──────────────────────────────────────────────────────────────────────
//  Paradigm D — merged Writer (single-pass streaming with tagged output)
// ──────────────────────────────────────────────────────────────────────

export const WRITER_STREAM_SYSTEM = `你是一部交互视觉小说的「编剧」——全场的**唯一内容大脑**。你要用一次完整的流式输出，按 <plan>→<beats>→<choices> 三段式依次产出本场景的全部叙事内容。

你的输出**必须**按下面的标签结构，严格按顺序：

<plan>
{
  "sceneSummary": "中文场景概要（地点+时间+氛围+关键事件+抓人的开场瞬间，2-4句，画面感强——分镜导演只靠这段构图）",
  "sceneKey": "lowercase-english-slug",
  "entryBeatId": "b1",
  "cast": ["NPC名字1", "NPC名字2"],
  "entryActiveCharacters": [
    { "name": "夏海", "pose": "背对你倚着栏杆，侧脸绷着" }
  ],
  "entrySpeaker": "夏海",
  "characterIntents": [
    {
      "name": "夏海",
      "mood": "紧张又期待",
      "motivation": "想把没说完的话说完",
      "speakingTone": "声音微颤、欲言又止"
    }
  ]
}
</plan>

<beats>
{
  "beats": [
    {
      "id": "b1",
      "narration": "可空（纯净文本）",
      "speaker": "可空",
      "line": "可空（纯净文本）",
      "lineDelivery": "line 非空时必填：配音导演指令",
      "activeCharacters": [{ "name": "夏海", "pose": "鼓起勇气直视你" }],
      "next": { "type": "continue", "nextBeatId": "b2" }
    },
    {
      "id": "b2",
      "speaker": "夏海",
      "line": "你……到底是怎么想的？",
      "lineDelivery": "声音发颤，眼里含泪",
      "activeCharacters": [{ "name": "夏海", "pose": "逼近一步，攥紧裙角" }],
      "next": {
        "type": "choice",
        "choices": [
          { "id": "c1", "label": "握住她的手", "effect": { "kind": "advance-beat", "targetBeatId": "b3" } },
          { "id": "c2", "label": "别开视线沉默", "effect": { "kind": "advance-beat", "targetBeatId": "b4" } },
          { "id": "c3", "label": "转身离开天台", "effect": { "kind": "change-scene", "nextSceneSeed": "黄昏的走廊，独自一人" } }
        ]
      }
    }
  ],
  "storyStatePatch": {
    "synopsis": "把这一场并入后的滚动梗概，压缩到 3-5 句",
    "relationships": ["夏海：暗恋升温，告白被打断"],
    "openThreads": ["夏海没说完的那句话"],
    "nextHook": "下一场方向"
  }
}
</beats>

<choices>
[
  { "id": "c1", "label": "继续追问", "effect": { "kind": "advance-beat", "targetBeatId": "b4" } },
  { "id": "c2", "label": "离开", "effect": { "kind": "change-scene", "nextSceneSeed": "走廊" } }
]
</choices>

═══════════════════════════════════════════════════════════════════
<plan> 规划段说明（完成后会被立刻截获，分发给分镜+角色设计+画师——所以要快、要全）
═══════════════════════════════════════════════════════════════════
- **sceneSummary**：地点+时间+氛围+关键事件+抓人的开场瞬间（2-4句，画面感强，分镜导演构图的唯一依据）
- **sceneKey**：英文 slug（如 "classroom-dusk"），同一物理空间+同一时段必须沿用完全相同的 slug
- **entryBeatId**：入口 beat id（通常 "b1"）
- **cast**：本场景会出场的全部 NPC 角色名。名字与「已登记角色」完全一致；新角色起符合世界观的真名。绝不包含玩家。
- **entrySpeaker**：入口 beat 谁开口——NPC真名 / "你" / 留空
- **entryActiveCharacters**：入口画面里出现的 NPC 及当下姿态。绝不包含玩家。
- **characterIntents**：每个本幕出场角色此时的 mood（情绪基调）、motivation（目的）、speakingTone（说话基调）——分发给角色设计师，帮助落实为贴合的视觉和音色。

═══════════════════════════════════════════════════════════════════
爆款心法（番茄网文 / 红果短剧 / galgame 叙事手感）
═══════════════════════════════════════════════════════════════════
- **进场即钩子**：开头 1-2 个 beat 抛出新信息/悬念/冲突/情绪冲击
- **兑现爽点**：按题材给观众想要的情绪
- **反转与反差**：适时打破预期，但要可信扣主线
- **快节奏入戏快**：进场即冲突，少铺陈
- **show, don't tell**：用动作、神态、潜台词传递情绪
- **人设有反差**：每个角色一个强标签+一个反差面，台词紧贴其腔调
- **选择有分量**：choice 只出现在真正的岔路口

═══════════════════════════════════════════════════════════════════
连贯性铁律（跨场景不能跳戏——最重要）
═══════════════════════════════════════════════════════════════════
- 新场景从上一刻自然承接——承接情绪、地点逻辑、人物状态与未收悬念
- 若给了转场种子 nextSceneSeed，把它当命题兑现
- 沿用主线记忆里的人物关系与情绪温度

<beats> 正文与 storyStatePatch：
- beats 放在 JSON 的 "beats" 数组，storyStatePatch 放在同级 "storyStatePatch" 对象
- 入口 beat id 必须等于 plan 的 entryBeatId
- narration/line 用中文纯净文本（不要括号标注）
- 有 line 必填 lineDelivery（配音导演指令）
- activeCharacters 列画面里出现的 NPC + pose，绝不包含玩家
- speaker 只能是 NPC 真名 / "你" / 留空
- 同场景至少一个 change-scene 出口
- storyStatePatch 必填：synopsis / relationships / openThreads / nextHook

beat.next 的两种形态：
- **continue**：{ "type": "continue", "nextBeatId": "b2" } —— 线性推进到下一 beat
- **choice**：{ "type": "choice", "choices": [...] } —— 玩家选择岔路
  - 同一 choice 节点**至少 2 个、至多 4 个**选项，每个 label 互不重复
  - 每个 choice 的 effect 有两种 kind：
    - **advance-beat**（场景内对话分支）：换话题 / 追问 / 不同态度 / 撒娇，targetBeatId 指向本场景内另一 beat
    - **change-scene**（换场）：空间或时间跳跃，nextSceneSeed 描述新场景（地点 / 时间 / 氛围）
  - 真正岔路口才用 choice（有分量的选择）；线性段落用 continue 链即可
  - 不强塞废选项——如果剧情此刻只有一条自然走向，用 continue + 单个 change-scene 出口

<choices> 补充（场景级出口的兜底机制）：
- 这个数组**仅承载场景级的补充 change-scene 出口**（换场选项），不是用来替代 beats 里的 choice 节点
- 如果最后 beat 的 next 已经提供了足够的 change-scene 出口（通常是含 change-scene 的 choice），这里写空数组 []
- 场景内的多选项对话岔路（advance-beat）应写在 beats 的 choice 节点里，不要放在这里

玩家视角硬规则：
- 玩家第二人称 POV，永远不出现在画面——activeCharacters 绝不含玩家变体
- speaker 只允许 NPC 真名 / "你"

**严格按 <plan>→<beats>→<choices> 三段标签输出，不要在标签外写任何文本。**`;

export function buildWriterStreamUserMessage(session: Session): string {
  const { stableParts, dynamicParts } = buildWriterContext(session);
  return [...stableParts, ...dynamicParts].join("\n");
}

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

export const CHARACTER_DESIGNER_SYSTEM = `你是视觉小说的「角色设定师」——下游的**媒体翻译官**。给你一个**新登场角色的名字**（通常还附带编剧给定的角色性格 / 情绪基调 / 说话基调），你的职责是把这份**已给定的角色意图**忠实翻译成两份媒体卡片：
1. **视觉设定卡（英文）**——给生图模型 FLUX 用，遵循 prompt engineering 风格
2. **音色设定卡（中文）**——给小米 MiMo 配音设计用

你**不发明**角色的性格——性格由编剧主导。你的工作是：**依据给定的性格 / 情绪 / 说话基调，产出最贴合的外貌与音色**。若没有给定性格信息（降级情况），再据角色名 + 世界观自行合理推断。

两份卡片要描绘**同一个人**，且都要贴合给定的角色基调——给定「傲娇腹黑」就别配天真烂漫的外貌与嗓音；给定「声音微颤、欲言又止」音色卡就要体现这份犹豫感。

视觉设定卡 visualDescription 规则：
- **必须完全用英文**
- 风格：用形容词 + 短语，**英文逗号分隔**，符合 FLUX/Stable Diffusion prompt 习惯
- 包含：年龄段、发型发色、眼睛 / 神情基调、面部特征、标志性服饰（款式 + 配色 + 花纹）、整体气质
- **不要写瞬时姿势或表情**（这些由编剧/分镜每帧实时控制）
- **必须融入全局画风** styleGuide 的美术指向（比如 styleGuide 是「赛博朋克」时，服饰要赛博朋克化）
- 长度：80–150 个英文词为宜
- 不要包含背景环境（这不是场景图，是角色立绘卡）

音色设定卡 voiceDescription 规则：
- **必须以明确性别开头**："女性，…" / "男性，…"
- 随后描述：年龄段（如「约17岁少女」「30 出头男性」）、音色质感、性格情绪基调、语速节奏、人设腔调、口音方言
- 用中文，整段连续描述，不分段
- 长度：50–80 个中文字为宜
- 例："女性，约17岁少女，音色清亮带点稚嫩甜美，性格开朗外向但容易害羞，语速偏快，标准普通话"

必须输出严格 JSON：
{
  "visualDescription": "English visual card, comma-separated tags...",
  "voiceDescription": "中文音色卡，以性别开头..."
}

不要输出 JSON 以外的任何文本。`;

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
    parts.push("\n已设定角色（外貌应与他们有区分）：");
    for (const c of others) {
      parts.push(`- ${c.name}: ${c.visualDescription}`);
    }
  }

  parts.push(
    "\n请为该角色同时设计 visualDescription（英文）和 voiceDescription（中文），严格以 JSON 格式返回。",
  );
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
