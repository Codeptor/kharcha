"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import type { ModelStat, StreakInfo, UsageMetrics } from "@/lib/dashboard/stats"
import { ProviderIcon, ModelIcon } from "./provider-icon"

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
  metrics,
  onSelectModel,
  selectedModels,
  fmt,
  fmtTokens,
}: {
  streaks: StreakInfo
  modelStats: ModelStat[]
  metrics: UsageMetrics
  onSelectModel: (key: string) => void
  selectedModels: Set<string>
  fmt: (v: number) => string
  fmtTokens: (v: number) => string
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
        m.provider.toLowerCase().includes(q)
    )
  }, [modelStats, query])

  return (
    <div className="flex min-h-0 flex-col gap-3 sm:gap-4">
      <div className="grid grid-cols-4 gap-1.5 text-center min-[380px]:gap-2">
        <Stat label="tokens" value={fmtTokens(metrics.totalTokens)} />
        <Stat
          label="priced"
          value={`${(metrics.pricedCoverage * 100).toFixed(1)}%`}
        />
        <Stat
          label="cost/mtok"
          value={
            metrics.costPerMillionTokens === null
              ? "n/a"
              : fmt(metrics.costPerMillionTokens)
          }
        />
        <Stat
          label="cache"
          value={`${(metrics.cacheShare * 100).toFixed(1)}%`}
        />
      </div>

      <div className="grid grid-cols-4 gap-1.5 text-center min-[380px]:gap-2">
        <Stat label="current" value={`${streaks.current}d`} />
        <Stat label="longest" value={`${streaks.longest}d`} />
        <Stat
          label="active"
          value={`${streaks.activeDays}`}
          sub={`of ${streaks.totalDays}`}
        />
        <Stat label="rate" value={`${activePct}%`} />
      </div>

      <div className="grid grid-cols-2 gap-x-5 gap-y-2 font-mono text-[10px] text-stone-500 sm:grid-cols-4 sm:text-[11px] dark:text-stone-500">
        <Metric label="input" value={fmtTokens(metrics.input)} />
        <Metric label="output" value={fmtTokens(metrics.output)} />
        <Metric label="cache read" value={fmtTokens(metrics.cacheRead)} />
        <Metric label="cache write" value={fmtTokens(metrics.cacheWrite)} />
        <Metric label="total only" value={fmtTokens(metrics.aggregate)} />
        <Metric label="rows" value={metrics.rows.toLocaleString()} />
        <Metric
          label="token rows"
          value={metrics.nonzeroTokenRows.toLocaleString()}
        />
        <Metric
          label="unpriced tok"
          value={fmtTokens(metrics.unpricedTokens)}
        />
        <Metric
          label="unpriced rows"
          value={metrics.unpricedNonzeroRows.toLocaleString()}
        />
      </div>

      <div className="grid grid-cols-1 gap-2 min-[380px]:grid-cols-3">
        {metrics.modeStats.map((mode) => (
          <div
            key={mode.mode}
            className="border-t border-stone-300 pt-2 dark:border-stone-800"
          >
            <div className="font-mono text-[9px] text-stone-400 dark:text-stone-600">
              {mode.mode}
            </div>
            <div
              className="text-[15px] text-stone-800 dark:text-stone-200"
              style={{ fontFamily: "var(--font-display)" }}
            >
              {fmt(mode.costUsd)}
            </div>
            <div className="font-mono text-[9px] text-stone-500 dark:text-stone-500">
              {fmtTokens(mode.totalTokens)}
            </div>
          </div>
        ))}
      </div>

      <div className="min-h-0">
        <div className="mb-2 flex items-center justify-between px-1 font-mono text-[10px] text-stone-400 dark:text-stone-600">
          <span>sources</span>
          <span>tokens · cost/mtok</span>
        </div>
        <div className="no-scrollbar flex max-h-24 flex-col gap-1 overflow-y-auto pr-1 sm:max-h-28">
          {metrics.sourceStats.map((source) => (
            <div key={source.source} className="flex items-center gap-2 px-1">
              <span className="inline-flex w-4 shrink-0 justify-center">
                <ProviderIcon name={source.source} size={11} />
              </span>
              <span
                className="min-w-0 flex-1 truncate text-[11px] text-stone-700 sm:text-[13px] dark:text-stone-300"
                style={{ fontFamily: "var(--font-display)" }}
              >
                {source.source}
              </span>
              <span className="font-mono text-[10px] text-stone-500 tabular-nums sm:text-[12px] dark:text-stone-400">
                {fmtTokens(source.totalTokens)} ·{" "}
                {source.costPerMillionTokens === null
                  ? "n/a"
                  : fmt(source.costPerMillionTokens)}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="min-h-0">
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
              className="w-24 border-b border-stone-300 bg-transparent px-1 py-0.5 font-mono text-[10px] text-stone-700 placeholder-stone-400 transition-colors outline-none focus:border-amber-500 sm:w-32 dark:border-stone-700 dark:text-stone-300 dark:placeholder-stone-600 dark:focus:border-amber-400"
            />
          </span>
          <span className="hidden shrink-0 gap-3 min-[430px]:flex sm:gap-8">
            <span className="w-10 text-right sm:w-14">total</span>
            <span className="w-10 text-right sm:w-14">tokens</span>
            <span className="w-12 text-right sm:w-16">$/mtok</span>
            <span className="w-10 text-right sm:w-12">share</span>
          </span>
        </div>
        <div className="no-scrollbar flex max-h-52 flex-col gap-0.5 overflow-y-auto pr-1 sm:max-h-[clamp(8rem,calc(100dvh-35rem),16rem)]">
          {filteredStats.map((m) => {
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
                className={`flex flex-col gap-1 px-1 py-1.5 text-left transition-opacity min-[430px]:flex-row min-[430px]:items-center min-[430px]:gap-2 min-[430px]:py-1 sm:gap-3 ${
                  dimmed
                    ? "opacity-30 hover:opacity-60"
                    : selected
                      ? "bg-stone-200/70 dark:bg-stone-800/70"
                      : "hover:bg-stone-200/40 dark:hover:bg-stone-800/40"
                }`}
              >
                <span className="flex w-full min-w-0 items-center gap-2 min-[430px]:w-auto min-[430px]:flex-1">
                  <span className="inline-flex w-4 shrink-0 justify-center">
                    <ModelIcon model={m.label} provider={m.provider} size={11} />
                  </span>
                  <span
                    className="min-w-0 flex-1 truncate text-[11px] text-stone-700 sm:text-[13px] dark:text-stone-300"
                    style={{ fontFamily: "var(--font-display)" }}
                  >
                    {displayModel(m.label)}
                  </span>
                  <span className="hidden items-center gap-1 sm:inline-flex" title={`provider: ${m.provider}`}>
                    <ProviderIcon name={m.provider} size={10} />
                  </span>
                </span>
                <span className="grid w-full grid-cols-4 gap-2 pl-6 font-mono text-[10px] text-stone-500 tabular-nums min-[430px]:flex min-[430px]:w-auto min-[430px]:shrink-0 min-[430px]:gap-3 min-[430px]:pl-0 sm:gap-8 sm:text-[12px] dark:text-stone-400">
                  <span className="min-w-0 min-[430px]:w-10 min-[430px]:text-right sm:w-14">
                    <span>{fmt(m.costUsd)}</span>
                    <span className="mt-0.5 block text-[8px] text-stone-400 min-[430px]:hidden dark:text-stone-600">
                      total
                    </span>
                  </span>
                  <span className="min-w-0 min-[430px]:w-10 min-[430px]:text-right sm:w-14">
                    <span>{fmtTokens(m.totalTokens)}</span>
                    <span className="mt-0.5 block text-[8px] text-stone-400 min-[430px]:hidden dark:text-stone-600">
                      tokens
                    </span>
                  </span>
                  <span className="min-w-0 min-[430px]:w-12 min-[430px]:text-right sm:w-16">
                    <span>
                      {m.costPerMillionTokens === null
                        ? "n/a"
                        : fmt(m.costPerMillionTokens)}
                    </span>
                    <span className="mt-0.5 block text-[8px] text-stone-400 min-[430px]:hidden dark:text-stone-600">
                      /mtok
                    </span>
                  </span>
                  <span className="min-w-0 min-[430px]:w-10 min-[430px]:text-right sm:w-12">
                    <span>{(m.share * 100).toFixed(1)}%</span>
                    <span className="mt-0.5 block text-[8px] text-stone-400 min-[430px]:hidden dark:text-stone-600">
                      share
                    </span>
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

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 border-b border-stone-300/70 pb-1 dark:border-stone-800">
      <span className="text-stone-400 dark:text-stone-600">{label}</span>
      <span className="text-stone-700 dark:text-stone-300">{value}</span>
    </div>
  )
}

function Stat({
  label,
  value,
  sub,
}: {
  label: string
  value: string
  sub?: string
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span
        className="text-base tracking-tight text-stone-800 min-[380px]:text-lg sm:text-xl dark:text-stone-100"
        style={{ fontFamily: "var(--font-display)" }}
      >
        {value}
      </span>
      <span className="font-mono text-[8px] text-stone-400 min-[380px]:text-[9px] sm:text-[10px] dark:text-stone-600">
        {label}
        {sub ? ` · ${sub}` : ""}
      </span>
    </div>
  )
}
