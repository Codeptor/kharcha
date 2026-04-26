"use client"

import { useMemo } from "react"
import type { DashboardData } from "@/lib/dashboard/chart-shape"

type Cell = { day: string; total: number; ratio: number } | null

const WEEKDAYS = ["Mon", "Wed", "Fri"]

function logRatio(value: number, max: number): number {
  if (value <= 0 || max <= 0) return 0
  return Math.log10(value + 1) / Math.log10(max + 1)
}

function bucketThreshold(ratio: number, max: number): number {
  return Math.pow(10, ratio * Math.log10(max + 1)) - 1
}

function monthLabel(iso: string): string | null {
  const d = new Date(`${iso}T00:00:00Z`)
  if (d.getUTCDate() > 7) return null
  return d.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" })
}

function isoMonth(iso: string): string {
  return iso.slice(0, 7)
}

function todayIso(): string {
  const d = new Date()
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`
}

function todayIsoMonth(): string {
  return todayIso().slice(0, 7)
}

function cellColor(ratio: number): string {
  if (ratio <= 0) return "var(--hm-empty)"
  const pct = (ratio * 100).toFixed(1)
  return `color-mix(in oklch, var(--hm-from), var(--hm-to) ${pct}%)`
}

export function Heatmap({
  days,
  activeIndex,
  onHover,
  onClick,
  fmt,
}: {
  days: DashboardData["days"]
  activeIndex: number | null
  onHover: (idx: number | null) => void
  onClick: (idx: number) => void
  fmt: (n: number) => string
}) {
  const { grid, maxCost } = useMemo(() => {
    if (days.length === 0) return { grid: [] as Cell[][], maxCost: 0 }

    const first = new Date(`${days[0]!.day}T00:00:00Z`)
    const last = new Date(`${days[days.length - 1]!.day}T00:00:00Z`)
    const startDow = (first.getUTCDay() + 6) % 7
    const padStart = new Date(first)
    padStart.setUTCDate(padStart.getUTCDate() - startDow)
    const endDow = (last.getUTCDay() + 6) % 7
    const padEnd = new Date(last)
    padEnd.setUTCDate(padEnd.getUTCDate() + (6 - endDow))

    const byDay = new Map(days.map((d) => [d.day, d]))
    const max = days.reduce((m, d) => Math.max(m, d.total), 0)

    const weeks: Cell[][] = []
    let week: Cell[] = []
    const cur = new Date(padStart)

    while (cur <= padEnd) {
      const iso = cur.toISOString().slice(0, 10)
      const inRange = cur >= first && cur <= last
      if (!inRange) {
        week.push(null)
      } else {
        const info = byDay.get(iso)
        const total = info?.total ?? 0
        week.push({ day: iso, total, ratio: logRatio(total, max) })
      }
      if (week.length === 7) {
        weeks.push(week)
        week = []
      }
      cur.setUTCDate(cur.getUTCDate() + 1)
    }
    if (week.length > 0) weeks.push(week)

    return { grid: weeks, maxCost: max }
  }, [days])

  if (grid.length === 0) return null

  const cellIdxMap = new Map(days.map((d, i) => [d.day, i]))
  const today = todayIso()
  const currentMonth = todayIsoMonth()

  return (
    <div
      className="heatmap-root flex flex-col gap-2 font-mono text-[9px] text-stone-500 [--hm-bg:rgb(237_232_225)] [--hm-empty:rgb(220_215_207)] [--hm-from:rgb(255_237_213)] [--hm-to:rgb(124_45_18)] dark:text-stone-500 dark:[--hm-bg:rgb(12_10_9)] dark:[--hm-empty:rgb(41_37_36)] dark:[--hm-from:rgb(67_20_7)] dark:[--hm-to:rgb(253_186_116)]"
    >
      {/* Month labels row */}
      <div className="flex gap-[3px] pl-7">
        {grid.map((week, wi) => {
          const firstReal = week.find((c): c is NonNullable<Cell> => c !== null)
          const label = firstReal ? monthLabel(firstReal.day) : null
          const isCurrent =
            firstReal !== undefined && isoMonth(firstReal.day) === currentMonth
          return (
            <div
              key={wi}
              className={`w-[12px] text-center text-[9px] tracking-tight transition-colors sm:w-[13px] ${
                isCurrent
                  ? "font-semibold text-amber-700 dark:text-amber-400"
                  : "text-stone-400 dark:text-stone-600"
              }`}
            >
              {label}
            </div>
          )
        })}
      </div>

      {/* Grid */}
      <div className="flex gap-1.5">
        <div className="flex w-5 flex-col justify-between py-[1px] pr-1 text-right text-[9px] text-stone-400 dark:text-stone-600">
          {WEEKDAYS.map((d) => (
            <span key={d} className="leading-[12px]">
              {d}
            </span>
          ))}
        </div>
        <div className="flex gap-[3px]">
          {grid.map((week, wi) => (
            <div key={wi} className="flex flex-col gap-[3px]">
              {week.map((cell, di) => {
                if (!cell) {
                  return (
                    <div
                      key={di}
                      className="h-[12px] w-[12px] sm:h-[13px] sm:w-[13px]"
                    />
                  )
                }
                const idx = cellIdxMap.get(cell.day) ?? -1
                const isActive = activeIndex === idx
                const isToday = cell.day === today
                return (
                  <button
                    key={di}
                    type="button"
                    onMouseEnter={() => onHover(idx)}
                    onMouseLeave={() => onHover(null)}
                    onClick={(e) => {
                      e.stopPropagation()
                      onClick(idx)
                    }}
                    aria-label={`${cell.day} ${fmt(cell.total)}`}
                    className={`relative h-[12px] w-[12px] cursor-pointer rounded-[3px] transition-[transform,box-shadow,filter] duration-150 ease-out hover:z-10 hover:scale-[1.35] hover:shadow-[0_2px_8px_rgba(180,83,9,0.35)] focus-visible:scale-[1.35] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-amber-500 sm:h-[13px] sm:w-[13px] ${
                      isActive
                        ? "scale-[1.35] shadow-[0_2px_10px_rgba(180,83,9,0.45)] dark:shadow-[0_2px_10px_rgba(252,211,77,0.45)]"
                        : ""
                    } ${
                      isToday && !isActive
                        ? "ring-1 ring-amber-500/60 ring-offset-1 ring-offset-stone-100 dark:ring-amber-400/60 dark:ring-offset-stone-950"
                        : ""
                    }`}
                    style={{ backgroundColor: cellColor(cell.ratio) }}
                    title={`${cell.day} · ${fmt(cell.total)}`}
                  />
                )
              })}
            </div>
          ))}
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-1.5 pt-1 pl-7 text-[9px] text-stone-400 dark:text-stone-600">
        <span>less</span>
        <div className="flex gap-[3px]">
          {[0, 0.25, 0.5, 0.75, 1].map((r, i) => {
            const lower =
              r === 0 ? 0 : bucketThreshold(r - 0.25, maxCost)
            const upper = bucketThreshold(r, maxCost)
            const range =
              r === 0
                ? "no spend"
                : r === 1
                  ? `≥ ${fmt(lower)}`
                  : `${fmt(lower)} – ${fmt(upper)}`
            return (
              <span
                key={i}
                className="h-[10px] w-[10px] rounded-[2px]"
                style={{ backgroundColor: cellColor(r) }}
                title={range}
              />
            )
          })}
        </div>
        <span>more</span>
        <span className="ml-auto text-stone-500 dark:text-stone-500">
          peak {fmt(maxCost)}
        </span>
      </div>
    </div>
  )
}
