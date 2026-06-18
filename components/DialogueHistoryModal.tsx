"use client";

import { useEffect, useRef } from "react";
import { useI18n } from "@/lib/i18n/client";

export type DialogueHistoryItem = {
  id: string;
  sceneIndex: number;
  speaker?: string;
  body?: string;
  narration?: string;
  selectedChoice?: string;
  freeformAction?: string;
};

export function DialogueHistoryModal({
  items,
  portrait,
  onClose,
  playerName,
}: {
  items: DialogueHistoryItem[];
  portrait: boolean;
  onClose: () => void;
  playerName?: string;
}) {
  const { t } = useI18n();
  const displaySpeaker = (s: string | undefined) =>
    s === "你" && playerName ? playerName : s;
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [items.length]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      className="absolute inset-0 z-20 flex items-center justify-center px-4 py-6 pointer-events-auto"
      style={{ background: "rgba(0,0,0,0.38)" }}
      onClick={onClose}
    >
      <div
        className={`w-full ${
          portrait ? "max-w-[92vw]" : "max-w-2xl"
        } max-h-[72dvh] overflow-hidden`}
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "rgba(14, 10, 6, 0.88)",
          border: "1.5px solid rgba(175, 138, 72, 0.72)",
          borderRadius: "6px",
          backdropFilter: "blur(14px)",
          WebkitBackdropFilter: "blur(14px)",
          boxShadow:
            "0 10px 42px rgba(0,0,0,0.62), inset 0 1px 0 rgba(200,165,90,0.12)",
        }}
        role="dialog"
        aria-modal="true"
        aria-label={t("history.ariaLabel")}
      >
        <div className="flex items-center justify-between border-b border-cream-50/10 px-4 py-3">
          <div className="flex items-center gap-2 text-[10px] smallcaps text-cream-50/70">
            <i className="fa-solid fa-clock-rotate-left text-[10px]" />
            {t("history.title")}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center text-cream-50/60 transition-colors hover:text-cream-50"
            aria-label={t("history.closeAriaLabel")}
            title={t("history.close")}
          >
            <i className="fa-solid fa-xmark text-[12px]" />
          </button>
        </div>

        <div
          ref={listRef}
          className={`vn-scrollbar overflow-y-auto px-4 py-3 ${
            portrait ? "max-h-[58dvh]" : "max-h-[60dvh]"
          }`}
        >
          {items.length === 0 ? (
            <p className="py-8 text-center font-serif text-[13px] text-cream-50/55">
              {t("history.noHistory")}
            </p>
          ) : (
            <div className="space-y-3">
              {items.map((item) => (
                <div key={item.id} className="text-left">
                  <div className="mb-1 flex items-baseline gap-2">
                    <span className="text-[9px] smallcaps text-cream-50/35">
                      {t("history.scene", { n: String(item.sceneIndex).padStart(3, "0") })}
                    </span>
                    {item.speaker && (
                      <span className="font-serif text-[12px] text-[rgba(205,165,90,0.92)]">
                        {displaySpeaker(item.speaker)}
                      </span>
                    )}
                  </div>
                  {item.narration && (
                    <p
                      className={`font-serif leading-[1.7] ${
                        item.body ? "mb-1" : ""
                      } ${portrait ? "text-[14px]" : "text-[12px]"}`}
                      style={{ color: "rgba(228,218,196,0.85)" }}
                    >
                      {item.narration}
                    </p>
                  )}
                  {item.body && (
                    <p
                      className={`font-serif leading-[1.75] ${
                        portrait ? "text-[15px]" : "text-[13px]"
                      }`}
                      style={{ color: "rgba(245,235,210,0.94)" }}
                    >
                      {item.body}
                    </p>
                  )}
                  {item.selectedChoice && (
                    <p className="mt-2 inline-flex max-w-full items-start gap-2 rounded-[5px] border border-[rgba(180,140,80,0.35)] bg-[rgba(180,140,60,0.10)] px-2.5 py-1.5 font-serif text-[12px] leading-snug text-cream-50/85">
                      <span className="shrink-0 text-[rgba(195,155,75,0.9)]">
                        {t("history.choice")}
                      </span>
                      <span>{item.selectedChoice}</span>
                    </p>
                  )}
                  {item.freeformAction && (
                    <p className="mt-2 inline-flex max-w-full items-start gap-2 rounded-[5px] border border-ember-500/30 bg-ember-500/10 px-2.5 py-1.5 font-serif text-[12px] leading-snug text-cream-50/85">
                      <span className="shrink-0 text-ember-300/90">
                        {t("history.action")}
                      </span>
                      <span>{item.freeformAction}</span>
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
