import type { Session, Character } from "@infiplot/types";
import {
  renderStoryStateSpine,
  renderStoryStateDynamic,
  renderHistoryEntry,
} from "../prompts";

// ──────────────────────────────────────────────────────────────────────
//  ContextProvider — data-driven segment registry.
//
//  Replaces the monolithic `buildWriterContextParts` (prompts.ts:425)
//  with a registered list of segments, each rendered independently.
//
//  Invariants:
//  - **SENTINEL append-only**: character-cards / sceneKeys / archived-
//    history use a fixed header + "entries follow" sentinel line. Adding
//    a character only APPENDS bytes; earlier bytes never shift. This is
//    crucial for prompt prefix caching.
//  - **stable / dynamic split**: stable segments form the cached prefix;
//    dynamic segments are the suffix that changes every call. Mixing them
//    would destroy cache hit rate.
//  - **try/catch isolation**: a failing segment is skipped, not fatal.
// ──────────────────────────────────────────────────────────────────────

export type ContextSegment = {
  id: string;
  zone: "stable" | "dynamic";
  order: number;
  render: (session: Session) => string[];
};

// ── Stable segments ─────────────────────────────────────────────────

const worldAndStyle: ContextSegment = {
  id: "world-style",
  zone: "stable",
  order: 100,
  render: (session) => {
    const parts: string[] = [];
    parts.push(`世界观：${session.worldSetting}`);
    parts.push(`画风：${session.styleGuide}`);
    if (session.playerName) {
      parts.push(
        `玩家名字：${session.playerName}（NPC 对话时用此名字称呼玩家；speaker 字段仍固定为 "你" 不变）`,
      );
    }
    return parts;
  },
};

const storySpine: ContextSegment = {
  id: "story-spine",
  zone: "stable",
  order: 200,
  render: (session) => [renderStoryStateSpine(session.storyState)],
};

function renderCharacterCard(c: Character): string[] {
  const hasPersona =
    c.persona || c.speakingStyle || c.sampleDialogue?.length || c.relationshipToPlayer;
  if (!hasPersona) return [`- ${c.name}`];

  const lines: string[] = [`- ${c.name}`];
  if (c.persona) lines.push(`  设定：${c.persona}`);
  if (c.personalityTraits?.length)
    lines.push(`  性格：${c.personalityTraits.join("、")}`);
  if (c.speakingStyle) lines.push(`  说话风格：${c.speakingStyle}`);
  if (c.sampleDialogue?.length) {
    lines.push(`  对白示例：`);
    for (const d of c.sampleDialogue) lines.push(`    「${d}」`);
  }
  if (c.relationshipToPlayer)
    lines.push(`  与玩家关系：${c.relationshipToPlayer}`);
  return lines;
}

const characterCards: ContextSegment = {
  id: "character-cards",
  zone: "stable",
  order: 300,
  render: (session) => {
    // SENTINEL: header + marker are byte-identical even when the list is
    // empty. Adding a character only APPENDS bytes — never shifts earlier.
    const parts: string[] = [];
    parts.push("已登记角色（speaker 必须用这些名字之一，或本场景新引入）：");
    parts.push("（以下每行一个已登记角色，开场前为空。）");
    for (const c of session.characters) {
      parts.push(...renderCharacterCard(c));
    }
    return parts;
  },
};

function collectPriorSceneKeys(session: Session): string[] {
  const seen = new Set<string>();
  for (const entry of session.history) {
    const k = entry.scene.sceneKey;
    if (k) seen.add(k);
  }
  return Array.from(seen);
}

const priorSceneKeys: ContextSegment = {
  id: "prior-sceneKeys",
  zone: "stable",
  order: 400,
  render: (session) => {
    // SENTINEL pattern — same rationale as character-cards.
    const parts: string[] = [];
    parts.push("已使用的 sceneKey（同一物理空间请沿用，不要新造）：");
    parts.push("（以下每行一个已用过的 sceneKey，开场前为空。）");
    for (const k of collectPriorSceneKeys(session)) parts.push(`- ${k}`);
    return parts;
  },
};

