import { synthesize } from "@infiplot/tts-client";
import type { BeatAudio, CharacterVoice, TtsConfig } from "@infiplot/types";

// Per-beat synth budget. MiMo's median synth is 3–7s; the tail can spike
// to 30–70s under concurrent load. Capping here means a single bad beat
// degrades to silent in <15s instead of blocking the whole UI flow.
const SYNTH_TIMEOUT_MS = 15000;

// Race the work against a timer; on either outcome clear the timer (otherwise
// the success path leaks a 15s-pending reject closure into Node's timer heap,
// per-synth call). On timeout, abort the supplied controller so the underlying
// HTTP request is cancelled — otherwise MiMo's 30-70s tail keeps the socket
// open and the quota burning long after we've returned audio:null.
async function withTimeout<T>(
  p: Promise<T>,
  ms: number,
  label: string,
  ctrl: AbortController,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          ctrl.abort();
          reject(new Error(`${label} timed out after ${ms}ms`));
        }, ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// Synthesize audio for one beat. Caller is expected to have already
// resolved the speaker's voice (from session.characters in the client) —
// passing it directly here keeps the /api/beat-audio payload small and
// makes this function pure with respect to session state.
// Returns null on error or timeout; caller treats null as "play silent."
//
// (Voice PROVISIONING — designing a voice for a new character from a
// voiceDescription — lives in agents/characterDesigner.ts now. This file
// only handles per-beat SYNTHESIS using an already-provisioned voice.)
export async function synthesizeBeat(
  cfg: TtsConfig,
  voice: CharacterVoice,
  beat: { id: string; line: string; lineDelivery?: string },
): Promise<BeatAudio | null> {
  const t = Date.now();
  const ctrl = new AbortController();
  try {
    const { audioBase64, mimeType } = await withTimeout(
      synthesize(cfg, voice, beat.line, beat.lineDelivery, ctrl.signal),
      SYNTH_TIMEOUT_MS,
      `synth ${beat.id}`,
      ctrl,
    );
    console.log(`  [voice ${beat.id}] synth=${Date.now() - t}ms`);
    return { base64: audioBase64, mime: mimeType };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(
      `[voice] synth degraded for ${beat.id} (after ${Date.now() - t}ms): ${msg}`,
    );
    return null;
  }
}
