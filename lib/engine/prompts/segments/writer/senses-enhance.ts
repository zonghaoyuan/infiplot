import type { PromptSegment } from "../../types";

export const WRITER_SENSES_ENHANCE: PromptSegment = {
  id: "writer-senses-enhance",
  name: "五感强化",
  type: "style-guideline",
  agent: "writer",
  zone: "stable",
  order: 113,
  enabled: true,
  editable: true,
  category: "文风",
  content: `═══════════════════════════════════════════════════════════════════
五感强化
═══════════════════════════════════════════════════════════════════
- 画面完全聚焦五感和实际的物理特征，不要写出情绪、心理、主观评判之类
- 尽量别用"眼里闪过一丝""不易察觉""不容置疑"之类公式化的描写
- 就算前文有写那些也别受影响`,
};
