"use client"

import { useState, useMemo, useCallback, useRef, useEffect, type MouseEvent as RMouseEvent } from "react"
import { useTheme } from "next-themes"
import type { DashboardData } from "@/lib/dashboard/chart-shape"
import { computeStreaks, computeModelStats } from "@/lib/dashboard/stats"
import { ProviderIcon } from "./provider-icon"
import { Heatmap } from "./heatmap"
import { StatsPanel } from "./stats-panel"
import { Volume2, VolumeOff } from "lucide-react"
import {
  tickSound,
  selectSound,
  deselectSound,
  syncStartSound,
  syncDoneSound,
  toggleSound,
  enterSound,
  exitSound,
  bootSound,
} from "@/lib/sounds"
import {
  tickVibrate,
  selectVibrate,
  deselectVibrate,
  syncVibrate,
  toggleVibrate,
} from "@/lib/haptics"

type Range = "7d" | "30d" | "all"
type View = "bars" | "heatmap" | "stats"

function fmt(v: number) {
  if (v >= 1000) return `$${(v / 1000).toFixed(1)}k`
  return `$${v.toFixed(2)}`
}

function fmtFull(v: number) {
  return `$${v.toFixed(2)}`
}

function fmtDate(iso: string) {
  const d = new Date(`${iso}T00:00:00Z`)
  if (isNaN(d.getTime())) return iso
  const month = d.toLocaleDateString("en-US", {
    month: "short",
    timeZone: "UTC",
  })
  const day = d.getUTCDate()
  const s =
    day === 1 || day === 21 || day === 31
      ? "st"
      : day === 2 || day === 22
        ? "nd"
        : day === 3 || day === 23
          ? "rd"
          : "th"
  return `${month} ${day}${s}`
}

function displayModel(label: string) {
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
    .replace(/\s+Preview\s*$/i, "")
    .replace(/\s+Customtools\s*$/i, "")
}

