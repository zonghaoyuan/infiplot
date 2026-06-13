import type {
  Beat,
  BeatChoice,
  WriterScenePlan,
  StreamRouterHandlers,
  StreamRouterResult,
} from "@infiplot/types";
import { parseJsonLoose } from "../jsonParser";

// ──────────────────────────────────────────────────────────────────────
//  StreamRouter — tagged stream splitter for paradigm D.
//
//  Consumes Writer's incremental textStream, recognizes <plan>/<beats>/
//  <choices> tag boundaries, and dispatches handlers at the right time:
//    - </plan>  closes → parse → onPlan (downstream media translators)
//    - <beats>  incremental → onBeat (client progressive playback)
//    - </beats> closes → parse full buffer → onBeatsComplete
//    - </choices> closes → parse → onChoices
//
//  RELIABILITY RULE: the degrade path is designed BEFORE the main path.
//  Any tag anomaly (missing / misordered / unclosed / timeout) → buffer
//  everything, attempt best-effort slicing, or treat the whole output
//  as raw beats text. Returns degraded=true. Never throws.
// ──────────────────────────────────────────────────────────────────────

type TagName = "plan" | "beats" | "choices";

const TAG_NAMES: TagName[] = ["plan", "beats", "choices"];

function openTag(name: TagName): string {
  return `<${name}>`;
}
function closeTag(name: TagName): string {
  return `</${name}>`;
}

function tryParseJson<T>(raw: string, label: string): T | undefined {
  try {
    return parseJsonLoose<T>(raw);
  } catch (err) {
    console.warn(`[StreamRouter] failed to parse ${label}:`, err);
    return undefined;
  }
}

function extractTagContent(buffer: string, name: TagName): string | undefined {
  const open = openTag(name);
  const close = closeTag(name);
  const start = buffer.indexOf(open);
  const end = buffer.indexOf(close);
  if (start === -1 || end === -1 || end <= start) return undefined;
  return buffer.slice(start + open.length, end);
}

/**
 * Route a Writer tagged stream to handlers. Pure logic — no LLM calls.
 *
 * Uses a cursor-based state machine over a growing fullBuffer: after each
 * chunk, scan from `cursor` for tag boundaries. This naturally handles
 * tags that split across chunk boundaries without double-buffering bugs.
 */
