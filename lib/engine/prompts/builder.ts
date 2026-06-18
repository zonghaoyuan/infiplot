import type { ChatMessage } from "@infiplot/ai-client";
import type { Session } from "@infiplot/types";
import { WRITER_SEGMENTS } from "./registry";
import { buildWriterContext } from "../context";
import { buildLanguageDirective } from "../prompts";

/**
 * Build the full ChatMessage[] for the Writer agent.
 *
 * Segments from the registry provide the system prompt (stable zone).
 * ContextProvider supplies session-specific data (stable + dynamic zones).
 * Dynamic parts are wrapped in a user message (Plan C: pseudo-dialogue closure).
 */
export function buildWriterStreamMessages(session: Session): ChatMessage[] {
  const systemParts: string[] = [];

  const segments = WRITER_SEGMENTS
    .filter((s) => s.enabled)
    .sort((a, b) => {
      if (a.zone !== b.zone) return a.zone === "stable" ? -1 : 1;
      return a.order - b.order;
    });

  for (const seg of segments) {
    try {
      const content =
        typeof seg.content === "string" ? seg.content : seg.content(session);
      if (content.trim()) systemParts.push(content);
    } catch (err) {
      console.warn(`[PromptBuilder] segment "${seg.id}" render failed, skipped:`, err);
    }
  }

  const { stableParts, dynamicParts } = buildWriterContext(session);

  const messages: ChatMessage[] = [];

  // System message: segment content + stable context data
  const systemContent = [
    ...systemParts,
    ...stableParts.filter((p) => p.trim()),
  ].join("\n\n");

  if (systemContent.trim()) {
    messages.push({ role: "system", content: systemContent });
  }

  // User message: dynamic context data + pseudo-dialogue closure (Plan C)
  const dynamicContent = dynamicParts.filter((p) => p.trim()).join("\n\n");
  if (dynamicContent.trim()) {
    const langDirective = buildLanguageDirective(session.language);
    messages.push({
      role: "user",
      content: `编剧，下面是当前情境：\n\n${dynamicContent}\n\n现在请按上述指导开始创作，严格按 <plan>→<story>→<choices> 三段输出：<plan> 用 JSON 规划，<story> 写连贯散文正文，<choices> 给出选项。${langDirective}`,
    });
  }

  return messages;
}
