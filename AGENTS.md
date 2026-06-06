# Repository Guidelines

This is the primary working guide for AI coding agents and contributors. It summarizes the repo-specific rules and adds contributor workflow guidance. Prefer it over generic Next.js assumptions.

## Project Structure & First Reads

InfiPlot is a Next.js 16 / React 19 / TypeScript app for AI-driven interactive visual novels (galgame). The server is intentionally stateless: the client carries the full `Session` and sends it to API routes whenever new generation is needed.

- `app/`: App Router pages and API routes. Start here for request/response behavior.
- `app/page.tsx`: Home/custom-start flow, preset cards, style-image upload/parsing, and analytics.
- `app/play/page.tsx`: Client session runtime, speculative scene prefetch, voice retention/stripping, image preload/proxying, orientation locking, and API callers.
- `components/`: Client UI, especially `PlayCanvas.tsx`, `CustomForm.tsx`, `PresetCard.tsx`, `TtsKeyModal.tsx`, and `Analytics.tsx`.
- `lib/types/index.ts`: Shared domain contracts. Read this before changing payload shapes.
- `lib/engine/`: Core story engine. `director.ts` orchestrates scene generation.
- `lib/engine/agents/`: Architect, Writer, CharacterDesigner, Cinematographer, Painter.
- `lib/engine/prompts.ts`: Agent prompts and prompt-cache-sensitive message builders.
- `lib/ai-client/`: Text, image, vision, and retry wrappers.
- `lib/tts-client/`: TTS integration.
- `lib/config.ts`: Server-side provider/environment loading.
- `lib/presets.ts`, `lib/ttsPresets.ts`, `lib/options.ts`: Home-page presets and selectable options.
- `scripts/`: Asset and preset generation helpers.
- `public/`, `docs/`: Static assets and documentation imagery.

For engine work, read `lib/types/index.ts`, the target agent/orchestrator file, and the API route exposing the behavior. For UI work, inspect the component and the owning page.

## Core Architecture

The engine behaves like `Session + EngineConfig -> SceneResult`. The client appends returned scenes to `session.history`, replaces `session.characters` and `session.storyState`, and sends the updated `Session` back later. Do not introduce server-side session storage, hidden global game state, or persistence unless explicitly requested.

The core pipeline is `directScene()` in `lib/engine/director.ts`. Writer is intentionally split into two phases so image generation can begin before full dialogue is ready:

1. Writer Phase A runs serially and produces `WriterPlan`: `sceneSummary`, `sceneKey`, `entryBeatId`, `cast`, `entryActiveCharacters`, and `entrySpeaker`.
2. Writer Phase B starts immediately and overlaps the image pipeline. It produces `beats[]` and `storyStatePatch`, constrained to honor the plan.
3. CharacterDesigner card LLMs and Cinematographer run in parallel from the plan.
4. Entry-beat portraits may block Painter because they become references.
5. Painter generates the scene background from Cinematographer `integratedPrompt` plus `referenceImages`.
6. Non-entry portraits and all voice provisioning should overlap with painting, then Phase B is awaited before scene assembly.

Do not add blocking calls between Writer Phase A completion and Painter start. Anything that can overlap with Phase B or painting should.

At session start, `startSession()` runs Architect first to create `storyState`; subsequent scene requests must rely on the client-carried `Session`, not server memory.

## Domain Model Invariants

`Scene` is an image plus a graph of `Beat` nodes. `Beat.next` is either `continue` or `choice`. A scene should have at least one meaningful `change-scene` exit toward a new scene. Beat ids are graph keys; keep them unique and repair references when coercing LLM output.

`StoryState` has stable and volatile zones. Stable fields are set by Architect and must not be patched by Writer: `logline`, `genreTags`, `protagonist`, `castNotes`. Volatile fields may be rewritten every scene: `synopsis`, `openThreads`, `relationships`, `nextHook`. If adding a field, classify it and update `applyStoryStatePatch()` plus Writer coercion.

Characters are identified by `name`. `mergeCharacters()` preserves existing portrait and voice fields when a later design omits them. Do not casually change character matching without checking Writer, Director, and Painter reference handling.

The player POV is hardcoded as second-person Chinese `"你"`. The player should not appear in `activeCharacters`, images, portraits, or TTS. Preserve normalization in Writer and InsertBeat flows.

`orientation` is session-wide and locked at start (`"portrait"` for upright touch devices, otherwise `"landscape"`). It controls prompt framing, generated dimensions, mock images, and `PlayCanvas` layout; preserve back-compat by coercing missing/invalid values to `"landscape"`.

