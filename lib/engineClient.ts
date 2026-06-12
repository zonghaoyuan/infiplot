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
  FreeformClassifyRequest,
  FreeformClassifyResponse,
  EngineConfig,
  InsertBeatRequest,
  InsertBeatResponse,
  SceneRequest,
  SceneResponse,
  StartRequest,
  StartResponse,
  VisionRequest,
  VisionResponse,
} from "@infiplot/types";

function getClientConfig(): EngineConfig | null {
  const modelCfg = readStoredModelConfig();
  const ttsCfg = loadClientTtsConfig();
  if (!modelCfg) return null;
  return resolveEngineConfig(modelCfg, ttsCfg);
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
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

// ── Unified entry points ───────────────────────────────────────────────
// When the browser has a BYO model config in localStorage, these call the
// client-side engine directly (talking to providers from the browser).
// Otherwise they fall back to the server-side API routes, which read
// environment variables — useful for Vercel deploys that already supply keys.

export async function startSession(req: StartRequest): Promise<StartResponse> {
  const config = getClientConfig();
  if (config) {
    return startSessionClient(config, req);
  }
  return postJson<StartResponse>("/api/start", req);
}

export async function requestScene(req: SceneRequest): Promise<SceneResponse> {
  const config = getClientConfig();
  if (config) {
    return requestSceneClient(config, req);
  }
  return postJson<SceneResponse>("/api/scene", req);
}

export async function visionDecide(req: VisionRequest): Promise<VisionResponse> {
  const config = getClientConfig();
  if (config) {
    return visionDecideClient(config, req);
  }
  return postJson<VisionResponse>("/api/vision", req);
}

export async function classifyFreeform(
  req: FreeformClassifyRequest,
): Promise<FreeformClassifyResponse> {
  const config = getClientConfig();
  if (config) {
    return classifyFreeformClient(config, req);
  }
  return postJson<FreeformClassifyResponse>("/api/classify-freeform", req);
}

export async function requestInsertBeat(
  req: InsertBeatRequest,
): Promise<InsertBeatResponse> {
  const config = getClientConfig();
  if (config) {
    return requestInsertBeatClient(config, req);
  }
  return postJson<InsertBeatResponse>("/api/insert-beat", req);
}
