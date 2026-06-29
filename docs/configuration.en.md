# Configuration guide

InfiPlot talks to four kinds of model providers. **Text and Vision use any OpenAI-compatible endpoint**, so you can mix and match freely — for Google Gemini, point `*_BASE_URL` at its OpenAI-compatible endpoint (`https://generativelanguage.googleapis.com/v1beta/openai`). For Anthropic Claude, a compatible gateway (e.g. LiteLLM) is recommended — Anthropic's official endpoint offers an OpenAI-compatible layer but no caching, which raises cost and latency. **Image** supports **Runware** (its own task-array protocol) and **OpenAI** (`gpt-image`). **TTS** supports **Xiaomi MiMo** (its own voice design / clone protocol — per-character voice design, clone, and per-line delivery direction; free) and **StepFun** (32 preset voices, auto-matched by AI; paid but better quality).

## 1. Choose your providers

| Provider | Variables | Required? | Recommended |
|---|---|---|---|
| Text · story director  | `TEXT_BASE_URL` `TEXT_API_KEY` `TEXT_MODEL`        | ✅ | `deepseek-v4-flash` via DeepSeek |
| Image · scene renderer  | `IMAGE_BASE_URL` `IMAGE_API_KEY` `IMAGE_MODEL`     | ✅ | `runware:400@6` (FLUX.2 [klein] 9B KV) via [Runware](https://runware.ai) |
| Vision · click reader  | `VISION_BASE_URL` `VISION_API_KEY` `VISION_MODEL`  | ✅ | `gemini-3.5-flash` via Google |
| TTS · per-character voice | `TTS_BASE_URL` `TTS_API_KEY` `TTS_SPEECH_MODEL` | optional — leave blank to run silently | `mimo-v2.5-tts` via Xiaomi MiMo (free); paid alternative: `step-tts-2` via [StepFun](https://www.stepfun.com) |

> **Optional · explicit protocol override**: each provider slot accepts a `*_PROVIDER` variable (`TEXT_PROVIDER` / `VISION_PROVIDER` / `IMAGE_PROVIDER`) to force a specific protocol. **Leave unset for backwards-compatible defaults** — text/vision default to OpenAI-compatible, image auto-detects from `*_BASE_URL` (`runware.ai` → Runware, otherwise OpenAI-compatible; models served via OpenAI protocol on `runware.ai` — such as `image-2-vip` — are handled as OpenAI-compatible; override with `IMAGE_PROVIDER` when needed).
>
> | Value | Applies to | Description |
> |---|---|---|
> | `openai_compatible` (default) | Text · Vision · Image | OpenAI Chat Completions / `/images/generations` |
> | `openai` | Image | OpenAI `gpt-image`, supports reference-image editing |
> | `runware` | Image | Runware task-array protocol |
>
> Text and vision **only** support `openai_compatible`. For Gemini, point `*_BASE_URL` at its OpenAI-compatible endpoint (`https://generativelanguage.googleapis.com/v1beta/openai`). For Claude, a compatible gateway (e.g. LiteLLM) is recommended — Anthropic's official endpoint offers an OpenAI-compatible layer but no caching, raising cost and latency.
>
> `*_BASE_URL` works with or without a trailing `/v1` (or even a trailing `/chat/completions`) — the engine normalizes automatically.

## 2. Set the environment variables

Nine variables are required; TTS is optional (leave blank to run silently). There's also a flag for cheap testing:

| Variable | Effect |
|---|---|
| `MOCK_IMAGE=true` | Skip image generation; the renderer returns a static placeholder. Story, voice, and choices still run normally. Great for iterating on TTS without burning Runware credits. |

Where to set them (see `.env.example` for the exact shape):

- **Local dev** — `.env.local`
- **Vercel** — Project Settings → Environment Variables
- **Cloudflare Workers** — from the repo root, run `wrangler secret put <NAME>` for each variable, or set them in the dashboard (Workers → infiplot → Settings → Variables and Secrets). For a private staging instance, gate the Worker behind [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/applications/) — zero-code email-whitelist auth in front of the Worker.

## 3. Mind the cost

With the recommended trio, each scene's cost comes mainly from the image generation model. The FLUX.2 [klein] 9B KV image is roughly **\$0.00078** per scene (1792×1024, 4 steps, sub-second); the text model uses `deepseek-v4-flash`, so text costs are negligible by comparison. Tapping through a scene's beats is free. To keep transitions instant, the engine also pre-generates scenes you might pick but ultimately don't — so real spend runs somewhat higher than the scenes you actually see.

## 4. Image proxy (optional)

By default the browser fetches images directly from the provider — no setup needed; leave `NEXT_PUBLIC_IMAGE_PROXY_URL` blank and you're completely unaffected. You only want this if you hit progressive "top-to-bottom" image loading (Chrome's `ERR_QUIC_PROTOCOL_ERROR` on some networks paints partial PNGs row by row): deploy a tiny Cloudflare Worker that re-fetches images server-side and serves them atomically over HTTP/2. One-click deploy at **[infiplot-image-proxy](https://github.com/zonghaoyuan/infiplot-image-proxy)**, then paste the `workers.dev` URL it prints into `NEXT_PUBLIC_IMAGE_PROXY_URL`.

## 5. Let players bring their own voice Key (optional, recommended)

Xiaomi rate-limits the TTS model by RPM/TPM. When a public deployment has many people playing at once through a single shared `TTS_API_KEY`, those limits are easy to hit — the symptom is **story and visuals work fine, but there's no audio**. To fix this, players can optionally enter **their own** Xiaomi MiMo key on the homepage (free to obtain). Synthesis then runs **browser-direct to Xiaomi**, the **key stays in the player's browser and never touches your server**, and they get stable voice with lower latency. It's purely additive: leave it blank and playback falls back to your server key exactly as before.

See the [Bring-your-own voice Key guide](xiaomi-tts-key.md) for how to obtain and enter one.
