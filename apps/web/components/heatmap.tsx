"use client"

import { useMemo } from "react"
import type { DashboardData } from "@/lib/dashboard/chart-shape"

type Cell = { day: string; total: number; bucket: number } | null

const WEEKDAYS = ["Mon", "Wed", "Fri"]

function intensityBucket(value: number, max: number): number {
  if (value <= 0 || max <= 0) return 0
  const ratio = Math.log10(value + 1) / Math.log10(max + 1)
  if (ratio < 0.25) return 1
  if (ratio < 0.5) return 2
  if (ratio < 0.75) return 3
  return 4
}

const BUCKET_CLASSES: Record<number, string> = {
  0: "bg-stone-200 dark:bg-stone-900",
  1: "bg-stone-400/40 dark:bg-stone-700/50",
  2: "bg-stone-500/60 dark:bg-stone-600/70",
  3: "bg-stone-700 dark:bg-stone-400",
  4: "bg-stone-900 dark:bg-stone-100",
}

function monthLabel(iso: string): string | null {
  const d = new Date(`${iso}T00:00:00Z`)
  if (d.getUTCDate() > 7) return null
  return d.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" })
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
    if (days.length === 0) {
      return { grid: [] as Cell[][], maxCost: 0 }
    }

    const first = new Date(`${days[0]!.day}T00:00:00Z`)
    const last = new Date(`${days[days.length - 1]!.day}T00:00:00Z`)

    const startDow = (first.getUTCDay() + 6) % 7
    const padStart = new Date(first)
    padStart.setUTCDate(padStart.getUTCDate() - startDow)

    const endDow = (last.getUTCDay() + 6) % 7
    const padEnd = new Date(last)
    padEnd.setUTCDate(padEnd.getUTCDate() + (6 - endDow))

    const byDay = new Map(days.map((d, i) => [d.day, { ...d, idx: i }]))
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
        week.push({
          day: iso,
          total: info?.total ?? 0,
          bucket: intensityBucket(info?.total ?? 0, max),
        })
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

  return (
    <div className="flex flex-col gap-1.5 font-mono text-[9px] text-stone-400 dark:text-stone-600">
      <div className="flex gap-0.5 pl-7">
        {grid.map((week, wi) => {
          const firstReal = week.find((c): c is NonNullable<Cell> => c !== null)
          const label = firstReal ? monthLabel(firstReal.day) : null
          return (
            <div key={wi} className="w-[10px] text-center sm:w-[12px]">
              {label}
            </div>
          )
        })}
      </div>
      <div className="flex gap-1">
        <div className="flex w-5 flex-col justify-between py-[1px] pr-1 text-right">
          {WEEKDAYS.map((d) => (
            <span key={d} className="leading-[10px] sm:leading-[12px]">
              {d}
            </span>
          ))}
        </div>
        <div className="flex gap-0.5">
          {grid.map((week, wi) => (
            <div key={wi} className="flex flex-col gap-0.5">
              {week.map((cell, di) => {
                if (!cell) {
                  return (
                    <div
                      key={di}
                      className="h-[10px] w-[10px] sm:h-[12px] sm:w-[12px]"
                    />
                  )
                }
                const idx = cellIdxMap.get(cell.day) ?? -1
                const isActive = activeIndex === idx
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
                    className={`h-[10px] w-[10px] cursor-pointer transition-[outline-color,filter] duration-100 sm:h-[12px] sm:w-[12px] ${BUCKET_CLASSES[cell.bucket]} ${
                      isActive
                        ? "outline outline-1 outline-amber-500 dark:outline-amber-400"
                        : "outline-transparent"
                    }`}
                    title={`${cell.day} · ${fmt(cell.total)}`}
                  />
                )
              })}
            </div>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-1.5 pt-1 pl-7">
        <span>less</span>
        {[0, 1, 2, 3, 4].map((b) => (
          <span key={b} className={`h-[10px] w-[10px] ${BUCKET_CLASSES[b]}`} />
        ))}
        <span>more</span>
        <span className="ml-auto">peak {fmt(maxCost)}</span>
      </div>
    </div>
  )
}
