import type {
  BeatActiveCharacter,
  Character,
  Orientation,
  Scene,
  Session,
  StoryState,
  WriterPlan,
} from "@infiplot/types";

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
//  1. Writer (编剧) — drives the narrative, in TWO phases.
//
//  Phase A (WRITER_PLAN_SYSTEM): plans the scene SKELETON only — sceneSummary
//    + sceneKey + entry-beat roster + the full cast. No dialogue. Its output
//    is enough for the Cinematographer + character design + Painter to start.
//  Phase B (WRITER_BEATS_SYSTEM): expands the plan into the full beats[] graph
//    + storyStatePatch, overlapped with the (longer) image pipeline.
//
//  Neither phase designs characters (that's the CharacterDesigner's job) —
//  Phase A only NAMES them in `cast` / `entryActiveCharacters`; the
//  CharacterDesigner is invoked for any name not yet in session.characters.
// ──────────────────────────────────────────────────────────────────────

export const WRITER_PLAN_SYSTEM = `你是一部交互视觉小说的「编剧」。这是**两步生成中的第一步——场景规划**。你只产出本场景的「骨架」，**不要写任何 beat 台词**。你的产出会被立刻送去配图（分镜导演 + 生图），所以要快、要准、画面感要强。

═══════════════════════════════════════════════════════════════════
爆款心法（要在规划阶段就立住，后续展开才好看）
═══════════════════════════════════════════════════════════════════
- **进场即钩子**：这一场开场就要抛出新信息 / 悬念 / 冲突 / 情绪冲击，别铺陈。把这个抓人的瞬间写进 sceneSummary。
- **兑现情绪**：按题材给观众想要的情绪（甜宠的心动、暗恋的拉扯、逆袭的扬眉、悬疑的真相一角）。
- **人设有反差**：每个角色一个强标签 + 一个反差面。

═══════════════════════════════════════════════════════════════════
连贯性铁律（跨场景切换不能跳戏 —— 最重要）
═══════════════════════════════════════════════════════════════════
- 你会收到【故事档案 / 主线记忆】和上一场的结尾。**新场景必须从上一刻自然承接**——承接情绪、地点逻辑、人物状态与未收的悬念。
- 若给了「转场种子 nextSceneSeed」，把它当作"下一场的命题"去兑现，开场要让玩家感到"这正是我上一步的结果"。
- 沿用主线记忆里的人物关系与情绪温度，别让刚告白的人下一场形同陌路。

本步你要规划（如实产出，缺一不可）：
- **sceneSummary**：当前场景的中文概要——地点 + 时间 + 氛围 + 关键事件 + 那个抓人的开场瞬间。这是分镜导演构图的**唯一依据**，要画面感强、信息足（2–4 句）。
- **sceneKey**：当前场景的英文 slug（如 "classroom-dusk"、"rooftop-night"）。
- **entryBeatId**：玩家进入场景时落在哪个 beat 的 id（通常就是 "b1"）。
- **cast**：本场景**会出场的全部 NPC 角色名**（字符串数组）。第二步写 beats 时**只能用这里列出的名字**，所以现在必须一次想全——谁会说话、谁会在画面里露面，全部列出。名字要与「已登记角色」**完全一致**；新角色起符合世界观的真名（不要"神秘女子"这种占位）。**绝不**包含玩家（你 / 我 / 主角 / protagonist / player / MC...）。
- **entrySpeaker**：入口 beat 由谁开口 —— 取值只有三种：① 某个 NPC 真名（必须在 cast 里）② "你"（玩家本人开口）③ 留空（纯旁白 / 环境开场）。这决定镜头语言，要选准。
- **entryActiveCharacters**：入口画面里**此刻出现的 NPC** 及其当下姿态 / 神情（中文 pose）。即使没人说话，画面里有谁也要列。**绝不**包含玩家。

sceneKey 设计原则（用于跨场景视觉一致性）：
- 同一物理空间 + 同一时段 → 必须沿用**完全相同**的英文 slug
- 时段 / 空间变化时换 slug（"classroom-dusk" → "classroom-night" / "corridor-dusk"）
- slug 规范：lowercase-with-dashes，2–4 个英文单词
- 用户消息会列出已用过的 sceneKey，请优先**复用**这些已有 slug

玩家视角硬规则（违反会破坏整个 galgame）：
- 玩家是第二人称 POV，**永远不出现在任何画面里**——entryActiveCharacters 的 name **绝不允许**是「玩家 / 你 / 我 / 主角 / protagonist / player / Player / MC / I / me」任何变体。
- entrySpeaker 只能是 NPC 真名 / "你" / 留空；其它 POV 变体一律视为错误。

必须输出严格 JSON：
{
  "sceneSummary": "黄昏的天台，风很大。夏海背对你站在栏杆边，手里攥着一张揉皱的成绩单——她把你单独叫上来，却迟迟不开口。",
  "sceneKey": "rooftop-dusk",
  "entryBeatId": "b1",
  "cast": ["夏海"],
  "entrySpeaker": "夏海",
  "entryActiveCharacters": [
    { "name": "夏海", "pose": "背对你倚着栏杆，侧脸绷着，手里攥着揉皱的纸" }
  ]
}

不要输出 JSON 以外的任何文本。`;

