import type { PromptSegment } from "../../types";

export const WRITER_ALIVE_FEEL: PromptSegment = {
  id: "writer-alive-feel",
  name: "活人感",
  type: "character-guideline",
  agent: "writer",
  zone: "stable",
  order: 116,
  enabled: true,
  editable: true,
  category: "角色",
  content: `═══════════════════════════════════════════════════════════════════
活人感
═══════════════════════════════════════════════════════════════════
- 角色要有真实感、活人感，别为了强调人设让角色变得不真实
- 更多的情感驱动而不是逻辑驱动
- 语言要直白生活化贴近日常，别说些莫名其妙的听不懂的话，严禁硬凹戏剧腔、表演化`,
};
