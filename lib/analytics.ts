// Privacy-first analytics. Sends only content-free, categorical events to
// Umami, and only when the tracker script is actually present (gated by the
// NEXT_PUBLIC_UMAMI_* env vars in components/Analytics.tsx). With no script
// loaded — local dev, forks, a non-matching data-domains host, or a visitor
// with Do Not Track — `window.umami` is undefined and every call here is a
// silent no-op: zero runtime impact, no errors.
//
// RULE: never pass free text (player prompts, custom world/style guides,
// uploaded images, vision output) or any per-user identifier. Only enums,
// indices, counts and booleans — that is what keeps these events as
// privacy-friendly as the cookieless page-view baseline.

import type { ArtStyle, Gender, Pacing, PlotStyle } from "./options";

declare global {
  interface Window {
    umami?: {
      track: (event: string, data?: Record<string, unknown>) => void;
    };
  }
}

// Per-event payload schema. Fixing each event's allowed fields turns the RULE
// above into a compile-time guarantee: an event simply has no slot for a prompt,
// world/style guide or vision string, so free text can't be attached by mistake
// (a bare `Record<string, string>` would happily accept it). Every field is a
// literal union (shared with the selector UI via ./options), index, count or
// boolean — never a bare `string`. `never` marks events that carry no payload.
type AnalyticsEventData = {
  game_start:
    | {
        source: "prompt";
        gender: Gender;
        art_style: ArtStyle;
        plot_style: PlotStyle;
        pacing: Pacing;
        tts: boolean;
        has_prompt: boolean;
        has_style_ref: boolean;
      }
    | { source: "curated"; gender: Gender; tts: boolean; card: `${"m" | "f"}${number}` }
    | { source: "custom" };
  art_style_select: { style: ArtStyle };
  style_image_upload: { ok: boolean };
  scene_reached: { scene_index: number };
  choice_select: {
    scene_index: number;
    choice_index: number;
    kind: "advance-beat" | "change-scene";
  };
  vision_click: { result: "insert-beat" | "change-scene" };
  freeform_input: { scene_index: number; text_length: number };
  tts_toggle: { muted: boolean };
  fullscreen_toggle: { on: boolean };
  play_heartbeat: never;
  gallery_export: { scene_count: number; audio_count: number };
  login_success: { provider: "google" | "github" | "email" };
  play_error: {
    source: "scene" | "start" | "vision" | "insert_beat" | "freeform" | "prefetch";
    kind: "network" | "timeout" | "http_5xx" | "http_4xx" | "abort" | "unknown";
    http_status: number;
    orientation: "portrait" | "landscape";
    connection: "4g" | "3g" | "2g" | "slow-2g" | "unknown";
    was_hidden: boolean;
    scene_index: number;
    elapsed_bucket: "<5s" | "5-30s" | "30-60s" | "60-120s" | "120s+";
  };
  play_visibility_lost: {
    phase: "loading-first" | "ready" | "transitioning" | "vision-thinking" | "inserting-beat";
    had_pending_fetch: boolean;
  };
};

export type AnalyticsEvent = keyof AnalyticsEventData;

// Payload is required for events that define one and forbidden for those typed
// `never` (the conditional rest tuple collapses to `[]`), so `track("game_start")`
// without data and `track("play_heartbeat", {...})` with data are both errors.
export function track<E extends AnalyticsEvent>(
  event: E,
  ...[data]: AnalyticsEventData[E] extends never ? [] : [AnalyticsEventData[E]]
): void {
  if (typeof window === "undefined") return;
  try {
    window.umami?.track(event, data as Record<string, unknown> | undefined);
  } catch {
    // Analytics must never throw into the app.
  }
}
