"use client";

import { type ReactNode, useEffect, useState } from "react";
import type { ProviderProtocol } from "@infiplot/types";
import {
  clearStoredModelConfig,
  readStoredModelConfig,
  writeStoredModelConfig,
} from "@/lib/clientModelConfig";
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

const PLAYER_NAME_STORAGE_KEY = "infiplot:playerName";
const VISION_CLICK_STORAGE_KEY = "infiplot:visionClick";

export function readStoredPlayerName(): string {
  try {
    return localStorage.getItem(PLAYER_NAME_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

export function writeStoredPlayerName(name: string): void {
  try {
    if (name) {
      localStorage.setItem(PLAYER_NAME_STORAGE_KEY, name);
    } else {
      localStorage.removeItem(PLAYER_NAME_STORAGE_KEY);
    }
  } catch {
    /* ignore */
  }
}

export function readStoredVisionClick(): boolean {
  try {
    return localStorage.getItem(VISION_CLICK_STORAGE_KEY) !== "0";
  } catch {
    return true;
  }
}

const PROVIDER_OPTIONS: { value: ProviderProtocol | ""; label: string }[] = [
  { value: "", label: "自动推断（推荐）" },
  { value: "openai_compatible", label: "OpenAI Compatible" },
  { value: "runware", label: "Runware" },
];

type ModelGroup = {
  key: "text" | "image" | "vision";
  label: string;
  icon: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  provider: string;
};

type TabKey = "general" | "models";

export function SettingsModal({
  initialTab = "general",
  initialVisionClickEnabled = true,
  onClose,
  onSaved,
  footerNote,
}: {
  initialTab?: TabKey;
  initialVisionClickEnabled?: boolean;
  onClose: () => void;
  onSaved: (settings: {
    playerName: string;
    visionClickEnabled: boolean;
    ttsConfigured: boolean;
  }) => void;
  footerNote?: ReactNode;
}) {
  const [activeTab, setActiveTab] = useState<TabKey>(initialTab);

  // ── General tab state ──
  const [playerName, setPlayerName] = useState(() => readStoredPlayerName());
  const [visionClick, setVisionClick] = useState(initialVisionClickEnabled);

  // ── Models tab state ──
  const initial = readStoredModelConfig();
  const [groups, setGroups] = useState<ModelGroup[]>([
    {
      key: "text",
      label: "文本模型",
      icon: "fa-solid fa-pen-nib",
      baseUrl: initial?.textBaseUrl ?? "",
      apiKey: initial?.textApiKey ?? "",
      model: initial?.textModel ?? "",
      provider: initial?.textProvider ?? "",
    },
    {
      key: "image",
      label: "绘图模型",
      icon: "fa-solid fa-palette",
      baseUrl: initial?.imageBaseUrl ?? "",
      apiKey: initial?.imageApiKey ?? "",
      model: initial?.imageModel ?? "",
      provider: initial?.imageProvider ?? "",
    },
    {
      key: "vision",
      label: "识图模型",
      icon: "fa-solid fa-eye",
      baseUrl: initial?.visionBaseUrl ?? "",
      apiKey: initial?.visionApiKey ?? "",
      model: initial?.visionModel ?? "",
      provider: initial?.visionProvider ?? "",
    },
  ]);
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});

  // TTS state
  const [initialTts] = useState(() => readStoredTtsConfig());
  const initialKind = findTtsPreset(initialTts?.presetId)?.kind ?? "payg";
  const [keyType, setKeyType] = useState<"token-plan" | "payg">(initialKind);
  const [regionId, setRegionId] = useState<string>(
    initialKind === "token-plan"
      ? (initialTts?.presetId ?? TTS_REGION_PRESETS[0]!.id)
      : TTS_REGION_PRESETS[0]!.id,
  );
  const [ttsApiKey, setTtsApiKey] = useState<string>(initialTts?.apiKey ?? "");
  const [showTtsKey, setShowTtsKey] = useState(false);

  const expectedPrefix = keyType === "payg" ? "sk-" : "tp-";
  const prefixMismatch =
    ttsApiKey.trim().length > 0 && !ttsApiKey.trim().startsWith(expectedPrefix);

  // ── Animation ──
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const close = () => {
    setShown(false);
    setTimeout(onClose, 280);
  };

  // ── General actions ──
  const saveGeneral = () => {
    const name = playerName.trim();
    writeStoredPlayerName(name);
    try {
      localStorage.setItem(VISION_CLICK_STORAGE_KEY, visionClick ? "1" : "0");
    } catch { /* ignore */ }
  };

  const clearGeneral = () => {
    writeStoredPlayerName("");
    try { localStorage.removeItem(VISION_CLICK_STORAGE_KEY); } catch { /* ignore */ }
    setPlayerName("");
    setVisionClick(true);
  };

  const hasGeneralSetting = readStoredPlayerName().length > 0;

  // ── Models actions ──
  const updateGroup = (
    key: string,
    field: keyof Omit<ModelGroup, "key" | "label" | "icon">,
    value: string,
  ) => {
    setGroups((prev) =>
      prev.map((g) => (g.key === key ? { ...g, [field]: value } : g)),
    );
  };

  const saveModels = () => {
    const [text, image, vision] = groups;
    if (text && image && vision) {
      writeStoredModelConfig({
        textBaseUrl: text.baseUrl,
        textApiKey: text.apiKey,
        textModel: text.model,
        textProvider: (text.provider as ProviderProtocol) || undefined,
        imageBaseUrl: image.baseUrl,
        imageApiKey: image.apiKey,
        imageModel: image.model,
        imageProvider: (image.provider as ProviderProtocol) || undefined,
        visionBaseUrl: vision.baseUrl,
        visionApiKey: vision.apiKey,
        visionModel: vision.model,
        visionProvider: (vision.provider as ProviderProtocol) || undefined,
      });
    }

    const key = ttsApiKey.trim();
    if (key) {
      const presetId = keyType === "payg" ? PAYG_PRESET_ID : regionId;
      writeStoredTtsConfig({ presetId, apiKey: key });
    } else {
      clearStoredTtsConfig();
    }
  };

  const clearModels = () => {
    clearStoredModelConfig();
    clearStoredTtsConfig();
    setGroups((prev) =>
      prev.map((g) => ({ ...g, baseUrl: "", apiKey: "", model: "", provider: "" })),
    );
    setTtsApiKey("");
  };

  const hasModelSetting =
    groups.some((g) => g.baseUrl.trim() && g.apiKey.trim() && g.model.trim()) ||
    initialTts != null;

  // ── Global save / clear ──
  const save = () => {
    saveGeneral();
    saveModels();

    const ttsConfigured = ttsApiKey.trim().length > 0;
    onSaved({
      playerName: playerName.trim(),
      visionClickEnabled: visionClick,
      ttsConfigured,
    });
    close();
  };

  const clearAll = () => {
    clearGeneral();
    clearModels();
    onSaved({ playerName: "", visionClickEnabled: true, ttsConfigured: false });
    close();
  };

  const hasAnySetting = hasGeneralSetting || hasModelSetting;

  const tabs: { key: TabKey; label: string; icon: string }[] = [
    { key: "general", label: "通用", icon: "fa-solid fa-sliders" },
    { key: "models", label: "模型", icon: "fa-solid fa-microchip" },
  ];

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
          "flex w-[640px] max-w-[96vw] max-h-[90vh] flex-col overflow-hidden rounded-sm border border-clay-900/15 bg-cream-50 shadow-2xl shadow-clay-900/25 transition-all duration-300 " +
          (shown ? "opacity-100 scale-100" : "opacity-0 scale-95")
        }
      >
        {/* Header */}
        <div className="flex items-center gap-5 px-6 md:px-8 py-5 border-b border-clay-900/10">
          <div className="flex flex-col">
            <span className="font-serif text-xl md:text-2xl text-clay-900">
              设置
            </span>
            <span className="text-[11px] text-clay-500 mt-1 tracking-wide">
              可选 · 这些设置仅保存在本地浏览器
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

        {/* Tab bar */}
        <div className="flex border-b border-clay-900/8 px-6 md:px-8">
          {tabs.map((t) => {
            const active = activeTab === t.key;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setActiveTab(t.key)}
                className={
                  "flex items-center gap-2 px-4 py-3 text-[13px] font-sans transition-colors border-b-2 -mb-px " +
                  (active
                    ? "border-ember-500 text-clay-900"
                    : "border-transparent text-clay-500 hover:text-clay-700")
                }
              >
                <i className={`${t.icon} text-[11px]`} />
                {t.label}
              </button>
            );
          })}
        </div>

        {/* Content */}
        <div className="thin-scrollbar flex flex-col gap-0 overflow-y-auto flex-1">
          {activeTab === "general" && (
            <>
              {/* ── Player Name Section ── */}
              <div className="flex flex-col gap-3 px-6 md:px-8 py-5">
                <div className="flex items-center gap-2.5">
                  <span className="flex h-7 w-7 items-center justify-center rounded-sm border border-clay-900/10 bg-cream-100 text-clay-400">
                    <i className="fa-solid fa-user-pen text-[11px]" />
                  </span>
                  <span className="font-serif text-base text-clay-900">
                    玩家名字
                  </span>
                </div>
                <input
                  value={playerName}
                  onChange={(e) => setPlayerName(e.target.value)}
                  type="text"
                  maxLength={20}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="不填则使用「你」"
                  className="h-11 w-full rounded-sm border border-clay-900/15 bg-cream-100 px-4 font-sans text-sm text-clay-900 outline-none transition-colors focus:border-ember-500 placeholder:text-clay-400"
                />
                <span className="text-[11px] text-clay-400">
                  NPC 会在对话中用这个名字称呼你。不填则默认以「你」称呼。
                </span>
              </div>

              <div className="border-t border-clay-900/8 mx-6 md:mx-8" />

              {/* ── Vision Click Section ── */}
              <div className="flex flex-col gap-3 px-6 md:px-8 py-5">
                <div className="flex items-center gap-2.5">
                  <span className="flex h-7 w-7 items-center justify-center rounded-sm border border-clay-900/10 bg-cream-100 text-clay-400">
                    <i className="fa-solid fa-eye text-[11px]" />
                  </span>
                  <span className="font-serif text-base text-clay-900">
                    点击画面识别
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {(
                    [
                      { on: true, label: "开启", icon: "fa-solid fa-wand-magic-sparkles" },
                      { on: false, label: "关闭", icon: "fa-solid fa-ban" },
                    ] as const
                  ).map((t) => {
                    const active = visionClick === t.on;
                    return (
                      <button
                        key={String(t.on)}
                        type="button"
                        onClick={() => setVisionClick(t.on)}
                        className={
                          "flex items-center justify-center gap-2 rounded-sm border px-3 py-2.5 text-[13px] transition-all " +
                          (active
                            ? "border-ember-500 bg-ember-500/5 text-clay-900"
                            : "border-clay-900/12 text-clay-600 hover:border-clay-900/35 hover:bg-cream-100")
                        }
                      >
                        <i className={t.icon + " text-[11px]"} />
                        {t.label}
                      </button>
                    );
                  })}
                </div>
                <span className="text-[11px] text-clay-400">
                  开启后，在选择节点点击画面会触发 AI 识图并生成新的剧情分支。
                </span>
              </div>

              {footerNote && (
                <div className="px-6 md:px-8 pb-5">
                  <p className="text-[11px] leading-relaxed text-clay-400">
                    {footerNote}
                  </p>
                </div>
              )}
            </>
          )}

          {activeTab === "models" && (
            <>
              {groups.map((g, idx) => (
                <div key={g.key}>
                  {idx > 0 && (
                    <div className="border-t border-clay-900/8 mx-6 md:mx-8" />
                  )}
                  <div className="flex flex-col gap-3 px-6 md:px-8 py-5">
                    <div className="flex items-center gap-2.5">
                      <span className="flex h-7 w-7 items-center justify-center rounded-sm border border-clay-900/10 bg-cream-100 text-clay-400">
                        <i className={`${g.icon} text-[11px]`} />
                      </span>
                      <span className="font-serif text-base text-clay-900">
                        {g.label}
                      </span>
                    </div>

                    <div className="flex flex-col gap-2">
                      <span className="text-[10px] smallcaps text-clay-500">
                        B A S E · U R L
                      </span>
                      <input
                        value={g.baseUrl}
                        onChange={(e) => updateGroup(g.key, "baseUrl", e.target.value)}
                        type="text"
                        autoComplete="off"
                        spellCheck={false}
                        placeholder="https://api.example.com/v1"
                        className="h-10 w-full rounded-sm border border-clay-900/15 bg-cream-100 px-4 font-sans text-sm text-clay-900 outline-none transition-colors focus:border-ember-500 placeholder:text-clay-400"
                      />
                    </div>

                    <div className="flex flex-col gap-2">
                      <span className="text-[10px] smallcaps text-clay-500">
                        A P I · K e y
                      </span>
                      <div className="relative">
                        <input
                          value={g.apiKey}
                          onChange={(e) => updateGroup(g.key, "apiKey", e.target.value)}
                          type={showKeys[g.key] ? "text" : "password"}
                          autoComplete="off"
                          spellCheck={false}
                          placeholder="sk-..."
                          className="h-10 w-full rounded-sm border border-clay-900/15 bg-cream-100 pl-4 pr-11 font-sans text-sm text-clay-900 outline-none transition-colors focus:border-ember-500 placeholder:text-clay-400"
                        />
                        <button
                          type="button"
                          onClick={() =>
                            setShowKeys((prev) => ({
                              ...prev,
                              [g.key]: !prev[g.key],
                            }))
                          }
                          aria-label={showKeys[g.key] ? "隐藏" : "显示"}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-clay-400 hover:text-clay-700 transition-colors"
                        >
                          <i
                            className={`fa-solid ${showKeys[g.key] ? "fa-eye-slash" : "fa-eye"} text-sm`}
                          />
                        </button>
                      </div>
                    </div>

                    <div className="flex flex-col gap-2">
                      <span className="text-[10px] smallcaps text-clay-500">
                        M o d e l
                      </span>
                      <input
                        value={g.model}
                        onChange={(e) => updateGroup(g.key, "model", e.target.value)}
                        type="text"
                        autoComplete="off"
                        spellCheck={false}
                        placeholder="gpt-4o / claude-3-5-sonnet / flux-1-dev ..."
                        className="h-10 w-full rounded-sm border border-clay-900/15 bg-cream-100 px-4 font-sans text-sm text-clay-900 outline-none transition-colors focus:border-ember-500 placeholder:text-clay-400"
                      />
                    </div>

                    <div className="flex flex-col gap-2">
                      <span className="text-[10px] smallcaps text-clay-500">
                        P r o v i d e r（可选）
                      </span>
                      <select
                        value={g.provider}
                        onChange={(e) => updateGroup(g.key, "provider", e.target.value)}
                        className="h-10 w-full rounded-sm border border-clay-900/15 bg-cream-100 px-4 font-sans text-sm text-clay-900 outline-none transition-colors focus:border-ember-500"
                      >
                        {PROVIDER_OPTIONS.map((opt) => (
                          <option key={opt.value || "auto"} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                      <span className="text-[11px] text-clay-400">
                        留空时系统会根据 Base URL 自动推断协议。
                      </span>
                    </div>
                  </div>
                </div>
              ))}

              <div className="border-t border-clay-900/8 mx-6 md:mx-8" />

              {/* ── TTS Key Section ── */}
              <div className="flex flex-col gap-3 px-6 md:px-8 pt-5 pb-5">
                <div className="flex items-center gap-2.5">
                  <span className="flex h-7 w-7 items-center justify-center rounded-sm border border-clay-900/10 bg-cream-100 text-clay-400">
                    <i className="fa-solid fa-key text-[11px]" />
                  </span>
                  <span className="font-serif text-base text-clay-900">
                    自带配音 Key
                  </span>
                  <span className="text-[10px] text-clay-400">可选</span>
                </div>
                <p className="text-[12px] leading-relaxed text-clay-500">
                  填入你自己的
                  <span className="text-clay-800"> 小米 MiMo API Key</span>
                  ，配音将在浏览器本地合成，Key 只保存在本地、绝不经过服务器。MiMo
                  TTS 目前
                  <span className="text-clay-800">限时免费</span>
                  ，申请即可使用。
                </p>

                <div className="flex flex-col gap-2">
                  <span className="text-[10px] smallcaps text-clay-500">
                    K e y · 类 型
                  </span>
                  <div className="grid grid-cols-2 gap-2">
                    {(
                      [
                        {
                          kind: "payg",
                          label: "按量付费 Pay-as-you-go",
                          sub: "sk- 开头",
                        },
                        {
                          kind: "token-plan",
                          label: "套餐 Token Plan",
                          sub: "tp- 开头",
                        },
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
                          <span className="text-[10px] text-clay-400">
                            {t.sub}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {keyType === "token-plan" && (
                  <div className="flex flex-col gap-2">
                    <span className="text-[10px] smallcaps text-clay-500">
                      区 域 节 点
                    </span>
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
                )}

                <div className="flex flex-col gap-2">
                  <span className="text-[10px] smallcaps text-clay-500">
                    A P I · K e y
                  </span>
                  <div className="relative">
                    <input
                      value={ttsApiKey}
                      onChange={(e) => setTtsApiKey(e.target.value)}
                      type={showTtsKey ? "text" : "password"}
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
                      onClick={() => setShowTtsKey((v) => !v)}
                      aria-label={showTtsKey ? "隐藏" : "显示"}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-clay-400 hover:text-clay-700 transition-colors"
                    >
                      <i
                        className={`fa-solid ${showTtsKey ? "fa-eye-slash" : "fa-eye"} text-sm`}
                      />
                    </button>
                  </div>
                  {prefixMismatch && (
                    <span className="flex items-start gap-1.5 text-[11px] leading-relaxed text-ember-500">
                      <i className="fa-solid fa-triangle-exclamation mt-0.5 text-[10px]" />
                      此 Key 不是 {expectedPrefix} 开头，可能与所选「
                      {keyType === "payg"
                        ? "按量付费 Pay-as-you-go"
                        : "套餐 Token Plan"}
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
              </div>

              <div className="border-t border-clay-900/8 mx-6 md:mx-8" />

              <div className="px-6 md:px-8 py-4">
                <p className="text-[11px] leading-relaxed text-clay-400">
                  <i className="fa-solid fa-circle-info mr-1.5" />
                  请确保你的 API 端点支持浏览器跨域请求（CORS）。大多数主流提供商（OpenAI、Anthropic、Gemini、Runware 等）已默认支持。
                </p>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-3 border-t border-clay-900/10 px-6 md:px-8 py-4">
          {hasAnySetting && (
            <button
              type="button"
              onClick={clearAll}
              className="inline-flex items-center gap-2 rounded-sm border border-clay-900/15 px-4 py-2 font-sans text-sm text-clay-600 transition-colors hover:border-clay-900/35 hover:text-clay-900"
            >
              <i className="fa-solid fa-rotate-left text-xs" />
              全部清除
            </button>
          )}
          <button
            type="button"
            onClick={save}
            className="ml-auto inline-flex items-center gap-2 rounded-sm bg-clay-900 px-5 py-2.5 font-sans text-sm text-cream-50 transition-colors hover:bg-ember-500"
          >
            <i className="fa-solid fa-check text-xs" />
            保存
          </button>
        </div>
      </div>
    </div>
  );
}