function providerFromKey(key: string): string {
  return key.split(":")[0] ?? ""
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

function fillGaps(days: DashboardData["days"]): DashboardData["days"] {
  if (days.length <= 1) return days
  const map = new Map(days.map((d) => [d.day, d]))
  const start = new Date(`${days[0]!.day}T00:00:00Z`)
  const end = new Date(`${days[days.length - 1]!.day}T00:00:00Z`)
  const result: DashboardData["days"] = []
  const cur = new Date(start)
  while (cur <= end) {
    const iso = cur.toISOString().slice(0, 10)
    result.push(map.get(iso) ?? { day: iso, total: 0, segments: [] })
    cur.setUTCDate(cur.getUTCDate() + 1)
  }
  return result
}

function filterByRange(
  days: DashboardData["days"],
  range: Range,
): DashboardData["days"] {
  if (range === "all") return days
  const n = range === "7d" ? 7 : 30
  const cutoff = new Date()
  cutoff.setUTCDate(cutoff.getUTCDate() - n)
  const cutoffStr = cutoff.toISOString().slice(0, 10)
  return days.filter((d) => d.day >= cutoffStr)
}

const MAX_HEIGHT = 300
const MOBILE_MAX_HEIGHT = 200

export function Dashboard({
  data,
  syncAction,
}: {
  data: DashboardData
  syncAction: () => Promise<void>
}) {
  const [range, setRange] = useState<Range>("all")
  const [view, setView] = useState<View>("bars")
  const [hovered, setHovered] = useState<number | null>(null)
  const [locked, setLocked] = useState<number | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState<string | null>(null)
  const [muted, setMuted] = useState(false)
  const [selectedModels, setSelectedModels] = useState<Set<string>>(new Set())
  const barsRef = useRef<HTMLDivElement>(null)
  const { resolvedTheme, setTheme } = useTheme()
  const sfx = useCallback(<T extends unknown[]>(fn: (...args: T) => void, ...args: T) => {
    if (!muted) fn(...args)
  }, [muted])

  const allDays = useMemo(() => fillGaps(data.days), [data.days])
  const rangedDays = useMemo(
    () => filterByRange(allDays, range),
    [allDays, range],
  )
  const filteredDays = useMemo(() => {
    if (selectedModels.size === 0) return rangedDays
    return rangedDays.map((d) => {
      const segments = d.segments.filter((s) => selectedModels.has(s.key))
      const total = segments.reduce((s, seg) => s + seg.costUsd, 0)
      return { ...d, segments, total }
    })
  }, [rangedDays, selectedModels])
  const maxCost = useMemo(
    () => Math.max(...filteredDays.map((d) => d.total), 0.01),
    [filteredDays],
  )
  const rangeTotal = useMemo(
    () => filteredDays.reduce((s, d) => s + d.total, 0),
    [filteredDays],
  )
  const streaks = useMemo(() => computeStreaks(filteredDays), [filteredDays])
  const modelStats = useMemo(() => computeModelStats(rangedDays), [rangedDays])

  const toggleModel = useCallback((key: string) => {
    setSelectedModels((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
    setLocked(null)
    setHovered(null)
  }, [])

  const providers = useMemo(() => {
    const map = new Map<string, number>()
    for (const day of filteredDays) {
      for (const seg of day.segments) {
        const p = seg.key.split(":")[0]!
        map.set(p, (map.get(p) ?? 0) + seg.costUsd)
      }
    }
    return [...map.entries()]
      .map(([provider, costUsd]) => ({ provider, costUsd }))
      .filter((p) => p.costUsd >= 0.01)
      .sort((a, b) => b.costUsd - a.costUsd)
  }, [filteredDays])

  const peakIndex = useMemo(() => {
    let max = 0
    let idx = -1
    for (let i = 0; i < filteredDays.length; i++) {
      if (filteredDays[i]!.total > max) {
        max = filteredDays[i]!.total
        idx = i
      }
    }
    return idx
  }, [filteredDays])

  const activeDays = useMemo(
    () => filteredDays.filter((d) => d.total > 0).length,
    [filteredDays],
  )

  const costPerHour = useMemo(
    () => (activeDays > 0 ? rangeTotal / activeDays / 8 : 0),
    [rangeTotal, activeDays],
  )

  const uniqueModels = useMemo(() => {
    const s = new Set<string>()
    for (const day of filteredDays)
      for (const seg of day.segments) if (seg.costUsd > 0) s.add(seg.key)
    return s.size
  }, [filteredDays])

  const uniqueSources = useMemo(() => {
    const s = new Set<string>()
    for (const day of filteredDays)
      for (const seg of day.segments) s.add(seg.source)
    return s.size
  }, [filteredDays])

  const activeIndex = locked ?? hovered
  const activeDay = activeIndex !== null ? filteredDays[activeIndex] : null

  const sorted = useMemo(() => {
    if (!activeDay) return []
    return [...activeDay.segments]
      .sort((a, b) => b.costUsd - a.costUsd)
      .filter((s) => s.costUsd >= 0.01)
      .slice(0, 6)
  }, [activeDay])

  const resolveIndex = useCallback(
    (clientX: number) => {
      const container = barsRef.current
      if (!container || filteredDays.length === 0) return null
      const rect = container.getBoundingClientRect()
      const x = clientX - rect.left
      const ratio = Math.max(0, Math.min(1, x / rect.width))
      return Math.min(
        Math.floor(ratio * filteredDays.length),
        filteredDays.length - 1,
      )
    },
    [filteredDays.length],
  )

  const handleChartMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (locked !== null) return
      const idx = resolveIndex(e.clientX)
      if (idx === null || idx === hovered) return
      const day = filteredDays[idx]
      sfx(tickSound, day ? Math.min(day.total / maxCost, 1) : 0)
      tickVibrate()
      setHovered(idx)
    },
    [locked, hovered, filteredDays, maxCost, resolveIndex],
  )

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      const touch = e.touches[0]
      if (!touch) return
      const idx = resolveIndex(touch.clientX)
      if (idx === null || idx === (locked ?? hovered)) return
      const day = filteredDays[idx]
      sfx(tickSound, day ? Math.min(day.total / maxCost, 1) : 0)
      tickVibrate()
      if (locked !== null) setLocked(idx)
      else setHovered(idx)
    },
    [locked, hovered, filteredDays, maxCost, resolveIndex],
  )

  const handleChartClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      const idx = resolveIndex(e.clientX)
      if (idx === null) return
      const isDeselect = locked === idx
      isDeselect ? sfx(deselectSound) : sfx(selectSound)
      isDeselect ? deselectVibrate() : selectVibrate()
      setLocked(isDeselect ? null : idx)
    },
    [locked, resolveIndex],
  )

  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      e.stopPropagation()
      const touch = e.touches[0]
      if (!touch) return
      const idx = resolveIndex(touch.clientX)
      if (idx === null) return
      sfx(selectSound)
      selectVibrate()
      setLocked(idx)
    },
    [resolveIndex],
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        setLocked(null)
        setHovered(null)
        return
      }
      const idx = locked ?? hovered
      if (idx === null) return
      if (e.key === "ArrowLeft" && idx > 0) {
        setLocked(idx - 1)
        e.preventDefault()
      }
      if (e.key === "ArrowRight" && idx < filteredDays.length - 1) {
        setLocked(idx + 1)
        e.preventDefault()
      }
    },
    [locked, hovered, filteredDays.length],
  )

  async function handleSync() {
    if (syncing) return
    sfx(syncStartSound)
    syncVibrate()
    setSyncing(true)
    setSyncMsg(null)
    try {
      await syncAction()
      sfx(syncDoneSound)
      setSyncMsg("synced")
      setTimeout(() => window.location.reload(), 800)
    } catch (err) {
      setSyncMsg(err instanceof Error ? err.message : "failed")
    } finally {
      setSyncing(false)
    }
  }

  const [isMobile, setIsMobile] = useState(false)
  const [syncedLabel, setSyncedLabel] = useState<string | null>(null)
  useEffect(() => {
    setIsMobile(window.innerWidth < 640)
  }, [])
  useEffect(() => {
    if (!data.lastSynced) return
    const update = () => setSyncedLabel(timeAgo(data.lastSynced!))
    update()
    const id = setInterval(update, 60_000)
    return () => clearInterval(id)
  }, [data.lastSynced])
  const barGap = isMobile ? 4 : 10
  const chartHeight = isMobile ? MOBILE_MAX_HEIGHT : MAX_HEIGHT

  if (data.days.length === 0) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-[#ede8e1] px-6 dark:bg-stone-950">
        <div className="max-w-sm space-y-3 text-center">
          <p className="font-mono text-sm text-stone-700 dark:text-stone-300">
            No usage data synced yet
          </p>
          <p className="font-mono text-xs text-stone-500 dark:text-stone-400">
            Run{" "}
            <code className="bg-stone-200 px-1.5 py-0.5 dark:bg-stone-800">
              bun run sync
            </code>{" "}
            or{" "}
            <button
              onClick={handleSync}
              disabled={syncing}
              className="underline underline-offset-2 hover:text-stone-700 dark:hover:text-stone-300"
            >
              {syncing ? (
                <span className="animate-pulse">syncing</span>
              ) : (
                "sync now"
              )}
            </button>
          </p>
        </div>
      </div>
    )
  }

  return (
    <div
      className="relative flex min-h-svh flex-col bg-[#ede8e1] dark:bg-stone-950"
      onKeyDown={handleKeyDown}
      onPointerDown={() => {
        sfx(bootSound)
        if (locked !== null) {
          deselectVibrate()
          setLocked(null)
          setHovered(null)
        }
      }}
      tabIndex={0}
    >
      {/* Header */}
      <header className="fixed inset-x-0 top-0 z-50 px-4 pt-4 pb-2 sm:px-6 sm:pt-[30px] sm:pb-3 animate-in fade-in slide-in-from-top-2 duration-500 fill-mode-both">
        <div className="mx-auto flex max-w-[1178px] items-center justify-between">
          {/* Range + view pills */}
          <div className="flex items-center gap-3 sm:gap-4">
            <div className="flex gap-1.5 sm:gap-2">
              {(["7d", "30d", "all"] as const).map((r) => (
                <button
                  key={r}
                  onClick={(e) => {
                    e.stopPropagation()
                    toggleVibrate()
                    setRange(r)
                    setLocked(null)
                    setHovered(null)
                  }}
                  className={`font-mono text-[11px] px-1 transition-colors duration-200 ${
                    range === r
                      ? "text-stone-800 dark:text-stone-100"
                      : "text-stone-400 hover:text-stone-600 dark:text-stone-600 dark:hover:text-stone-400"
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>
            <span className="hidden text-stone-300 sm:inline dark:text-stone-700">
              ·
            </span>
            <div className="flex gap-1.5 sm:gap-2">
              {(["bars", "heatmap", "stats"] as const).map((v) => (
                <button
                  key={v}
                  onClick={(e) => {
                    e.stopPropagation()
                    toggleVibrate()
                    setView(v)
                    setLocked(null)
                    setHovered(null)
                  }}
                  className={`font-mono text-[11px] px-1 transition-colors duration-200 ${
                    view === v
                      ? "text-stone-800 dark:text-stone-100"
                      : "text-stone-400 hover:text-stone-600 dark:text-stone-600 dark:hover:text-stone-400"
                  }`}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>

          {/* Center: sync status */}
          {data.lastSynced && (
            <span className="hidden font-mono text-[10px] text-stone-400 sm:inline dark:text-stone-600">
              synced {syncedLabel ?? " "}
            </span>
          )}

          <div className="flex items-center gap-2 sm:gap-3">
            <button
              onClick={(e) => {
                e.stopPropagation()
                setMuted((m) => !m)
              }}
              className="font-mono text-[10px] text-stone-400 transition-colors hover:text-stone-600 dark:text-stone-600 dark:hover:text-stone-400"
              title={muted ? "unmute" : "mute"}
            >
              {muted ? <VolumeOff size={12} /> : <Volume2 size={12} />}
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation()
                toggleVibrate()
                setTheme(resolvedTheme === "dark" ? "light" : "dark")
              }}
              className="font-mono text-[10px] text-stone-400 transition-colors hover:text-stone-600 dark:text-stone-600 dark:hover:text-stone-400"
            >
              {resolvedTheme === "dark" ? "light" : "dark"}
            </button>
            <div className="text-right">
              <div
                className="text-sm tracking-tight text-stone-800 dark:text-stone-100"
                style={{ fontFamily: "var(--font-display)" }}
              >
                {fmtFull(rangeTotal)}
              </div>
              {costPerHour > 0 && (
                <div className="font-mono text-[9px] text-stone-400 dark:text-stone-600">
                  ~{fmt(costPerHour)}/hr
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Main content */}
      <div className="flex flex-1 flex-col items-center justify-center px-4 pt-16 pb-20 sm:px-8 sm:pt-0 sm:pb-0 lg:px-24">
        {/* Meta line */}
        <div
          className="mb-6 flex gap-3 font-mono text-[10px] text-stone-400 sm:mb-10 sm:gap-4 sm:text-[11px] dark:text-stone-600 animate-in fade-in duration-700 fill-mode-both"
          style={{ animationDelay: "200ms" }}
        >
          <span>
            {filteredDays.filter((d) => d.total > 0).length} days
          </span>
          <span className="text-stone-300 dark:text-stone-700">·</span>
          <span>{uniqueSources} sources</span>
          <span className="text-stone-300 dark:text-stone-700">·</span>
          <span>{uniqueModels} models</span>
        </div>

        {/* Chart area */}
        {view === "stats" ? (
          <div className="w-full max-w-[700px]">
            <StatsPanel
              streaks={streaks}
              modelStats={modelStats}
              onSelectModel={(k) => {
                sfx(selectSound)
                selectVibrate()
                toggleModel(k)
              }}
              selectedModels={selectedModels}
            />
          </div>
        ) : view === "heatmap" ? (
          <div className="w-full max-w-[920px] overflow-x-auto">
            <Heatmap
              days={filteredDays}
              activeIndex={activeIndex}
              onHover={(idx) => {
                if (locked !== null) return
                setHovered(idx)
              }}
              onClick={(idx) => {
                const isDeselect = locked === idx
                isDeselect ? sfx(deselectSound) : sfx(selectSound)
                isDeselect ? deselectVibrate() : selectVibrate()
                setLocked(isDeselect ? null : idx)
              }}
              fmt={fmt}
            />
          </div>
        ) : (
        <div
          className="relative cursor-default touch-none"
          onMouseEnter={() => sfx(enterSound)}
          onMouseMove={handleChartMouseMove}
          onClick={handleChartClick}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onMouseLeave={() => {
            if (locked === null) {
              sfx(exitSound)
              setHovered(null)
            }
          }}
        >
          <div
            ref={barsRef}
            className="relative mx-auto flex w-fit items-end animate-in fade-in slide-in-from-bottom-4 duration-700 fill-mode-both"
            style={{ gap: barGap, animationDelay: "400ms" }}
          >
            {filteredDays.map((day, i) => {
              const dimmed =
                (hovered !== null || locked !== null) && activeIndex !== i
              const isActive = i === activeIndex
              const isPeak = i === peakIndex && day.total > 0
              const segments = [...day.segments].sort(
                (a, b) => b.costUsd - a.costUsd,
              )

              return (
                <div
                  key={day.day}
                  className="relative flex flex-col gap-0.5 select-none animate-grow-up"
                  style={{ width: 1, animationDelay: `${450 + i * 8}ms` }}
                >
                  {day.total <= 0 ? (
                    <div
                      className={`h-1 w-full transition-colors duration-150 ${
                        dimmed
                          ? "bg-stone-300 dark:bg-stone-800"
                          : "bg-stone-400 dark:bg-stone-600"
                      }`}
                    />
                  ) : (
                    segments.map((seg) => (
                      <div
                        key={seg.key}
                        className={`w-full transition-colors duration-150 ${
                          dimmed
                            ? isPeak ? "bg-red-300 dark:bg-red-900" : "bg-stone-400 dark:bg-stone-700"
                            : isPeak ? "bg-red-500 dark:bg-red-400" : "bg-stone-900 dark:bg-stone-100"
                        }`}
                        style={{
                          height: Math.max(
                            1,
                            (seg.costUsd / maxCost) * chartHeight,
                          ),
                        }}
                      />
                    ))
                  )}

                  {isActive && (
                    <>
                      <div
                        className="pointer-events-none absolute bottom-0 left-1/2 w-[2px] -translate-x-1/2 bg-amber-500/30 dark:bg-amber-400/25"
                        style={{ height: chartHeight + 20 }}
                      />
                      <div
                        className="pointer-events-none absolute left-1/2 top-full mt-2 -translate-x-1/2 whitespace-nowrap text-center text-[11px] tracking-tight text-stone-500 select-none sm:mt-3 sm:text-[13px] dark:text-stone-400"
                        style={{ fontFamily: "var(--font-display)" }}
                      >
                        {fmtDate(day.day)}
                      </div>
                    </>
                  )}
                </div>
              )
            })}
          </div>
        </div>
        )}

        {/* Active day breakdown */}
        {view !== "stats" && (
        <div className="mt-8 h-[140px] sm:mt-10 sm:h-[180px]">
          <div
            className="flex flex-col gap-1 transition-opacity duration-200 sm:gap-1.5"
            style={{ opacity: sorted.length > 0 ? 1 : 0 }}
          >
            {sorted.map((seg, i) => (
              <div
                key={seg.key}
                className="flex items-center whitespace-nowrap animate-in fade-in slide-in-from-bottom-1"
                style={{
                  animationDelay: `${i * 30}ms`,
                  animationFillMode: "both",
                }}
              >
                <span className="inline-flex w-4 justify-center sm:w-5">
                  <ProviderIcon
                    name={providerFromKey(seg.key)}
                    size={12}
                  />
                </span>
                <span
                  className="inline-block w-28 truncate text-[11px] sm:w-44 sm:text-[13px] text-stone-700 dark:text-stone-300"
                  style={{ fontFamily: "var(--font-display)" }}
                >
                  {displayModel(seg.label)}
                </span>
                <span className="inline-block w-16 text-right font-mono text-[11px] tabular-nums sm:w-20 sm:text-[13px] text-stone-500 dark:text-stone-400">
                  {fmt(seg.costUsd)}
                </span>
                <span className="inline-flex w-5 justify-end sm:w-6">
                  <ProviderIcon name={seg.source} size={11} />
                </span>
              </div>
            ))}
          </div>
        </div>
        )}

        {/* Mobile sync status */}
        {data.lastSynced && (
          <div className="mt-2 sm:hidden">
            <span className="font-mono text-[10px] text-stone-400 dark:text-stone-600">
              synced {syncedLabel ?? " "}
            </span>
          </div>
        )}
      </div>

      {/* Footer: provider breakdown */}
      <footer
        className="fixed inset-x-0 bottom-0 px-4 pb-4 pt-2 sm:pb-6 sm:pt-3 animate-in fade-in slide-in-from-bottom-2 duration-500 fill-mode-both"
        style={{ animationDelay: "800ms" }}
      >
        <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 sm:gap-x-4">
          {providers.map((p, i) => {
            const providerModels = modelStats
              .filter((m) => m.provider === p.provider)
              .map((m) => m.key)
            const anySelected = providerModels.some((k) => selectedModels.has(k))
            return (
              <button
                key={p.provider}
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  toggleVibrate()
                  setSelectedModels((prev) => {
                    const next = new Set(prev)
                    const allSelected = providerModels.every((k) => next.has(k))
                    if (allSelected) {
                      for (const k of providerModels) next.delete(k)
                    } else {
                      for (const k of providerModels) next.add(k)
                    }
                    return next
                  })
                  setLocked(null)
                  setHovered(null)
                }}
                className={`inline-flex items-center gap-1 transition-opacity sm:gap-1.5 ${
                  selectedModels.size > 0 && !anySelected
                    ? "opacity-40 hover:opacity-70"
                    : "hover:opacity-80"
                }`}
              >
                <ProviderIcon name={p.provider} size={11} />
                <span
                  className="text-[10px] text-stone-400 sm:text-[11px] dark:text-stone-600"
                  style={{ fontFamily: "var(--font-display)" }}
                >
                  {p.provider}
                </span>
                <span className="font-mono text-[10px] text-stone-500 sm:text-[11px] dark:text-stone-500">
                  {fmt(p.costUsd)}
                </span>
                {i < providers.length - 1 && (
                  <span className="ml-1 hidden text-stone-300 sm:ml-3 sm:inline dark:text-stone-700">
                    ·
                  </span>
                )}
              </button>
            )
          })}
          {selectedModels.size > 0 && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                setSelectedModels(new Set())
              }}
              className="font-mono text-[10px] text-stone-400 underline underline-offset-2 sm:text-[11px] dark:text-stone-600"
            >
              clear filter
            </button>
          )}
        </div>
      </footer>
    </div>
  )
}