export async function routeTaggedStream(
  textStream: AsyncIterable<string>,
  handlers: StreamRouterHandlers,
  opts?: { timeoutMs?: number },
): Promise<StreamRouterResult> {
  const result: StreamRouterResult = {
    plan: undefined,
    beats: [],
    choices: undefined,
    rawBeatsSegment: undefined,
    degraded: false,
  };

  let fullBuffer = "";
  let cursor = 0;
  let currentTag: TagName | null = null;
  let tagContentStart = 0;
  let lastBeatEmitCursor = 0;
  let planDispatched = false;
  let beatsCompleted = false;

  const timeoutMs = opts?.timeoutMs ?? 120_000;
  let timedOut = false;

  function scan(): void {
    while (cursor < fullBuffer.length) {
      if (currentTag === null) {
        let earliestIdx = Infinity;
        let earliestTag: TagName | null = null;

        for (const name of TAG_NAMES) {
          const idx = fullBuffer.indexOf(openTag(name), cursor);
          if (idx !== -1 && idx < earliestIdx) {
            earliestIdx = idx;
            earliestTag = name;
          }
        }

        if (earliestTag === null) {
          cursor = fullBuffer.length;
          break;
        }

        currentTag = earliestTag;
        tagContentStart = earliestIdx + openTag(earliestTag).length;
        lastBeatEmitCursor = tagContentStart;
        cursor = tagContentStart;
        continue;
      }

      // Inside a tag — look for the close tag.
      const close = closeTag(currentTag);
      const closeIdx = fullBuffer.indexOf(close, cursor);

      if (closeIdx !== -1) {
        // Tag closed — extract and finalize.
        const content = fullBuffer.slice(tagContentStart, closeIdx);

        if (currentTag === "plan") {
          const parsed = tryParseJson<WriterScenePlan>(content, "plan");
          if (parsed) {
            result.plan = parsed;
            planDispatched = true;
            try { handlers.onPlan?.(parsed); } catch {}
          } else {
            result.degraded = true;
          }
        } else if (currentTag === "beats") {
          // Emit any remaining un-emitted beat text before finalizing.
          if (lastBeatEmitCursor < closeIdx) {
            const remaining = fullBuffer.slice(lastBeatEmitCursor, closeIdx);
            if (remaining.length) {
              try { handlers.onBeat?.(remaining); } catch {}
            }
          }
          // The <beats> segment may be a bare Beat[] or { beats, storyStatePatch }.
          // Parse as unknown, then extract the array flexibly.
          const parsed = tryParseJson<unknown>(content, "beats");
          result.rawBeatsSegment = parsed;
          let beatsArr: Beat[] | undefined;
          if (Array.isArray(parsed)) {
            beatsArr = parsed as Beat[];
          } else if (parsed && typeof parsed === "object" && Array.isArray((parsed as Record<string, unknown>).beats)) {
            beatsArr = (parsed as Record<string, unknown>).beats as Beat[];
          }
          if (beatsArr && beatsArr.length > 0) {
            result.beats = beatsArr;
            beatsCompleted = true;
            try { handlers.onBeatsComplete?.(beatsArr); } catch {}
          } else {
            result.degraded = true;
          }
        } else if (currentTag === "choices") {
          const parsed = tryParseJson<BeatChoice[]>(content, "choices");
          if (parsed && Array.isArray(parsed)) {
            result.choices = parsed;
            try { handlers.onChoices?.(parsed); } catch {}
          }
        }

        cursor = closeIdx + close.length;
        currentTag = null;
        continue;
      }

      // Close tag not yet in buffer — emit incremental beats if applicable.
      if (currentTag === "beats" && lastBeatEmitCursor < fullBuffer.length) {
        const newText = fullBuffer.slice(lastBeatEmitCursor);
        // Don't emit partial close-tag lookalikes: hold back the last few
        // chars that could be a partial "</beats>" (max 8 chars).
        const safeLen = Math.max(0, newText.length - closeTag("beats").length);
        if (safeLen > 0) {
          const safe = newText.slice(0, safeLen);
          try { handlers.onBeat?.(safe); } catch {}
          lastBeatEmitCursor += safeLen;
        }
      }

      cursor = fullBuffer.length;
      break;
    }
  }

  const consume = async (): Promise<void> => {
    for await (const chunk of textStream) {
      fullBuffer += chunk;
      scan();
    }
    // Final scan — flush any remaining buffer (handles close tags that
    // arrived in the last chunk without a subsequent iteration).
    scan();
  };

  try {
    await Promise.race([
      consume(),
      new Promise<void>((_, reject) =>
        setTimeout(() => {
          timedOut = true;
          reject(new Error("StreamRouter timeout"));
        }, timeoutMs),
      ),
    ]);
  } catch {
    // Timeout or stream error — fall through to degrade path.
  }

  // ── Degrade path ──────────────────────────────────────────────────
  if (!planDispatched || !beatsCompleted || timedOut) {
    result.degraded = true;

    if (!planDispatched) {
      const planContent = extractTagContent(fullBuffer, "plan");
      if (planContent) {
        const parsed = tryParseJson<WriterScenePlan>(planContent, "plan:degraded");
        if (parsed) {
          result.plan = parsed;
          try { handlers.onPlan?.(parsed); } catch {}
        }
      }
    }

    if (!beatsCompleted) {
      const beatsContent = extractTagContent(fullBuffer, "beats");
      if (beatsContent) {
        const parsed = tryParseJson<unknown>(beatsContent, "beats:degraded");
        result.rawBeatsSegment = parsed;
        let beatsArr: Beat[] | undefined;
        if (Array.isArray(parsed)) {
          beatsArr = parsed as Beat[];
        } else if (parsed && typeof parsed === "object" && Array.isArray((parsed as Record<string, unknown>).beats)) {
          beatsArr = (parsed as Record<string, unknown>).beats as Beat[];
        }
        if (beatsArr && beatsArr.length > 0) {
          result.beats = beatsArr;
          try { handlers.onBeatsComplete?.(beatsArr); } catch {}
        }
      }
    }

    if (!result.choices) {
      const choicesContent = extractTagContent(fullBuffer, "choices");
      if (choicesContent) {
        const parsed = tryParseJson<BeatChoice[]>(choicesContent, "choices:degraded");
        if (parsed && Array.isArray(parsed)) result.choices = parsed;
      }
    }

    if (timedOut) {
      console.warn(`[StreamRouter] timed out after ${timeoutMs}ms, degraded extraction attempted`);
    }
  }

  return result;
}
