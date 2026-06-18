import type { PromptSegment } from "./types";
import { WRITER_IDENTITY } from "./segments/writer/identity";
import { WRITER_COT } from "./segments/writer/cot";
import { WRITER_BIBLE } from "./segments/writer/bible";
import { WRITER_STYLE_BASE } from "./segments/writer/style-base";
import { WRITER_SENSES_ENHANCE } from "./segments/writer/senses-enhance";
import { WRITER_BAIMIAO_ADVANCED } from "./segments/writer/baimiao-advanced";
import { WRITER_ALIVE_FEEL } from "./segments/writer/alive-feel";
import { WRITER_NARRATIVE_RULES } from "./segments/writer/narrative-rules";
import { WRITER_DIALOGUE } from "./segments/writer/dialogue";
import { WRITER_GUARDRAILS } from "./segments/writer/guardrails";
import { WRITER_PACING } from "./segments/writer/pacing";
import { WRITER_FORMAT } from "./segments/writer/format";

export const WRITER_SEGMENTS: PromptSegment[] = [
  WRITER_IDENTITY,
  WRITER_COT,
  WRITER_BIBLE,
  WRITER_STYLE_BASE,
  WRITER_SENSES_ENHANCE,
  WRITER_BAIMIAO_ADVANCED,
  WRITER_ALIVE_FEEL,
  WRITER_NARRATIVE_RULES,
  WRITER_DIALOGUE,
  WRITER_GUARDRAILS,
  WRITER_PACING,
  WRITER_FORMAT,
];

if (process.env.NODE_ENV === "development") {
  const ids = WRITER_SEGMENTS.map((s) => s.id);
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) {
      throw new Error(`[PromptRegistry] Duplicate segment ID: "${id}"`);
    }
    seen.add(id);
  }
}
