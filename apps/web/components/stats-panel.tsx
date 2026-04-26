"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import type { ModelStat, StreakInfo } from "@/lib/dashboard/stats"
import { ProviderIcon } from "./provider-icon"

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
  fmt,
}: {
  streaks: StreakInfo
  modelStats: ModelStat[]
  onSelectModel: (key: string) => void
  selectedModels: Set<string>
  fmt: (v: number) => string
}) {
  const activePct =
    streaks.totalDays > 0
      ? Math.round((streaks.activeDays / streaks.totalDays) * 100)
      : 0

  const [query, setQuery] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === "INPUT" || tag === "TEXTAREA") return
      if (e.key === "/") {
        e.preventDefault()
        inputRef.current?.focus()
      }
      if (e.key === "Escape" && document.activeElement === inputRef.current) {
        setQuery("")
        inputRef.current?.blur()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  const filteredStats = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return modelStats
    return modelStats.filter(
      (m) =>
        m.label.toLowerCase().includes(q) ||
        m.provider.toLowerCase().includes(q),
    )
  }, [modelStats, query])

  return (
    <div className="flex flex-col gap-6 sm:gap-8">
      <div className="grid grid-cols-4 gap-2 text-center">
        <Stat label="current" value={`${streaks.current}d`} />
        <Stat label="longest" value={`${streaks.longest}d`} />
        <Stat label="active" value={`${streaks.activeDays}`} sub={`of ${streaks.totalDays}`} />
        <Stat label="rate" value={`${activePct}%`} />
      </div>

      <div>
        <div className="mb-2 flex items-center gap-2 px-1 font-mono text-[10px] text-stone-400 sm:mb-3 sm:gap-3 dark:text-stone-600">
          <span className="w-4" />
          <span className="flex flex-1 items-center gap-2">
            <span>model</span>
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              placeholder="filter… (/)"
              className="w-24 border-b border-stone-300 bg-transparent px-1 py-0.5 font-mono text-[10px] text-stone-700 placeholder-stone-400 outline-none transition-colors focus:border-amber-500 sm:w-32 dark:border-stone-700 dark:text-stone-300 dark:placeholder-stone-600 dark:focus:border-amber-400"
            />
          </span>
          <span className="flex shrink-0 gap-4 sm:gap-8">
            <span className="w-10 text-right sm:w-14">total</span>
            <span className="w-10 text-right sm:w-14">days</span>
            <span className="w-12 text-right sm:w-16">$/day</span>
            <span className="w-10 text-right sm:w-12">share</span>
          </span>
        </div>
        <div className="flex flex-col gap-0.5">
          {filteredStats.slice(0, 12).map((m) => {
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
                <span className="inline-flex w-4 shrink-0 justify-center">
                  <ProviderIcon name={m.provider} size={11} />
                </span>
                <span
                  className="min-w-0 flex-1 truncate text-[11px] sm:text-[13px] text-stone-700 dark:text-stone-300"
                  style={{ fontFamily: "var(--font-display)" }}
                >
                  {displayModel(m.label)}
                </span>
                <span className="flex shrink-0 gap-4 font-mono text-[10px] text-stone-500 tabular-nums sm:gap-8 sm:text-[12px] dark:text-stone-400">
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
