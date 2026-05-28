import { provisionVoice, synthesize } from "@yume/tts-client";
import type {
  BeatAudio,
  Character,
  CharacterVoice,
  Scene,
  Session,
  TtsConfig,
} from "@yume/types";

// Per-beat synth budget. MiMo's median synth is 3–7s; the tail can spike
// to 30–70s under concurrent load. Capping here means a single bad beat
// degrades to silent in <15s instead of blocking the whole UI flow.
const SYNTH_TIMEOUT_MS = 15000;

// When the director references a speaker that was never registered, derive a
// description from the name + world so the voice's gender/temperament is at
// least inferred from the name — never borrowed from another character.
function inferredSpeakerDescription(name: string, session: Session): string {
  return `请根据角色名「${name}」推断其性别、年龄与气质，生成最贴合的音色。所属世界观：${session.worldSetting}`;
}

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

// Provision voices for all unseen speakers in a scene, in parallel.
// Does NOT synthesize per-beat audio — that happens lazily via
// synthesizeBeat from the /api/beat-audio route. Returning the populated
// registry lets the client fire per-beat synth without re-provisioning.
//
// Why dedupe before fanning out: the SAME unseen speaker appearing in 3
// beats must run voicedesign once; parallel design of the same speaker
// would burn three voices' worth of budget and pick whichever raced last.
export async function provisionVoicesForScene(
  cfg: TtsConfig,
  session: Session,
  scene: Scene,
): Promise<{ characters: Character[] }> {
  const tScene = Date.now();
  const speakingBeats = scene.beats.filter(
    (b): b is typeof b & { speaker: string; line: string } =>
      Boolean(b.speaker && b.line),
  );

  let characters: Character[] = [...session.characters];
  const toProvision = new Map<string, string>(); // name -> description
  for (const b of speakingBeats) {
    if (toProvision.has(b.speaker)) continue;
    const existing = characters.find((c) => c.name === b.speaker);
    if (existing?.voice) continue;
    toProvision.set(
      b.speaker,
      existing?.description ?? inferredSpeakerDescription(b.speaker, session),
    );
  }

  if (toProvision.size === 0) {
    console.log(
      `[voice] provisionVoicesForScene total=${Date.now() - tScene}ms (no new speakers)`,
    );
    return { characters };
  }

  const tProvision = Date.now();
  const provisioned = await Promise.all(
    Array.from(toProvision.entries()).map(async ([name, description]) => {
      try {
        const voice = await provisionVoice(cfg, description);
        return { name, description, voice };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[voice] provision degraded for ${name}: ${msg}`);
        return { name, description, voice: undefined };
      }
    }),
  );
  console.log(
    `[voice] provision: ${toProvision.size} speakers parallel max=${Date.now() - tProvision}ms`,
  );

  for (const p of provisioned) {
    if (!p.voice) continue;
    const idx = characters.findIndex((c) => c.name === p.name);
    if (idx === -1) {
      characters.push({ name: p.name, description: p.description, voice: p.voice });
    } else {
      characters[idx] = { ...characters[idx]!, voice: p.voice };
    }
  }

  console.log(
    `[voice] provisionVoicesForScene total=${Date.now() - tScene}ms`,
  );
  return { characters };
}

// Synthesize audio for one beat. Caller is expected to have already
// resolved the speaker's voice (from session.characters in the client) —
// passing it directly here keeps the /api/beat-audio payload small and
// makes this function pure with respect to session state.
// Returns null on error or timeout; caller treats null as "play silent."
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
