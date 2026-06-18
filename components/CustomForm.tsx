"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { track } from "@/lib/analytics";
import { useI18n } from "@/lib/i18n/client";
import { useLocalePath } from "@/lib/i18n/hooks";

export function CustomForm() {
  const router = useRouter();
  const { t } = useI18n();
  const lp = useLocalePath();
  const [worldSetting, setWorldSetting] = useState("");
  const [styleGuide, setStyleGuide] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const canSubmit =
    worldSetting.trim().length > 10 &&
    styleGuide.trim().length > 5 &&
    !submitting;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    sessionStorage.setItem(
      "infiplot:custom",
      JSON.stringify({ worldSetting, styleGuide }),
    );
    track("game_start", { source: "custom" });
    router.push(lp("/play?custom=1"));
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-12 animate-fade-in">
      <div>
        <label className="flex items-baseline justify-between mb-4">
          <span className="text-[10px] smallcaps text-clay-700 font-medium">
            <span className="text-clay-400 mr-2 font-serif italic not-italic font-normal">
              ①
            </span>
            {t("customForm.world")}
          </span>
          <span className="text-[10px] text-clay-400 num">
            {worldSetting.length}
          </span>
        </label>
        <textarea
          value={worldSetting}
          onChange={(e) => setWorldSetting(e.target.value)}
          rows={6}
          placeholder={t("customForm.worldPlaceholder")}
          className="w-full bg-transparent border-0 border-b border-clay-900/20 px-0 py-3 text-clay-900 font-serif text-lg leading-[1.7] focus:outline-none focus:border-clay-700 transition-colors resize-none placeholder:font-serif placeholder:italic placeholder:text-base placeholder:leading-[1.7]"
        />
      </div>

      <div>
        <label className="flex items-baseline justify-between mb-4">
          <span className="text-[10px] smallcaps text-clay-700 font-medium">
            <span className="text-clay-400 mr-2 font-serif italic not-italic font-normal">
              ②
            </span>
            {t("customForm.style")}
          </span>
          <span className="text-[10px] text-clay-400 num">
            {styleGuide.length}
          </span>
        </label>
        <textarea
          value={styleGuide}
          onChange={(e) => setStyleGuide(e.target.value)}
          rows={4}
          placeholder={t("customForm.stylePlaceholder")}
          className="w-full bg-transparent border-0 border-b border-clay-900/20 px-0 py-3 text-clay-900 font-serif text-lg leading-[1.7] focus:outline-none focus:border-clay-700 transition-colors resize-none placeholder:font-serif placeholder:italic placeholder:text-base placeholder:leading-[1.7]"
        />
      </div>

      <div className="pt-6 flex items-center justify-between">
        <span className="text-[10px] smallcaps text-clay-500">
          {submitting
            ? t("customForm.status.starting")
            : canSubmit
              ? t("customForm.status.ready")
              : t("customForm.status.needMore")}
        </span>
        <button
          type="submit"
          disabled={!canSubmit}
          className="group flex items-center gap-3 text-[10px] smallcaps text-clay-900 disabled:text-clay-300 disabled:cursor-not-allowed enabled:hover:text-ember-500 transition-colors duration-300"
        >
          {t("customForm.start")}
          <span className="w-10 h-px bg-current transition-all duration-300 group-enabled:group-hover:w-16" />
          <i className="fa-solid fa-arrow-right text-[9px]" />
        </button>
      </div>
    </form>
  );
}
