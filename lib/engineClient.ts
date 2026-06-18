import {
  startSession as startSessionClient,
  requestScene as requestSceneClient,
  visionDecide as visionDecideClient,
  classifyFreeform as classifyFreeformClient,
  requestInsertBeat as requestInsertBeatClient,
} from "@infiplot/engine";
import {
  readStoredModelConfig,
  resolveEngineConfig,
} from "@/lib/clientModelConfig";
import { loadClientTtsConfig } from "@/lib/clientTtsConfig";
import type {
  Character,
  FreeformClassifyRequest,
  FreeformClassifyResponse,
  EngineConfig,
  InsertBeatRequest,
  InsertBeatResponse,
  SceneRequest,
  SceneResponse,
  SceneStreamEvent,
  Session,
  StartRequest,
  StartResponse,
  TtsProvider,
  VisionRequest,
  VisionResponse,
} from "@infiplot/types";

function getClientConfig(): EngineConfig | null {
  const modelCfg = readStoredModelConfig();
  const ttsCfg = loadClientTtsConfig();
  if (!modelCfg) return null;
  return resolveEngineConfig(modelCfg, ttsCfg);
}

export class AuthRequiredError extends Error {
  constructor() {
    super("Unauthorized");
    this.name = "AuthRequiredError";
  }
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    if (res.status === 401) throw new AuthRequiredError();
    let message = `HTTP ${res.status}`;
    try {
      const data = (await res.json()) as { error?: string };
      if (data.error) message = data.error;
    } catch {
      // ignore parse failure, keep HTTP status message
    }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

// GET variant of postJson — same 401 → AuthRequiredError mapping. Used by
// getTtsProvider (a tiny config probe, no body).
async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path, { method: "GET" });
  if (!res.ok) {
    if (res.status === 401) throw new AuthRequiredError();
    throw new Error(`HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// ── FOT reduction helpers (server-fallback path only) ─────────────────
// The server-fallback POSTs send the whole Session over the wire. Voice
// data is bulky (~160KB/character via referenceAudioBase64) and the
// scene-generation / vision / classify pipelines never need it — voices
// are only consumed by /api/beat-audio, which receives them directly, not
// via the session. So strip voices before transport.
function stripVoicesForTransport(session: Session): Session {
  return {
    ...session,
    // Destructure voice out so the serialized payload drops the field
    // entirely (voice is optional on Character), rather than serializing
    // it as undefined/null. This is the ~160KB/character referenceAudioBase64
    // we want off the wire on the server-fallback path.
    characters: session.characters.map(({ voice: _voice, ...rest }) => rest),
  };
}

// The server strips voice from already-known characters before responding
// (see /api/scene stripKnownVoices and /api/insert-beat's blanket strip) to
// save bandwidth, so only NEW characters carry voice in the response. For
// existing characters, re-attach the voice the client already holds locally.
function mergeCharactersPreserveVoice(
  local: Character[],
  remote: Character[],
): Character[] {
  const localByName = new Map(local.map((c) => [c.name, c]));
  return remote.map((c) => {
    const prev = localByName.get(c.name);
    if (!prev) return c;
    return { ...c, voice: c.voice ?? prev.voice };
  });
}

// ── SSE consumption (server-fallback path) ───────────────────────────
// When an `emit` callback is provided, the server-fallback path requests
// SSE instead of JSON so the caller can render progressive events
// (plan → beat → background → voice → done). The final "done" event
// carries the complete response payload.

async function fetchSSE<T>(
  path: string,
  body: unknown,
  emit?: (event: SceneStreamEvent) => void,
): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(emit ? { Accept: "text/event-stream" } : {}),
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    if (res.status === 401) throw new AuthRequiredError();
    let message = `HTTP ${res.status}`;
    try {
      const data = (await res.json()) as { error?: string };
      if (data.error) message = data.error;
    } catch { /* keep HTTP status */ }
    throw new Error(message);
  }

  if (!emit || !res.headers.get("content-type")?.includes("text/event-stream")) {
    return res.json() as Promise<T>;
  }

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: T | undefined;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const parts = buffer.split("\n\n");
    buffer = parts.pop()!;

    for (const part of parts) {
      if (!part.trim()) continue;
      const dataLine = part.split("\n").find((l) => l.startsWith("data: "));
      if (!dataLine) continue;
      let event;
      try {
        event = JSON.parse(dataLine.slice(6));
      } catch {
        continue;
      }
      if (event.type === "done") {
        result = event.response as T;
      } else if (event.type === "error") {
        throw new Error(event.message || "Scene generation failed");
      } else {
        emit(event as SceneStreamEvent);
      }
    }
  }

  if (!result) throw new Error("SSE stream ended without a done event");
  return result;
}

// ── Unified entry points ───────────────────────────────────────────────
// When the browser has a BYO model config in localStorage, these call the
// client-side engine directly (talking to providers from the browser).
// Otherwise they fall back to the server-side API routes, which read
// environment variables — useful for Vercel deploys that already supply keys.

// Probe the server's TTS provider so fetchBeatAudio can shape its request body
// (skip the ~220KB Xiaomi reference audio when the server runs StepFun).
//
// BYO precedence: when the browser has a client model config (BYO mode),
// voice synthesis always runs locally against the user's own Xiaomi key, so
// the server provider is irrelevant — return "xiaomi" synchronously without a
// round-trip. Non-BYO → GET /api/tts-provider. Errors degrade to null (the
// caller then sends voice fields defensively and the server normalizes).
export async function getTtsProvider(): Promise<TtsProvider> {
  if (getClientConfig()) return "xiaomi";
  try {
    const data = await getJson<{ provider: TtsProvider }>("/api/tts-provider");
    return data.provider;
  } catch (e) {
    // AuthRequiredError (401) propagates so the caller's handleAuthError can
    // surface the login modal; other errors (network, 5xx) → null = unknown,
    // and fetchBeatAudio falls back to sending everything + server normalizes.
    if (e instanceof AuthRequiredError) throw e;
    console.warn("[getTtsProvider] probe failed, assuming unknown:", e);
    return null;
  }
}

export async function startSession(
  req: StartRequest,
  emit?: (event: SceneStreamEvent) => void,
): Promise<StartResponse> {
  const config = getClientConfig();
  if (config) {
    return startSessionClient(config, req, emit);
  }
  return fetchSSE<StartResponse>("/api/start", req, emit);
}

export async function requestScene(
  req: SceneRequest,
  emit?: (event: SceneStreamEvent) => void,
): Promise<SceneResponse> {
  const config = getClientConfig();
  if (config) {
    return requestSceneClient(config, req, emit);
  }
  const data = await fetchSSE<SceneResponse>("/api/scene", {
    ...req,
    session: stripVoicesForTransport(req.session),
  }, emit);
  // Server stripped known-character voices for bandwidth — re-attach the
  // voices we already hold so fetchBeatAudio can synth them.
  data.characters = mergeCharactersPreserveVoice(req.session.characters, data.characters);
  return data;
}

export async function visionDecide(req: VisionRequest): Promise<VisionResponse> {
  const config = getClientConfig();
  if (config) {
    return visionDecideClient(config, req);
  }
  return postJson<VisionResponse>("/api/vision", {
    ...req,
    session: stripVoicesForTransport(req.session),
  });
}

export async function classifyFreeform(
  req: FreeformClassifyRequest,
): Promise<FreeformClassifyResponse> {
  const config = getClientConfig();
  if (config) {
    return classifyFreeformClient(config, req);
  }
  return postJson<FreeformClassifyResponse>("/api/classify-freeform", {
    ...req,
    session: stripVoicesForTransport(req.session),
  });
}

export async function requestInsertBeat(
  req: InsertBeatRequest,
): Promise<InsertBeatResponse> {
  const config = getClientConfig();
  if (config) {
    return requestInsertBeatClient(config, req);
  }
  const data = await postJson<InsertBeatResponse>("/api/insert-beat", {
    ...req,
    session: stripVoicesForTransport(req.session),
  });
  // /api/insert-beat strips voice from ALL characters before responding —
  // re-attach every voice the client already holds so audio keeps working.
  data.characters = mergeCharactersPreserveVoice(req.session.characters, data.characters);
  return data;
}
