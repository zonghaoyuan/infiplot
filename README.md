# 云梦

> An AI-driven visual novel painted by an AI, one scene at a time. You talk and explore within a scene; when the story turns a corner, it paints the next. You click. It paints. The story unfolds.

---

## How it works

The story unfolds as a sequence of **scenes**. Each scene is one AI-painted background plus a short tree of **beats** — moments of narration, dialogue, and the occasional choice. You tap through a scene's beats and the image stays put; only when a choice leads somewhere genuinely new — another place, a new point of view, a jump in time — does the AI paint the next scene.

```
entering a scene
        │
        ▼
1. Text LLM     directs the whole scene at once — a background prompt
                plus a tree of beats (narration / dialogue / choices)
        │
        ▼
2. Image model  paints the background once, 16:9, no UI baked in
        │
        ▼
[ tap through beats — no model calls, instant ]
        │
        ├─ in-scene choice ──────▶ jump to another beat (instant)
        │
        └─ scene-change choice ──▶ the next scene
                                   (usually pre-generated — see below)
```

While you're reading one scene, the engine **speculatively generates the scenes your choices could lead to** — and, for unavoidable next steps, the scene after that. By the time you pick a direction, its image is usually already painted, so the cut feels instant.

Clicking the background itself (not a button) routes through a **vision** model: it reads where you tapped and decides whether you're exploring the current scene (it inserts a beat — no new image) or moving on (a new scene).

There is no traditional game UI baked into the art. The AI paints the world in whatever style you pick — "stick figure on grid paper" or "cyberpunk noir" — and the dialogue panel and choice buttons are a light HTML layer drawn on top, tuned to sit over the scene.

---

## One-click deploy

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/YOUR_USERNAME/yume&env=TEXT_BASE_URL,TEXT_API_KEY,TEXT_MODEL,IMAGE_BASE_URL,IMAGE_API_KEY,IMAGE_MODEL,VISION_BASE_URL,VISION_API_KEY,VISION_MODEL&envDescription=Three%20independently%20configurable%20providers.%20Any%20OpenAI-compatible%20endpoint%20works.&envLink=https://github.com/YOUR_USERNAME/yume%23environment-variables)

After deploy, set the nine environment variables (see below) in your Vercel project. That's it.

---

## Environment variables

Three providers, all independently configurable. Text and Vision accept any OpenAI-compatible endpoint (OpenAI, Anthropic via OpenAI-compat proxy, Gemini, OpenRouter, DeepSeek, local Ollama, …). Image goes to **Runware** (its own task-array protocol, not OpenAI-compatible).

| Provider | Variables | Recommended |
|---|---|---|
| Text · story director | `TEXT_BASE_URL` `TEXT_API_KEY` `TEXT_MODEL` | `claude-opus-4-7` via Anthropic |
| Image · UI renderer   | `IMAGE_BASE_URL` `IMAGE_API_KEY` `IMAGE_MODEL` | `runware:400@6` (FLUX.2 [klein] 9B KV) via [Runware](https://runware.ai) |
| Vision · click reader | `VISION_BASE_URL` `VISION_API_KEY` `VISION_MODEL` | `gemini-3-flash` via Google |

See `apps/web/.env.example` for the exact shape.

---

## Local development

Requires Node 20+ and pnpm 9+.

```bash
pnpm install
cp apps/web/.env.example apps/web/.env.local
# fill in the nine env vars
pnpm dev
# open http://localhost:3000
```

---

## Project layout

```
yume/
├── apps/web/              Next.js 16 app — pages + API routes
└── packages/
    ├── types/             shared TypeScript types
    ├── ai-client/         unified OpenAI-compatible clients
    └── engine/            three-stage AI orchestration (open core)
```

`packages/engine` is the open core — pure TS, no Next.js or browser dependency. Import it directly to build your own visual-novel front-end (Tauri, Electron, CLI, anywhere).

---

## Cost & limits

With the recommended trio, each **scene** is dominated by the text-LLM call. The FLUX.2 [klein] 9B KV image is roughly **\$0.001** per scene (1792×1024, 4 steps, sub-second); the text call is the rest. Tapping through a scene's beats is free. To keep transitions instant, the engine also **pre-generates scenes you might pick but don't** — so real spend runs somewhat higher than the scenes you actually see. There is no rate limiting or auth out of the box — if you make your deployment public, your bill will reflect that. Add limits (and consider lowering the prefetch depth) before sharing widely.
