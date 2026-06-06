"use client";

import { useEffect, useRef } from "react";

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
}: {
  items: DialogueHistoryItem[];
  portrait: boolean;
  onClose: () => void;
}) {
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
        aria-label="剧情回溯"
      >
        <div className="flex items-center justify-between border-b border-cream-50/10 px-4 py-3">
          <div className="flex items-center gap-2 text-[10px] smallcaps text-cream-50/70">
            <i className="fa-solid fa-clock-rotate-left text-[10px]" />
            剧 · 情 · 回 · 溯
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center text-cream-50/60 transition-colors hover:text-cream-50"
            aria-label="关闭剧情回溯"
            title="关闭"
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
              暂无历史。
            </p>
          ) : (
            <div className="space-y-3">
              {items.map((item) => (
                <div key={item.id} className="text-left">
                  <div className="mb-1 flex items-baseline gap-2">
                    <span className="text-[9px] smallcaps text-cream-50/35">
                      第 {String(item.sceneIndex).padStart(3, "0")} 幕
                    </span>
                    {item.speaker && (
                      <span className="font-serif text-[12px] text-[rgba(205,165,90,0.92)]">
                        {item.speaker}
                      </span>
                    )}
                  </div>
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
                  {item.narration && (
                    <p
                      className={`mt-1 font-serif italic leading-[1.65] ${
                        portrait ? "text-[13px]" : "text-[12px]"
                      }`}
                      style={{ color: "rgba(200,185,155,0.72)" }}
                    >
                      {item.narration}
                    </p>
                  )}
                  {item.selectedChoice && (
                    <p className="mt-2 inline-flex max-w-full items-start gap-2 rounded-[5px] border border-[rgba(180,140,80,0.35)] bg-[rgba(180,140,60,0.10)] px-2.5 py-1.5 font-serif text-[12px] leading-snug text-cream-50/85">
                      <span className="shrink-0 text-[rgba(195,155,75,0.9)]">
                        选择
                      </span>
                      <span>{item.selectedChoice}</span>
                    </p>
                  )}
                  {item.freeformAction && (
                    <p className="mt-2 inline-flex max-w-full items-start gap-2 rounded-[5px] border border-ember-500/30 bg-ember-500/10 px-2.5 py-1.5 font-serif text-[12px] leading-snug text-cream-50/85">
                      <span className="shrink-0 text-ember-300/90">
                        行动
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
