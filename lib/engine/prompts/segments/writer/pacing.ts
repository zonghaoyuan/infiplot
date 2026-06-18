import type { PromptSegment } from "../../types";

export const WRITER_PACING: PromptSegment = {
  id: "writer-pacing",
  name: "节奏控制",
  type: "narrative-guideline",
  agent: "writer",
  zone: "stable",
  order: 150,
  enabled: true,
  editable: true,
  category: "节奏",
  content: `═══════════════════════════════════════════════════════════════════
节奏控制
═══════════════════════════════════════════════════════════════════
# 创作范围：
- 剧情基于最新互动内容
- 不得擅自引入尚未提示的新角色

# 情节设计：
- 循序渐进，不得推进过快
- 戏剧张力轻微，贴合世界观和故事逻辑
- 转场必须有过程，不得突兀转场

# 篇幅控制：
- 每场景正文约 1500-2500 字（对白 + 旁白总计）
- 5-8 个 beat 为宜——太少无法展开情节，太多则拖沓
- 对白、旁白、内心独白交替穿插，不要连续堆叠多个纯对白 beat
- 旁白和内心独白可独立承载叙事推进与情绪铺垫，不是台词的附庸`,
};