`styleReferenceImage` is an optional client-resized `data:image/...` reference stored in the carried `Session`. It can make request bodies large, so keep validation limits and client resizing intact.

## Agent Output & Error Handling

Agent outputs should follow the existing pattern:

1. Raw LLM type accepts optional and variant fields.
2. Coercion normalizes names, defaults, and malformed values.
3. Repair fixes structural issues.
4. Fallback returns a safe value instead of throwing at the agent boundary.

Never use direct `JSON.parse()` on core agent LLM output. Use `parseJsonLoose()` from `lib/engine/jsonParser.ts`, which attempts direct parse, fenced JSON extraction, object slicing, and `jsonrepair`. Narrow utility routes may parse first only when they also have a safe fallback, as `/api/parse-style-image` does.

Maintain graceful degradation. Existing flows tolerate malformed AI JSON, failed character cards, failed portraits, failed TTS, failed image references, optional analytics, and provider timeouts. Do not convert optional provider failures into hard crashes.

## Visual Continuity & Prompt Caching

`sceneKey` identifies a physical space such as `"classroom-dusk"`. If a new scene shares a key with prior history, the prior scene image should be reused as a reference. Character portraits are also references.

Runware allows at most 4 references. Preserve the priority: style reference image, prior scene, speaker portrait, then other NPCs. Prefer image URLs for `referenceImages` when needed because Runware can fail to recognize UUIDs. The OpenAI/Gemini image paths can also accept references through the AI SDK, but they return data URIs and synthetic UUIDs, so repeated session transport is heavier than Runware's URL/UUID loop.

Writer prompt caching depends on `buildWriterPlanUserMessage()` and `buildWriterBeatsUserMessage()` keeping their stable prefixes intact: world, style, story spine, archived history, known scene keys, and character list. The dynamic suffix contains current state, last beat, exit hint, and the current plan. Do not reorder or reformat stable prefix sections casually; it can destroy cache hit rates.

## API Flow

Common routes live under `app/api/`:

- `POST /api/start`: starts a session via Architect then `directScene()`.
- `POST /api/scene`: generates the next scene from an existing session.
- `POST /api/vision`: interprets scene-image clicks.
- `POST /api/insert-beat`: creates a transient beat without image generation.
- `POST /api/beat-audio`: lazy TTS for a displayed beat; returns binary audio, or `204` when silent.
- `POST /api/parse-style-image`: extracts a style prompt from uploaded reference art.

When changing public types or route payloads, update all route callers and client consumers in the same change.

All API routes currently run on `runtime = "nodejs"`. Keep Cloudflare implications in mind before adding Node-only dependencies to code that should also work in browser/client or OpenNext builds.

The client deliberately strips `voice.referenceAudioBase64` from `Session` before `/api/scene`, `/api/vision`, and `/api/insert-beat` transport, then merges voices back locally. Server responses strip already-known voices to reduce payload size. Preserve this first-load/request-size behavior when changing character or TTS flow.

`clientTts: true` means the browser owns Xiaomi TTS keys and provisions/synthesizes voices locally; routes must drop `config.tts` so server-side TTS is skipped and user keys never touch the server.

`app/play/page.tsx` speculatively prefetches future `/api/scene` responses up to `PREFETCH_MAX_DEPTH`. If scene/session shape changes, update speculative session construction, cache re-rooting, abort logic, and voice/image preload handling together.

## Build, Test, and Development Commands

Use pnpm with Node >=22. `pnpm-lock.yaml` is the source of truth; `package-lock.json` is legacy and should not be updated unless requested.

- `pnpm dev`: local Next.js dev server.
- `pnpm build`: production build for Vercel/default target.
- `pnpm start`: run production server after building.
- `pnpm lint`: Next.js built-in lint.
- `pnpm typecheck`: `tsc --noEmit`.
- `pnpm build:cf`: Cloudflare Workers build through OpenNext.
- `pnpm preview:cf`: local Cloudflare preview.
- `pnpm deploy:cf`: Cloudflare deploy.

There is no dedicated test framework, no Prettier config, and no standalone ESLint config. Before handing off code changes, run `pnpm typecheck` and `pnpm lint`; run `pnpm build` for routing, deployment, or provider initialization changes.

## Coding Style & Imports

Write TypeScript with 2-space indentation, double quotes, semicolons, and ESM imports. Prefer named exports for shared helpers and components when practical.

