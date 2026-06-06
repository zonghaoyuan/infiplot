"use client";

// Bring-your-own Xiaomi MiMo TTS key modal — shared by the homepage and the
// play page. Two-step picker (key family → region for Token Plan only), key
// stored CLIENT-SIDE ONLY (see lib/clientTtsConfig). `onSaved(configured)`
// fires after a save/disable so each host can react (homepage flips the
// 语音配音 toggle; the play page re-synthesizes the current scene in-browser).
// `footerNote` lets the host tailor the closing hint to its own context.

import { type ReactNode, useEffect, useState } from "react";
import {
  clearStoredTtsConfig,
  readStoredTtsConfig,
  writeStoredTtsConfig,
} from "@/lib/clientTtsConfig";
import {
  findTtsPreset,
  PAYG_PRESET_ID,
  TTS_KEY_DOC_URL,
  TTS_REGION_PRESETS,
} from "@/lib/ttsPresets";

const DEFAULT_FOOTER_NOTE: ReactNode =
  "提示：需将上方「语音配音」设为「开启」配音才会生效。保存后本设备后续游玩会自动使用此 Key。";

export function TtsKeyModal({
  onClose,
  onSaved,
  footerNote = DEFAULT_FOOTER_NOTE,
}: {
  onClose: () => void;
  onSaved: (configured: boolean) => void;
  footerNote?: ReactNode;
}) {
  // Read storage once; useState initializers ignore later renders, so local
  // edits aren't clobbered and we don't re-hit localStorage every render.
  const [initial] = useState(() => readStoredTtsConfig());
  // Two-step picker: choose key family first, then — only for Token Plan — a
  // region. Pay-as-you-go (`sk-`) keys hit one fixed endpoint, so no region.
  const initialKind = findTtsPreset(initial?.presetId)?.kind ?? "token-plan";
  const [keyType, setKeyType] = useState<"token-plan" | "payg">(initialKind);
  const [regionId, setRegionId] = useState<string>(
    initialKind === "token-plan"
      ? (initial?.presetId ?? TTS_REGION_PRESETS[0]!.id)
      : TTS_REGION_PRESETS[0]!.id,
  );
  const [apiKey, setApiKey] = useState<string>(initial?.apiKey ?? "");
  const [showKey, setShowKey] = useState(false);
  const [shown, setShown] = useState(false);
  const alreadyConfigured = initial != null;
  // Soft guard: tp- keys belong to Token Plan, sk- to pay-as-you-go. A
  // mismatched pairing hits the wrong endpoint → guaranteed auth failure →
  // silent playback (the very symptom BYO exists to kill). Warn, but never
  // block: prefix conventions could change and a hard gate would lock out an
  // otherwise-valid key.
  const expectedPrefix = keyType === "payg" ? "sk-" : "tp-";
  const prefixMismatch =
    apiKey.trim().length > 0 && !apiKey.trim().startsWith(expectedPrefix);

  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const close = () => {
    setShown(false);
    setTimeout(onClose, 280);
  };
  const save = () => {
    const key = apiKey.trim();
    if (!key) return;
    const presetId = keyType === "payg" ? PAYG_PRESET_ID : regionId;
    writeStoredTtsConfig({ presetId, apiKey: key });
    onSaved(true);
    close();
  };
  const disable = () => {
    clearStoredTtsConfig();
    onSaved(false);
    close();
  };

  return (
    <div
      onMouseDown={close}
      className={
        "fixed inset-0 z-[60] flex items-center justify-center p-6 md:p-10 transition-all duration-300 " +
        (shown
          ? "bg-clay-900/30 backdrop-blur-md"
          : "bg-clay-900/0 backdrop-blur-0")
      }
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className={
          "flex w-[560px] max-w-[94vw] max-h-[88vh] flex-col overflow-hidden rounded-sm border border-clay-900/15 bg-cream-50 shadow-2xl shadow-clay-900/25 transition-all duration-300 " +
          (shown ? "opacity-100 scale-100" : "opacity-0 scale-95")
        }
      >
        <div className="flex items-center gap-5 px-6 md:px-8 py-5 border-b border-clay-900/10">
          <div className="flex flex-col">
            <span className="font-serif text-xl md:text-2xl text-clay-900">
              自带配音 Key
            </span>
            <span className="text-[11px] text-clay-500 mt-1 tracking-wide">
              可选 · 用你自己的小米 MiMo 免费额度，配音更稳定、延迟更低
            </span>
          </div>
          <button
            type="button"
            onClick={close}
            aria-label="关闭"
            className="ml-auto text-xl leading-none text-clay-500 hover:text-clay-900 transition-colors"
          >
            <i className="fa-solid fa-xmark" />
          </button>
        </div>

        <div className="flex flex-col gap-6 overflow-y-auto px-6 md:px-8 py-6">
          <p className="text-[13px] leading-relaxed text-clay-600">
            经常没有声音？公共语音模型有调用频率限额（RPM / TPM），同时游玩的人多时很容易撞到限额而静音。填入你自己的小米 MiMo API Key 后，配音将
            <span className="text-clay-900">直接在你的浏览器里合成</span>
            、使用你自己的免费额度 ——{" "}
            <span className="text-clay-900">Key 只保存在本地浏览器、绝不经过我们的服务器</span>
            。
          </p>

          <div className="flex flex-col gap-2">
            <span className="text-[10px] smallcaps text-clay-500">K e y · 类 型</span>
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  { kind: "token-plan", label: "套餐 Token Plan", sub: "tp- 开头" },
                  { kind: "payg", label: "按量付费 Pay-as-you-go", sub: "sk- 开头" },
                ] as const
              ).map((t) => {
                const active = keyType === t.kind;
                return (
                  <button
                    key={t.kind}
                    type="button"
                    onClick={() => setKeyType(t.kind)}
                    className={
                      "flex flex-col gap-0.5 rounded-sm border px-3 py-2.5 text-left transition-all " +
                      (active
                        ? "border-ember-500 bg-ember-500/5 text-clay-900"
                        : "border-clay-900/12 text-clay-600 hover:border-clay-900/35 hover:bg-cream-100")
                    }
                  >
                    <span className="text-[13px]">{t.label}</span>
                    <span className="text-[10px] text-clay-400">{t.sub}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {keyType === "token-plan" ? (
            <div className="flex flex-col gap-2">
              <span className="text-[10px] smallcaps text-clay-500">区 域 节 点</span>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                {TTS_REGION_PRESETS.map((p) => {
                  const active = p.id === regionId;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setRegionId(p.id)}
                      className={
                        "rounded-sm border px-3 py-2.5 text-left text-[13px] transition-all " +
                        (active
                          ? "border-ember-500 bg-ember-500/5 text-clay-900"
                          : "border-clay-900/12 text-clay-600 hover:border-clay-900/35 hover:bg-cream-100")
                      }
                    >
                      {p.label}
                    </button>
                  );
                })}
              </div>
              <span className="text-[11px] text-clay-400">
                选择与你的套餐订阅地区一致的节点（通常也是延迟最低的那个）。
              </span>
            </div>
          ) : (
            <div className="flex items-start gap-2 rounded-sm border border-clay-900/10 bg-cream-100/60 px-3.5 py-2.5">
              <i className="fa-solid fa-circle-info mt-0.5 text-[11px] text-clay-400" />
              <span className="text-[11px] leading-relaxed text-clay-500">
                按量付费使用统一端点{" "}
                <span className="text-clay-700">api.xiaomimimo.com</span>
                ，无需选择区域。
              </span>
            </div>
          )}

          <div className="flex flex-col gap-2">
            <span className="text-[10px] smallcaps text-clay-500">
              A P I · K e y
            </span>
            <div className="relative">
              <input
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                type={showKey ? "text" : "password"}
                autoComplete="off"
                spellCheck={false}
                placeholder={
                  keyType === "payg"
                    ? "粘贴 sk- 开头的按量 Key"
                    : "粘贴 tp- 开头的套餐 Key"
                }
                className="h-11 w-full rounded-sm border border-clay-900/15 bg-cream-100 pl-4 pr-11 font-sans text-sm text-clay-900 outline-none transition-colors focus:border-ember-500 placeholder:text-clay-400"
              />
              <button
                type="button"
                onClick={() => setShowKey((v) => !v)}
                aria-label={showKey ? "隐藏" : "显示"}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-clay-400 hover:text-clay-700 transition-colors"
              >
                <i
                  className={`fa-solid ${showKey ? "fa-eye-slash" : "fa-eye"} text-sm`}
                />
              </button>
            </div>
            {prefixMismatch && (
              <span className="flex items-start gap-1.5 text-[11px] leading-relaxed text-ember-500">
                <i className="fa-solid fa-triangle-exclamation mt-0.5 text-[10px]" />
                此 Key 不是 {expectedPrefix} 开头，可能与所选「
                {keyType === "payg" ? "按量付费 Pay-as-you-go" : "套餐 Token Plan"}
                」类型不符，请确认是否填错。
              </span>
            )}
            <a
              href={TTS_KEY_DOC_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-[11px] text-ember-500 hover:text-ember-400 transition-colors"
            >
              <i className="fa-brands fa-github text-[11px]" />
              如何免费申请 Key？查看图文教程
            </a>
          </div>

          <p className="text-[11px] leading-relaxed text-clay-400">{footerNote}</p>
        </div>

        <div className="flex items-center gap-3 border-t border-clay-900/10 px-6 md:px-8 py-4">
          {alreadyConfigured && (
            <button
              type="button"
              onClick={disable}
              className="inline-flex items-center gap-2 rounded-sm border border-clay-900/15 px-4 py-2 font-sans text-sm text-clay-600 transition-colors hover:border-clay-900/35 hover:text-clay-900"
            >
              <i className="fa-solid fa-rotate-left text-xs" />
              停用并清除
            </button>
          )}
          <button
            type="button"
            onClick={save}
            disabled={!apiKey.trim()}
            className="ml-auto inline-flex items-center gap-2 rounded-sm bg-clay-900 px-5 py-2.5 font-sans text-sm text-cream-50 transition-colors hover:bg-ember-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <i className="fa-solid fa-check text-xs" />
            保存并启用
          </button>
        </div>
      </div>
    </div>
  );
}
