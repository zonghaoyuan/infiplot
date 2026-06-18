import type { Session } from "@infiplot/types";

/**
 * Prompt 段落类型枚举
 */
export type PromptSegmentType =
  | "system-identity" // 系统身份
  | "narrative-guideline" // 叙事准则
  | "style-guideline" // 文风准则
  | "character-guideline" // 角色行为准则
  | "format-instruction" // 输出格式（JSON schema）
  | "data-injection" // 数据注入（marker）
  | "cot-instruction"; // 思维链指导

/**
 * Prompt 段落数据结构
 *
 * 为未来后台编辑器预留字段：id/name/type/category/enabled/editable
 */
export type PromptSegment = {
  /** 唯一标识，如 "writer-style-base" */
  id: string;
  /** 显示名称，如 "文风基准" */
  name: string;
  /** 段落类型 */
  type: PromptSegmentType;
  /** 所属 agent */
  agent: "writer" | "architect" | "character-designer" | "cinematographer" | "painter";
  /** cache 分区：stable 为缓存友好前缀，dynamic 为每次变化的后缀 */
  zone: "stable" | "dynamic";
  /** 排序权重（0-999），同 zone 内按此排序 */
  order: number;
  /** 段落内容：静态字符串 或 动态渲染函数 */
  content: string | ((session: Session) => string);
  /** 是否启用 */
  enabled: boolean;
  /** 是否允许后台编辑（预留） */
  editable: boolean;
  /** 分组标签，如 "文风"/"功能"（UI 展示用） */
  category?: string;
  /** 消息角色（预留，暂不用于完整 multi-role 支持） */
  role?: "system" | "user" | "assistant";
};
