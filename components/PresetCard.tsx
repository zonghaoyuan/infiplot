"use client";

import { useRouter } from "next/navigation";
import type { Preset } from "@/lib/presets";
import { useLocalePath } from "@/lib/i18n/hooks";

export function PresetCard({
  preset,
  ordinal,
}: {
  preset: Preset;
  ordinal: string;
}) {
  const router = useRouter();
  const lp = useLocalePath();
  return (
    <button
      onClick={() => router.push(lp(`/play?preset=${preset.id}`))}
      className="group block w-full py-10 md:py-12 border-t border-clay-900/10 hover:border-clay-900/35 transition-[border-color,padding] duration-500 text-left"
    >
      <div className="flex items-baseline gap-6 md:gap-10">
        <span className="font-serif italic text-2xl md:text-3xl text-clay-400 group-hover:text-clay-700 transition-colors duration-500 w-8 shrink-0">
          {ordinal}
        </span>
        <div className="flex-1 min-w-0">
          <h3 className="font-serif text-3xl md:text-4xl text-clay-900 leading-tight mb-2.5">
            {preset.title}
          </h3>
          <p className="text-sm text-clay-600 leading-relaxed max-w-md">
            {preset.blurb}
          </p>
        </div>
        <span className="hidden md:flex items-center gap-3 text-[10px] tracking-[0.4em] text-clay-400 group-hover:text-ember-500 transition-colors duration-500 shrink-0 self-center">
          ENTER
          <span className="w-7 h-px bg-current transition-all duration-500 group-hover:w-12" />
        </span>
      </div>
    </button>
  );
}