const archivedHistory: ContextSegment = {
  id: "archived-history",
  zone: "stable",
  order: 500,
  render: (session) => {
    // Only history[0..N-2] — the last entry is live (visitedBeatIds still
    // growing, speculative prefetch sees different snapshots). Putting it
    // here would corrupt prefix cache.
    const archived = session.history.slice(0, -1);
    const parts: string[] = [];
    parts.push("场景历史（按时间顺序，已完结）：");
    parts.push("（以下每段一幕已完结的场景，开场前为空。）");
    archived.forEach((entry, idx) => {
      parts.push(renderHistoryEntry(entry, idx + 1));
    });
    return parts;
  },
};

const loreConstant: ContextSegment = {
  id: "lore-constant",
  zone: "stable",
  order: 600,
  render: () => [],
};

// ── Dynamic segments ────────────────────────────────────────────────

const storyDynamic: ContextSegment = {
  id: "story-dynamic",
  zone: "dynamic",
  order: 100,
  render: (session) => [renderStoryStateDynamic(session.storyState)],
};

const lastBeat: ContextSegment = {
  id: "last-beat",
  zone: "dynamic",
  order: 200,
  render: (session) => {
    const last = session.history.at(-1);
    if (!last) return [];
    const lastBeatId = last.visitedBeatIds.at(-1) ?? last.scene.entryBeatId;
    const beat = last.scene.beats.find((b) => b.id === lastBeatId);
    if (!beat) return [];
    const frag: string[] = [];
    if (beat.narration) frag.push(`旁白：${beat.narration}`);
    if (beat.line) frag.push(`${beat.speaker ?? "?"}：${beat.line}`);
    if (!frag.length) return [];
    return [
      `上一刻（玩家停留的最后一个画面，新场景从这里的情绪无缝承接）：\n  ${frag.join(" / ")}`,
    ];
  },
};

const transitionHint: ContextSegment = {
  id: "transition-hint",
  zone: "dynamic",
  order: 300,
  render: (session) => {
    if (session.history.length === 0) {
      return [
        "这是故事的开场。请按【故事档案】里的 nextHook 把第一幕的冷开场设计出来——开场即抓人，别花笔墨铺垫世界观。",
      ];
    }
    const last = session.history.at(-1);
    const lastExit = last?.exit;
    if (lastExit) {
      if (lastExit.kind === "choice") {
        return [
          `承接「玩家在上一场选择了：${lastExit.label}」无缝续写下一个场景（转场命题：${lastExit.nextSceneSeed}）。开场要让玩家感到这正是上一步的结果，并延续此刻的情绪。`,
        ];
      }
      return [
        `承接「玩家自由动作：${lastExit.action}」无缝续写下一个场景，延续此刻的情绪与处境。`,
      ];
    }
    return ["无缝续写下一个场景，延续上一刻的情绪。"];
  },
};

const loreTriggered: ContextSegment = {
  id: "lore-triggered",
  zone: "dynamic",
  order: 400,
  render: () => [],
};

// ── Registry ────────────────────────────────────────────────────────

const defaultSegments: ContextSegment[] = [
  worldAndStyle,
  storySpine,
  characterCards,
  priorSceneKeys,
  archivedHistory,
  loreConstant,
  storyDynamic,
  lastBeat,
  transitionHint,
  loreTriggered,
];

export function buildWriterContext(
  session: Session,
  segments: ContextSegment[] = defaultSegments,
): { stableParts: string[]; dynamicParts: string[] } {
  const stable = segments
    .filter((s) => s.zone === "stable")
    .sort((a, b) => a.order - b.order);
  const dynamic = segments
    .filter((s) => s.zone === "dynamic")
    .sort((a, b) => a.order - b.order);

  const stableParts: string[] = [];
  for (const seg of stable) {
    try {
      stableParts.push(...seg.render(session));
      stableParts.push("");
    } catch (err) {
      console.warn(`[ContextProvider] segment "${seg.id}" render failed, skipped:`, err);
    }
  }

  const dynamicParts: string[] = [];
  for (const seg of dynamic) {
    try {
      dynamicParts.push(...seg.render(session));
      dynamicParts.push("");
    } catch (err) {
      console.warn(`[ContextProvider] segment "${seg.id}" render failed, skipped:`, err);
    }
  }

  return { stableParts, dynamicParts };
}