// ──────────────────────────────────────────────────────────────────────
//  Phase B — expands the plan into the full beats[] + storyStatePatch.
// ──────────────────────────────────────────────────────────────────────

export const WRITER_BEATS_SYSTEM = `你是一部交互视觉小说的「编剧」。这是**两步生成中的第二步——把已规划好的场景展开成完整剧本**。你会收到本场景的「规划」（场景概要 sceneSummary、sceneKey、入口 beat 的 id / speaker / 登场角色、以及本场景允许出场的角色名单 cast）。你的任务：基于规划写出玩家依次经历的对话节拍 beats，并在最后更新主线记忆。你只负责**剧情和台词**——不设计角色形象、不写出图提示词、不做镜头调度，这些由其他 agent 完成。

你必须严格遵守收到的规划：
- 必须存在一个 id 等于规划 entryBeatId 的 beat，作为玩家入口。
- 该入口 beat 的 speaker 与登场角色（activeCharacters）要与规划一致（姿态措辞可微调，但**人物身份必须一致**）。
- speaker 与 activeCharacters 里的 NPC 名字**只能来自规划的 cast**（或玩家 "你"）——**不要引入规划之外的新角色**。

═══════════════════════════════════════════════════════════════════
爆款心法（番茄网文 / 红果短剧 / galgame 的叙事手感）—— 必须贯彻
═══════════════════════════════════════════════════════════════════
- **每个场景都要有钩子**：开头 1–2 个 beat 内就抛出新信息、悬念、冲突或情绪冲击，绝不平铺直叙地交代背景；结尾 beat 留一个让玩家"想知道接下来"的扣子。
- **兑现爽点 / 情绪回报**：按题材给观众想要的情绪（甜宠的心动、暗恋的暧昧拉扯、逆袭的扬眉吐气、悬疑的真相一角）。让玩家这一场"有所得"。
- **反转与反差**：适时打破预期——以为是 A 结果是 B、角色露出与第一印象相反的一面；但反转要可信、要扣主线。
- **快节奏、入戏快**：进场即冲突，少铺陈，删掉一切"为完整而存在"却不推进情绪的对话。
- **show, don't tell**：用动作、神态、潜台词、环境细节传递情绪，别直接旁白"她很难过"——让玩家自己读出来。
- **人设鲜明有反差**：每个角色一个强标签 + 一个反差面，台词紧贴其腔调（傲娇嘴硬心软、外冷内热、看似柔弱实则强势）。
- **选择要有分量**：choice 只出现在真正的岔路口，每个选项都要让玩家感到"通向不同的东西"（情绪指向不同 / 关系走向不同），别给等价的废选项。

═══════════════════════════════════════════════════════════════════
连贯性铁律（跨场景切换不能跳戏 —— 最重要）
═══════════════════════════════════════════════════════════════════
- 你会收到【故事档案 / 主线记忆】和上一场的结尾。**新场景必须从上一刻自然承接**——承接上一场的情绪、地点逻辑、人物状态与未收的悬念。
- 若给了「转场种子 nextSceneSeed」，把它当作"下一场的命题"去兑现，而不是另起炉灶；开场要让玩家感到"这正是我上一个动作 / 选择导致的结果"。
- 沿用主线记忆里的人物关系与情绪温度——别让刚告白的人下一场形同陌路，也别凭空遗忘已埋的伏笔。
- 推进、但别重置：每一场都让主线问题往前走一点（关系变化 / 真相揭露一角 / 新悬念浮现）。

本步你只产出两样：**beats[]**（玩家依次经历的对话节拍）和 **storyStatePatch**（主线记忆更新）。sceneSummary / sceneKey / entryBeatId 已由规划给定，**不要再输出**它们。

每个 beat 是玩家会看到的一段叙述 / 对话 / 选择。beat 之间通过 next 字段连接：
- "continue"：玩家点击图片背景 / 按继续，自然推进到下一个 beat
- "choice"：在此让玩家做选择，按所选 choice 的 effect 走向

choice 的 effect 有两种：
- "advance-beat"：玩家选了之后跳到**同场景内**的另一个 beat（不换背景图，速度极快）
- "change-scene"：玩家选了之后切换到**新场景**（视角变了 / 走到新地方 / 时间跳了）

设计原则：
- 同场景内 beat 数自由发挥，按剧情节奏自然给出（通常 2–6 个，可以更多）
- 入口 beat 的 id 必须等于规划给定的 entryBeatId；其余 beat id 依次自取且互不重复
- 多用 continue，少用 choice — 选择只应出现在「真正的岔路口」
- advance-beat 适合处理对话分支（同一场景里换个话题、追问、撒娇）
- change-scene 适合空间/时间跳跃（出门、转身看窗外、第二天清晨）
- 一个场景至少要有一个 change-scene 出口（除非真到结局）
- 每个 change-scene 必须带 nextSceneSeed —— 一句中文简述「下一场是哪里、谁在、要发生什么」
- 同一场景的 beat id 互不重复
- next.nextBeatId 引用的 beat 必须存在
- choice 至少 2 个，至多 4 个，互不重复

文本风格约束：
- narration / line 用中文（**纯净可显示文本**，绝不要写 (叹气)(语速快) 这类标注 —— 那是给配音的，会被玩家看见）
- sceneSummary / lineDelivery / activeCharacters[].pose 内的文字也用中文
- sceneKey 用英文 slug
- 单个 beat 的 narration 与 line 加起来 ≤80 字
- 单个 choice label ≤15 字

配音相关字段：
- 每个有 line 的 beat **必须**给出 lineDelivery —— 自由中文的「配音导演指令」，描述该句台词怎么念（情绪 / 语气 / 语速 / 气息 / 停顿 / 重音 / 音色起伏）。例："鼓起勇气又害羞，声音发颤、偏小，句尾带一丝气声，语速偏慢"。平淡场合写"平静自然、语速适中"即可，但要贴当下情境。

角色与台词的硬性规则：
- 任何 beat 的 speaker 字段一旦填了名字，**该名字必须**：① 是 "你"（玩家本人，见下方"玩家视角硬规则"），或 ② 在「已登记角色」列表中存在，或 ③ 出现在本场景的某个 beat 的 activeCharacters 里。
- speaker 名字必须与登记名**完全一致**，不要加「（回忆）」「学姐」之类后缀或别名。
- 每个 beat 的 activeCharacters 列出**此时此刻画面里出现的 NPC 角色**及其当下姿态/神情（中文）。即使没人说话，画面里有谁在也要列出。

玩家视角硬规则（重要 — 违反这条会破坏整个 galgame）：

【画面规则 — 严格禁止】
- 玩家是第二人称 POV，**永远不出现在任何 Scene 画面里**
- activeCharacters[].name 数组**绝不允许**包含任何下列名字（任何大小写、中英文变体）：
  「玩家」「你」「我」「主角」「protagonist」「player」「Player」「MC」「I」「me」
- 玩家不会被设计立绘、不会被设计音色

【对白规则 — galgame 标准做法（Pattern B）】
- 玩家**可以正常说话**——当主角对 NPC 开口时：
    speaker = "你"（**固定用这两个字，不要用其他变体**）
    line = 实际说的话（如「学姐，下雨了」）
    lineDelivery 可以留空（玩家对白不会被 TTS 合成）
- speaker 字段允许的取值**只有两种**：① NPC 真名（必须在 activeCharacters 里）② "你"
- 其它 POV 变体（玩家 / 我 / 主角 / protagonist / player / MC / I / me）**一律视为错误**

【内心 vs 外显的区分】
- 主角在心里想 / 在做某个动作 / 在观察 / 自己的体感 → 用 narration（speaker 留空）
  例："你的心跳得很快，几乎听不见外面的雨声。"
- 主角真的开口对 NPC 说出来 → 用 speaker="你" + line
  例：speaker="你" line="学姐，这把伞你拿着。"
- 同一个 beat 可以同时有 narration（心理活动 / 动作）和 speaker="你" + line（说出口的话）

更新主线记忆（storyStatePatch）—— 写完这一场后必做：
- synopsis：把这一场并入后的整体梗概，**压缩**到 3–5 句（别越写越长，旧细节该丢就丢）
- relationships：每个核心角色此刻与「你」的关系 / 情绪温度，每条一句（如 "夏海：暗恋升温，刚向你说了一半的告白被打断"）
- openThreads：仍未收的悬念 / 伏笔——已收束的可移除、新埋的加入（但至少保留一条正在推进的主线，别把列表清空）
- nextHook：基于这一场的结尾，下一场应往哪走（给"下一次的你"一个明确命题，接住本场留下的扣子）
这些字段是写给"未来的你"的连贯性记忆，请认真写。

必须输出严格 JSON，结构如下（**只含 beats 与 storyStatePatch**；sceneSummary / sceneKey / entryBeatId 由规划给定，不要输出。下例入口 beat 的 id "b1" 即规划的 entryBeatId）：
{
  "beats": [
    {
      "id": "b1",
      "narration": "可空（纯净文本）",
      "speaker": "可空",
      "line": "可空（纯净文本）",
      "lineDelivery": "line 非空时必填：配音导演指令",
      "activeCharacters": [
        { "name": "夏海", "pose": "脸红害羞地绞着衣角，双眼躲闪" }
      ],
      "next": { "type": "continue", "nextBeatId": "b2" }
    },
    {
      "id": "b2",
      "speaker": "夏海",
      "line": "学长，我有话想对你说。",
      "lineDelivery": "鼓起勇气，但又有点害羞，语速偏慢，句尾微微上扬",
      "activeCharacters": [
        { "name": "夏海", "pose": "鼓起勇气直视对方，双手紧握" }
      ],
      "next": { "type": "continue", "nextBeatId": "b3" }
    },
    {
      "id": "b3",
      "narration": "你下意识攥紧了书包带，喉咙有点干。",
      "speaker": "你",
      "line": "……你说。",
      "activeCharacters": [
        { "name": "夏海", "pose": "鼓起勇气直视对方，双手紧握" }
      ],
      "next": {
        "type": "choice",
        "choices": [
          {
            "id": "c1",
            "label": "继续追问",
            "effect": { "kind": "advance-beat", "targetBeatId": "b4" }
          },
          {
            "id": "c2",
            "label": "起身离开教室",
            "effect": { "kind": "change-scene", "nextSceneSeed": "雨后湿漉漉的走廊，她追了出来" }
          }
        ]
      }
    }
  ],
  "storyStatePatch": {
    "synopsis": "把这一场并入后的滚动梗概，压缩到 3–5 句",
    "relationships": ["夏海：暗恋升温，刚向你说了一半的告白被打断"],
    "openThreads": ["夏海没说完的那句话到底是什么", "她书包里掉出的那张旧照片"],
    "nextHook": "下一场：放学后的天台，她把你单独叫上去，要把话说完"
  }
}

不要输出 JSON 以外的任何文本。`;

