"use client"

import type { ModelStat, StreakInfo } from "@/lib/dashboard/stats"
import { ProviderIcon } from "./provider-icon"

function fmt(v: number) {
  if (v >= 1000) return `$${(v / 1000).toFixed(1)}k`
  return `$${v.toFixed(v < 10 ? 2 : v < 100 ? 1 : 0)}`
}

function displayModel(label: string): string {
  const slash = label.lastIndexOf(" / ")
  const raw = slash >= 0 ? label.slice(slash + 3) : label
  return raw
    .replace(/^claude-/, "")
    .replace(/^gpt-/, "GPT ")
    .replace(/-\d{8,}$/, "")
    .split("-")
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(" ")
    .replace(/(\d) (\d)/g, "$1.$2")
}

export function StatsPanel({
  streaks,
  modelStats,
  onSelectModel,
  selectedModels,
}: {
  streaks: StreakInfo
  modelStats: ModelStat[]
  onSelectModel: (key: string) => void
  selectedModels: Set<string>
}) {
  const activePct =
    streaks.totalDays > 0
      ? Math.round((streaks.activeDays / streaks.totalDays) * 100)
      : 0

  return (
    <div className="flex flex-col gap-6 sm:gap-8">
      <div className="grid grid-cols-4 gap-2 text-center">
        <Stat label="current" value={`${streaks.current}d`} />
        <Stat label="longest" value={`${streaks.longest}d`} />
        <Stat label="active" value={`${streaks.activeDays}`} sub={`of ${streaks.totalDays}`} />
        <Stat label="rate" value={`${activePct}%`} />
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between font-mono text-[10px] text-stone-400 sm:mb-3 dark:text-stone-600">
          <span>model</span>
          <div className="flex gap-4 sm:gap-8">
            <span className="w-10 text-right sm:w-14">total</span>
            <span className="w-10 text-right sm:w-14">days</span>
            <span className="w-12 text-right sm:w-16">$/day</span>
            <span className="w-10 text-right sm:w-12">share</span>
          </div>
        </div>
        <div className="flex flex-col gap-0.5">
          {modelStats.slice(0, 12).map((m) => {
            const selected = selectedModels.has(m.key)
            const dimmed = selectedModels.size > 0 && !selected
            return (
              <button
                key={m.key}
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onSelectModel(m.key)
                }}
                className={`flex items-center gap-2 px-1 py-1 text-left transition-opacity sm:gap-3 ${
                  dimmed
                    ? "opacity-30 hover:opacity-60"
                    : selected
                      ? "bg-stone-200/70 dark:bg-stone-800/70"
                      : "hover:bg-stone-200/40 dark:hover:bg-stone-800/40"
                }`}
              >
                <span className="inline-flex w-4 justify-center">
                  <ProviderIcon name={m.provider} size={11} />
                </span>
                <span
                  className="flex-1 truncate text-[11px] sm:text-[13px] text-stone-700 dark:text-stone-300"
                  style={{ fontFamily: "var(--font-display)" }}
                >
                  {displayModel(m.label)}
                </span>
                <span className="flex gap-4 font-mono text-[10px] text-stone-500 tabular-nums sm:gap-8 sm:text-[12px] dark:text-stone-400">
                  <span className="w-10 text-right sm:w-14">{fmt(m.costUsd)}</span>
                  <span className="w-10 text-right sm:w-14">{m.activeDays}</span>
                  <span className="w-12 text-right sm:w-16">{fmt(m.avgPerActiveDay)}</span>
                  <span className="w-10 text-right sm:w-12">
                    {(m.share * 100).toFixed(1)}%
                  </span>
                </span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span
        className="text-xl tracking-tight text-stone-800 sm:text-2xl dark:text-stone-100"
        style={{ fontFamily: "var(--font-display)" }}
      >
        {value}
      </span>
      <span className="font-mono text-[9px] text-stone-400 sm:text-[10px] dark:text-stone-600">
        {label}
        {sub ? ` · ${sub}` : ""}
      </span>
    </div>
  )
}
