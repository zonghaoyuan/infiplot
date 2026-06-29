# 設定ガイド

InfiPlot は 4 種類のモデルプロバイダと通信します。**テキスト（Text）・ビジョン（Vision）は、任意の OpenAI 互換エンドポイント**を使用でき、自由に組み合わせられます —— Google Gemini を使う場合は、`*_BASE_URL` をその OpenAI 互換エンドポイント（`https://generativelanguage.googleapis.com/v1beta/openai`）に向けるだけです。Anthropic Claude を使う場合は、互換ゲートウェイ（LiteLLM など）の経由を推奨します —— Anthropic の公式エンドポイントは OpenAI 互換レイヤーを提供していますがキャッシュ非対応のため、コストとレイテンシが上昇します。**画像（Image）**は **Runware**（独自の task-array プロトコル）と **OpenAI**（`gpt-image`）に対応します。**音声（TTS）**は **Xiaomi MiMo**（独自の音声デザイン/クローンプロトコル —— キャラクターごとの音声デザイン、クローン、行ごとの抑揚指示に対応、無料）と **StepFun**（32 種のプリセット音声を AI が自動マッチング、有料ですがより高品質）に対応します。

## 1. プロバイダを選ぶ

| プロバイダ | 環境変数 | 必須？ | 推奨 |
|---|---|---|---|
| Text · ストーリー監督  | `TEXT_BASE_URL` `TEXT_API_KEY` `TEXT_MODEL`        | ✅ | DeepSeek の `deepseek-v4-flash` |
| Image · シーン描画  | `IMAGE_BASE_URL` `IMAGE_API_KEY` `IMAGE_MODEL`     | ✅ | [Runware](https://runware.ai) の `runware:400@6`（FLUX.2 [klein] 9B KV） |
| Vision · クリック解釈  | `VISION_BASE_URL` `VISION_API_KEY` `VISION_MODEL`  | ✅ | Google の `gemini-3.5-flash` |
| TTS · キャラクター音声 | `TTS_BASE_URL` `TTS_API_KEY` `TTS_SPEECH_MODEL` | 任意 —— 空欄なら無音で動作 | Xiaomi MiMo の `mimo-v2.5-tts`（無料）；有料の選択肢：[StepFun](https://www.stepfun.com) の `step-tts-2` |

> **オプション · プロトコルの明示的指定**：各プロバイダスロットには `*_PROVIDER` 変数（`TEXT_PROVIDER` / `VISION_PROVIDER` / `IMAGE_PROVIDER`）を追加して、使用するプロトコルを明示的に指定できます。**未設定なら後方互換のデフォルト**を維持します —— テキスト/ビジョンは OpenAI 互換がデフォルト、画像は `*_BASE_URL` から自動判定（`runware.ai` → Runware、それ以外は OpenAI 互換。`runware.ai` 上で OpenAI プロトコルで提供されるモデル —— `image-2-vip` など —— は OpenAI 互換として処理されます。必要に応じて `IMAGE_PROVIDER` で上書きしてください）。
>
> | 値 | 対象 | 説明 |
> |---|---|---|
> | `openai_compatible`（デフォルト） | Text · Vision · Image | OpenAI Chat Completions / `/images/generations` |
> | `openai` | Image | OpenAI `gpt-image`、参照画像編集に対応 |
> | `runware` | Image | Runware task-array プロトコル |
>
> テキストとビジョンは `openai_compatible` **のみ**対応。Gemini を使う場合は `*_BASE_URL` をその OpenAI 互換エンドポイント（`https://generativelanguage.googleapis.com/v1beta/openai`）に向けてください。Claude を使う場合は互換ゲートウェイ（LiteLLM など）の経由を推奨 —— Anthropic の公式エンドポイントは OpenAI 互換レイヤーを提供していますが、キャッシュ非対応のためコストとレイテンシが上昇します。
>
> `*_BASE_URL` は末尾に `/v1` があってもなくても（`/chat/completions` まで付いていても）正常に動作します —— エンジンが自動で正規化します。

## 2. 環境変数を設定する

9 つの変数が必須で、TTS は任意です（空欄なら無音で動作）。低コストなテスト用のフラグもあります。

| 変数 | 効果 |
|---|---|
| `MOCK_IMAGE=true` | 画像生成をスキップし、レンダラが静的なプレースホルダを返します。ストーリー・音声・選択肢は通常どおり動作します。Runware のクレジットを消費せずに TTS を調整するのに最適です。 |

設定場所（正確なフォーマットは `.env.example` を参照）：

- **ローカル開発** —— `.env.local`
- **Vercel** —— Project Settings → Environment Variables
- **Cloudflare Workers** —— リポジトリのルートから各変数について `wrangler secret put <NAME>` を実行するか、ダッシュボード（Workers → infiplot → Settings → Variables and Secrets）で設定します。ステージング環境にアクセス制限を掛けたい場合は、Worker の前に [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/applications/) を挟むと、ゼロコードでメール許可リスト方式の認証が利用できます。

## 3. コストに注意

推奨の 3 点セットでは、各シーンのコストは主に画像生成モデルによるものです。FLUX.2 [klein] 9B KV の画像は 1 シーンあたり概ね **$0.00078**（1792×1024、4 ステップ、サブ秒）。テキストモデルは `deepseek-v4-flash` を使用するため、テキストコストは比較になりません。シーン内のビートをタップしていくのは無料です。切り替えを一瞬に保つため、エンジンは選ぶ可能性はあるが最終的に選ばないシーンも先行生成します —— そのため実際の支出は、あなたが実際に見るシーン数よりやや高くなります。

## 4. 画像プロキシ（オプション）

デフォルトではブラウザが画像プロバイダーに直接アクセスするため、設定は不要です —— `NEXT_PUBLIC_IMAGE_PROXY_URL` を空欄のままにすれば、まったく影響ありません。画像が「上から順に」表示される現象（一部のネットワークで Chrome の `ERR_QUIC_PROTOCOL_ERROR` により PNG が行ごとに描画される）に遭遇した場合のみ必要です。小さな Cloudflare Worker をデプロイすると、画像をサーバー側で再取得し HTTP/2 で一括返却します。ワンクリックデプロイは **[infiplot-image-proxy](https://github.com/zonghaoyuan/infiplot-image-proxy)** を参照し、出力された `workers.dev` の URL を `NEXT_PUBLIC_IMAGE_PROXY_URL` に設定してください。

## 5. プレイヤー自身の音声 Key（任意・推奨）

Xiaomi は TTS モデルに RPM/TPM 制限を設けています。公開デプロイで多数のプレイヤーが単一の `TTS_API_KEY` を共有して同時にプレイすると、この制限に達しやすく、**ストーリーも画像も正常なのに音声だけ出ない**という症状になります。対策として、プレイヤーはトップページで**自分の** Xiaomi MiMo Key（無料で取得可）を任意で入力できます。合成は**ブラウザから Xiaomi へ直接**行われ、**Key はプレイヤーのブラウザ内にのみ保存され、あなたのサーバーを一切経由しません**。これにより安定した音声と低遅延が得られます。完全な追加機能であり、未入力ならこれまで通りサーバー側の Key にフォールバックします。

取得・入力の手順は [音声 Key 持ち込みガイド](xiaomi-tts-key.md) を参照してください。