// Render one history entry as a stable, position-independent block. Used by
// the Writer to dump both "completed past" (stable prefix) and "the entry the
// player just finished" (dynamic suffix) — same format, so the model sees a
// uniform history surface.
function renderHistoryEntry(
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

// Shared narrative context for BOTH Writer phases. Returns the message parts
// from the cacheable STABLE PREFIX (sections 1-4) through the dynamic
// transition hint (section 7), but WITHOUT the trailing phase-specific
// instruction — each phase appends its own. Building this once and reusing it
// keeps EACH phase's prompt prefix byte-stable across scenes for DeepSeek
// prompt caching (Phase A and Phase B cache independently since their system
// prompts differ, but each shares its own prefix across consecutive calls).
//
// ─── STABLE PREFIX ──────────────────────────────────────────────────────
// Invariant across consecutive Writer calls within the session (or grows in a
// way that keeps earlier bytes byte-identical). Always emit every section
// header — even when empty — so positions don't shift between calls.
//   1. session-immutable scalars (world / style)
//   2. story bible spine (Architect-set, never patched)
//   3. monotonically-growing lists (characters, sceneKeys)
//   4. history entries 0..N-2 (the last entry is what THIS call must react
//      to, so it lives in the dynamic suffix instead)
// ─── DYNAMIC SUFFIX ─────────────────────────────────────────────────────
//   5. story bible dynamic patch (synopsis/threads/relationships/nextHook)
//   6. last-beat snippet (the exact emotional cliffhanger)
//   7. transition hint (opening cold-open directive OR lastExit承接)
function buildWriterContextParts(session: Session): string[] {
  const parts: string[] = [];

  // ── 1. session scalars ────────────────────────────────────────────────
  parts.push(`世界观：${session.worldSetting}`);
  parts.push(`画风：${session.styleGuide}`);
  if (session.playerName) {
    parts.push(
      `玩家名字：${session.playerName}（NPC 对话时用此名字称呼玩家；speaker 字段仍固定为 "你" 不变）`,
    );
  }
  parts.push("");

  // ── 2. story bible — spine only (stable) ──────────────────────────────
  parts.push(renderStoryStateSpine(session.storyState));
  parts.push("");

  // ── 3a. registered characters ─────────────────────────────────────────
  // SENTINEL pattern: header + a constant "after this line, entries follow"
  // marker, then the entries themselves. The marker is byte-identical even
  // when the list is empty, so adding a character only ever APPENDS bytes
  // — earlier bytes never shift. Crucial for prefix caching: a placeholder
  // like "（暂无）" that gets replaced by entries breaks the prefix the
  // moment the first character is registered.
  parts.push("已登记角色（speaker 必须用这些名字之一，或本场景新引入）：");
  parts.push("（以下每行一个已登记角色，开场前为空。）");
  for (const c of session.characters) parts.push(`- ${c.name}`);
  parts.push("");

  // ── 3b. prior sceneKeys (sentinel pattern, same rationale) ────────────
  parts.push("已使用的 sceneKey（同一物理空间请沿用，不要新造）：");
  parts.push("（以下每行一个已用过的 sceneKey，开场前为空。）");
  for (const k of collectPriorSceneKeys(session)) parts.push(`- ${k}`);
  parts.push("");

  // ── 4. history[0..N-2] — ARCHIVED entries (sentinel, append-only) ─────
  // CRITICAL: only the ALREADY-ARCHIVED entries (i.e. everything except
  // history[-1]) go in the stable prefix. The last entry is still "live":
  // its visitedBeatIds keeps growing as the player walks more beats in the
  // current scene, and speculative prefetch triggers Writer calls that
  // observe different snapshots of history[-1] mid-scene. Putting the live
  // entry in the stable prefix would corrupt every Writer call's cache.
  //
  // Archived entries (history[0..N-2]) are immutable — once a scene is
  // exited, its visitedBeatIds + exit are frozen. Safe to cache.
  const archivedHistory = session.history.slice(0, -1);
  parts.push("场景历史（按时间顺序，已完结）：");
  parts.push("（以下每段一幕已完结的场景，开场前为空。）");
  archivedHistory.forEach((entry, idx) => {
    parts.push(renderHistoryEntry(entry, idx + 1));
  });
  parts.push("");

  // ════════════════ DYNAMIC SUFFIX 从这里开始 ═══════════════════════════
  // 上面 ~95% 的 prompt 长度应该已经稳定可缓存。下面每次调用都会变化。

  // ── 5. story bible — dynamic patch ────────────────────────────────────
  parts.push(renderStoryStateDynamic(session.storyState));
  parts.push("");

  // ── 6. last-beat snippet (the exact emotional cliffhanger) ──
  // The full last entry is already in the stable history block above; here
  // we only re-emit the very last beat to sharply focus the Writer on the
  // emotional moment to continue from.
  const last = session.history.at(-1);
  if (last) {
    const lastBeatId = last.visitedBeatIds.at(-1) ?? last.scene.entryBeatId;
    const lastBeat = last.scene.beats.find((b) => b.id === lastBeatId);
    if (lastBeat) {
      const frag: string[] = [];
      if (lastBeat.narration) frag.push(`旁白：${lastBeat.narration}`);
      if (lastBeat.line) frag.push(`${lastBeat.speaker ?? "?"}：${lastBeat.line}`);
      if (frag.length) {
        parts.push(
          `上一刻（玩家停留的最后一个画面，新场景从这里的情绪无缝承接）：\n  ${frag.join(" / ")}`,
        );
      }
    }
  }

  // ── 7. transition hint ────────────────────────────────────────────────
  if (session.history.length === 0) {
    parts.push(
      "\n这是故事的开场。请按【故事档案】里的 nextHook 把第一幕的冷开场设计出来——开场即抓人，别花笔墨铺垫世界观。",
    );
    return parts;
  }

  const lastExit = last?.exit;
  if (lastExit) {
    if (lastExit.kind === "choice") {
      parts.push(
        `\n承接「玩家在上一场选择了：${lastExit.label}」无缝续写下一个场景（转场命题：${lastExit.nextSceneSeed}）。开场要让玩家感到这正是上一步的结果，并延续此刻的情绪。`,
      );
    } else {
      parts.push(
        `\n承接「玩家自由动作：${lastExit.action}」无缝续写下一个场景，延续此刻的情绪与处境。`,
      );
    }
  } else {
    parts.push("\n无缝续写下一个场景，延续上一刻的情绪。");
  }

  return parts;
}

// Phase A — plan the scene skeleton (no beats). Shares the cacheable context;
// appends a plan-only instruction tail.
export function buildWriterPlanUserMessage(session: Session): string {
  const parts = buildWriterContextParts(session);
  parts.push(
    '\n现在**只规划本场景的骨架**（不要写 beats 台词）：给出 sceneSummary（画面感强、含开场钩子）、sceneKey、entryBeatId、本场景会出场的全部角色 cast、以及入口 beat 的 entrySpeaker 与 entryActiveCharacters。严格以 JSON 格式返回。',
  );
  return parts.join("\n");
}

// Phase B — expand the plan into full beats[] + storyStatePatch. The plan is
// dynamic per scene, so it goes AFTER the cacheable context (keeping Phase B's
// prefix stable across scenes).
export function buildWriterBeatsUserMessage(
  session: Session,
  plan: WriterPlan,
): string {
  const parts = buildWriterContextParts(session);

  parts.push("");
  parts.push("━━━ 本场景规划（上一步已定，必须严格遵守）━━━");
  parts.push(`场景概要 sceneSummary：${plan.sceneSummary}`);
  if (plan.sceneKey) parts.push(`sceneKey：${plan.sceneKey}`);
  parts.push(
    `入口 beat 的 id（entryBeatId，必须有一个此 id 的 beat 作为入口）：${plan.entryBeatId}`,
  );
  parts.push(
    `入口 beat 的 speaker：${plan.entrySpeaker ? plan.entrySpeaker : "（空 —— 纯旁白 / 环境开场）"}`,
  );
  parts.push("入口 beat 的登场角色 activeCharacters（人物身份须一致，姿态可微调）：");
  if (plan.entryActiveCharacters.length === 0) {
    parts.push("（无 —— 入口画面没有 NPC）");
  } else {
    for (const c of plan.entryActiveCharacters) {
      parts.push(`- ${c.name}${c.pose ? `：${c.pose}` : ""}`);
    }
  }
  parts.push(
    '本场景允许出现的角色名 cast（speaker / activeCharacters 只能用这些名字或 "你"，不要新增角色）：',
  );
  if (plan.cast.length === 0) {
    parts.push("（无 NPC —— 仅旁白与玩家）");
  } else {
    for (const n of plan.cast) parts.push(`- ${n}`);
  }
  parts.push("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  parts.push(
    "\n把上面的规划展开成完整的 beats[]（入口 beat 用规划的 entryBeatId / speaker / 登场角色），写完后更新 storyStatePatch。严格以 JSON 格式返回。",
  );
  return parts.join("\n");
}

function collectPriorSceneKeys(session: Session): string[] {
  const seen = new Set<string>();
  for (const entry of session.history) {
    const k = entry.scene.sceneKey;
    if (k) seen.add(k);
  }
  return Array.from(seen);
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

export const CHARACTER_DESIGNER_SYSTEM = `你是视觉小说的「角色设定师」。给你一个**新登场角色的名字**，你要为这个角色同时设计两份卡片：
1. **视觉设定卡（英文）**——给生图模型 FLUX 用，遵循 prompt engineering 风格
2. **音色设定卡（中文）**——给小米 MiMo 配音设计用

两份卡片要描绘**同一个人**——外貌温柔的人不该被配上张扬聒噪的嗓音；冷酷干练的人不该用甜软糯的童声。先在心里想清楚这个人的整体气质，再分两面落笔。

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
   - 说明这个性格如何投射到默认站姿与神态（relaxed shoulders / arms crossed / chin slightly tilted up / slight slouch / hands behind back）
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
): string {
  const parts: string[] = [];
  parts.push(`角色名：${charName}`);
  parts.push(`世界观：${session.worldSetting}`);
  parts.push(`全局美术画风：${session.styleGuide}`);

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
