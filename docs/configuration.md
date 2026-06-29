# 配置教程

InfiPlot 会与四类模型供应商通信。**文本（Text）和视觉（Vision）** 只走 OpenAI 兼容接口——想用 Google Gemini 的话，把 `*_BASE_URL` 指向其 OpenAI 兼容端点（`https://generativelanguage.googleapis.com/v1beta/openai`）即可；想用 Anthropic Claude 的话，推荐通过兼容网关（如 LiteLLM）转发，官方 OpenAI 兼容层不支持缓存，可能推高成本与延迟。**图像（Image）** 支持 **Runware**（其自有 task-array 协议）与 **OpenAI**（`gpt-image`）。**语音（TTS）** 支持**小米 MiMo**（自有的音色设计/克隆协议——支持角色级音色设计、克隆与逐行演绎指导，免费）和 **StepFun 阶跃星辰**（32 个预设音色，由 AI 自动匹配，付费但体验更好）。

## 1. 选择你的供应商

| 供应商 | 环境变量 | 是否必填 | 推荐 |
|---|---|---|---|
| Text · 剧情导演  | `TEXT_BASE_URL` `TEXT_API_KEY` `TEXT_MODEL`        | ✅ | DeepSeek 的 `deepseek-v4-flash` |
| Image · 场景渲染  | `IMAGE_BASE_URL` `IMAGE_API_KEY` `IMAGE_MODEL`     | ✅ | [Runware](https://runware.ai) 的 `runware:400@6`（FLUX.2 [klein] 9B KV） |
| Vision · 点击解读  | `VISION_BASE_URL` `VISION_API_KEY` `VISION_MODEL`  | ✅ | Google 的 `gemini-3.5-flash` |
| TTS · 角色配音 | `TTS_BASE_URL` `TTS_API_KEY` `TTS_SPEECH_MODEL` | 可选 —— 留空则静音运行 | 小米 MiMo 的 `mimo-v2.5-tts`（免费）；付费可选 [StepFun](https://www.stepfun.com) 的 `step-tts-2` |

> **可选 · 指定接口协议**：每类模型都可加一个 `*_PROVIDER` 变量（`TEXT_PROVIDER` / `VISION_PROVIDER` / `IMAGE_PROVIDER`）显式选择接口协议。**不设则保持向后兼容**——文本/视觉默认走 OpenAI 兼容接口，图像按 `*_BASE_URL` 自动判断（`runware.ai` → Runware，否则 OpenAI 兼容；个别在 `runware.ai` 上以 OpenAI 协议提供的模型——如 `image-2-vip`——会按 OpenAI 兼容处理，需要时用 `IMAGE_PROVIDER` 显式覆盖即可）。
>
> | 取值 | 适用 | 说明 |
> |---|---|---|
> | `openai_compatible`（默认） | Text · Vision · Image | OpenAI Chat Completions / `/images/generations` |
> | `openai` | Image | OpenAI `gpt-image`，支持参考图编辑 |
> | `runware` | Image | Runware task-array 协议 |
>
> 文本和视觉**仅**支持 `openai_compatible`。要用 Gemini，把 `*_BASE_URL` 指向其 OpenAI 兼容端点（`https://generativelanguage.googleapis.com/v1beta/openai`）即可。要用 Claude，推荐通过兼容网关（如 LiteLLM）转发——Anthropic 官方端点虽提供 OpenAI 兼容层，但不支持缓存，会推高成本与延迟。
>
> 此外，`*_BASE_URL` 带不带 `/v1`（甚至末尾多写了 `/chat/completions`）都能正常工作——引擎会自动规范化。

## 2. 填写环境变量

九个变量为必填；TTS 可选（留空则静音运行）。此外还有一个用于低成本测试的开关：

| 变量 | 作用 |
|---|---|
| `MOCK_IMAGE=true` | 跳过图像生成，渲染器返回一张静态占位图。剧情、语音、选项照常运行。非常适合在不消耗 Runware 额度的情况下调试 TTS。 |

在哪里设置（确切字段见 `.env.example`）：

- **本地开发** —— `.env.local`
- **Vercel** —— Project Settings → Environment Variables
- **Cloudflare Workers** —— 在仓库根目录下逐个执行 `wrangler secret put <NAME>`，或在 dashboard 里设置（Workers → infiplot → Settings → Variables and Secrets）。如果要给 staging 加访问限制，可以在 Worker 前面挂一个 [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/applications/)（零代码，邮箱白名单）。

## 3. 注意成本

使用推荐的三件套时，每一幕场景的开销主要来自图像生成模型。FLUX.2 [klein] 9B KV 的图像大约 **$0.00078** 一张（1792×1024，4 步，亚秒级）；文本模型使用 `deepseek-v4-flash` 时，成本极低。逐拍点过一个场景是免费的。为了让切换瞬间完成，引擎还会预测式地生成那些你可能选、但最终可能没选的场景 —— 所以真实花费会比你实际看到的场景数略高一些。

## 4. 图片代理（可选）

默认浏览器直连图片供应商，无需任何配置 —— 留空 `NEXT_PUBLIC_IMAGE_PROXY_URL` 即可，完全不受影响。只有当你遇到图片「层层加载」（Chrome 在某些网络下 `ERR_QUIC_PROTOCOL_ERROR` 导致 PNG 逐行渲染）时才需要它：部署一个极小的 Cloudflare Worker，把图片改为服务端转发 + HTTP/2 原子返回。一键部署见 **[infiplot-image-proxy](https://github.com/zonghaoyuan/infiplot-image-proxy)**，然后把它给出的 `workers.dev` 地址填进 `NEXT_PUBLIC_IMAGE_PROXY_URL`。

## 5. 玩家自带配音 Key（可选，推荐）

小米对 TTS 模型有 RPM/TPM 限额。当你的公共部署有多人同时游玩、共用同一把 `TTS_API_KEY` 时，很容易撞到限额，表现为**剧情、画面都正常，唯独没有声音**。为此，玩家可以在首页可选地填入**自己的**小米 MiMo Key（免费申请）——配音请求由**浏览器直连小米**完成，**Key 只存在玩家本地、绝不经过你的服务器**，从而获得稳定配音与更低延迟。这是纯增强：不填则照常使用你部署的服务器 Key，行为不变。

申请与填写步骤见 [自带配音 Key 教程](xiaomi-tts-key.md)。