Use aliases from `tsconfig.json`: `@/*`, `@infiplot/engine`, `@infiplot/ai-client`, `@infiplot/tts-client`, and `@infiplot/types`. Avoid deep relative import chains when an alias exists.

React components use PascalCase. Hooks, helpers, variables, and functions use camelCase. Types and interfaces use PascalCase. Route folders follow Next.js App Router conventions. UI work should follow the existing Tailwind-heavy visual language.

Modal/dialog UI should be extracted into dedicated components instead of being inlined inside large page or canvas components. Keep the host responsible for open/close state and domain data, and keep the modal component responsible for dialog layout, overlay behavior, keyboard close handling, scroll containers, and modal-specific styling.

Comment only non-obvious sequencing, provider quirks, fallback behavior, or architectural invariants.

## Configuration & Providers

Use `.env.example` as the source of truth. Never commit `.env.local`, API keys, uploaded user content, or generated secrets.

- Text and Vision use `TEXT_*` and `VISION_*`; default protocol is `openai_compatible`, with native `anthropic` and `google` available via `TEXT_PROVIDER` / `VISION_PROVIDER`.
- Image uses `IMAGE_*`; supported protocols are `runware`, `openai_compatible`, native `openai`, and native `google`. When `IMAGE_PROVIDER` is unset, Runware is inferred from `*.runware.ai` URLs and otherwise falls back to OpenAI-compatible image generations.
- TTS uses Xiaomi MiMo protocol and is optional: blank config means silent mode.
- `MOCK_IMAGE=true` skips image generation and returns a placeholder for cheap local iteration.
- `NEXT_PUBLIC_IMAGE_PROXY_URL` and `NEXT_PUBLIC_IMAGE_PROXY_ALLOWED_HOSTS` opt into browser-side image proxying for allowed hosts.
- Analytics uses optional Umami `NEXT_PUBLIC_UMAMI_*` values and must stay content-free/privacy-preserving.
- `NEXT_PUBLIC_*` values are inlined at build time.

## File Dependency Map

If modifying Writer, also check `director.ts`, `prompts.ts`, WriterPlan/StoryState types, and Cinematographer/Painter consumers. If modifying CharacterDesigner, check Director scheduling/merge logic, portrait prompts, voice provisioning, and Painter reference collection. If modifying Cinematographer or Painter, check Director, prompt builders, provider image options, orientation handling, and reference priority. If modifying Architect, check `orchestrator.ts`, `prompts.ts`, and StoryState patch rules. If modifying `lib/types/index.ts`, check all agents, Director, Orchestrator, API routes, and client consumers in `app/page.tsx`, `app/play/page.tsx`, and `components/PlayCanvas.tsx`. If modifying TTS, check server `beat-audio`, BYO client TTS, voice stripping/merging, and payload privacy. If modifying image delivery, check Painter, `lib/ai-client/image.ts`, mock images, orientation dimensions, preload/proxy logic, and style-reference validation.

## Guide Maintenance

After any refactor, architecture change, provider-client rewrite, public type change, new route, payload-shape change, or major UI flow change, reread the affected files and compare them against this `AGENTS.md`. Update `AGENTS.md` in the same change if the architecture, commands, invariants, dependency map, environment variables, or "What Not To Do" list drifted. The canonical filename is `AGENTS.md`; treat mentions like `AGETNS.md` as typos and repair the real file.

## Commit & Pull Request Guidelines

Follow observed Conventional Commit style: `feat(web): ...`, `fix(play): ...`, `perf(engine): ...`, `chore(engine): ...`.

PRs should include a short behavior summary, validation commands run, linked issues when relevant, screenshots or recordings for UI changes, and notes for environment, provider, deployment, or payload-shape changes.

## What Not To Do

- Do not make the server stateful.
- Do not generate images, portraits, or TTS for `"你"`.
- Do not let Writer patch stable `StoryState` fields.
- Do not reorder the Writer stable prompt prefix without a clear cache-aware reason.
- Do not assume Runware UUID references always work.
- Do not remove fallbacks, timeout handling, analytics privacy constraints, or reference priority rules.
- Do not leak browser-provided TTS keys to the server or send retained voice audio through scene/vision/insert-beat session payloads.
- Do not break session-locked orientation or style-reference propagation when changing start/play flows.
- Do not regenerate large assets in `public/` unless the user requested asset work.
- Do not mix prompt refactors, provider-client rewrites, UI restyling, and deployment changes in one narrow task.
