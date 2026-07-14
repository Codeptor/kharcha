"use client"

import { useMemo } from "react"
import type { HourBucket } from "@/lib/dashboard/chart-shape"

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

function logRatio(value: number, max: number): number {
  if (value <= 0 || max <= 0) return 0
  return Math.log10(value + 1) / Math.log10(max + 1)
}

function cellColor(ratio: number): string {
  if (ratio <= 0) return "var(--hm-empty)"
  return `color-mix(in oklch, var(--hm-from), var(--hm-to) ${(ratio * 100).toFixed(1)}%)`
}

function formatHour(h: number): string {
  if (h === 0) return "12am"
  if (h === 12) return "12pm"
  if (h < 12) return `${h}am`
  return `${h - 12}pm`
}

export function HourHeatmap({
  buckets,
  fmt,
}: {
  buckets: HourBucket[]
  fmt: (n: number) => string
}) {
  const { matrix, max, peak } = useMemo(() => {
    const m: number[][] = Array.from({ length: 7 }, () =>
      new Array<number>(24).fill(0)
    )
    let mx = 0
    let pk: { dayOfWeek: number; hour: number; costUsd: number } | null = null
    for (const b of buckets) {
      if (b.dayOfWeek < 0 || b.dayOfWeek > 6 || b.hour < 0 || b.hour > 23)
        continue
      m[b.dayOfWeek]![b.hour] = b.costUsd
      if (b.costUsd > mx) {
        mx = b.costUsd
        pk = b
      }
    }
    return { matrix: m, max: mx, peak: pk }
  }, [buckets])

  if (max === 0) {
    return (
      <div className="font-mono text-[10px] text-stone-400 dark:text-stone-600">
        no time-of-day data yet
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2 font-mono text-[9px] text-stone-500 [--hm-bg:rgb(237_232_225)] [--hm-empty:rgb(220_215_207)] [--hm-from:rgb(255_237_213)] [--hm-to:rgb(124_45_18)] dark:text-stone-500 dark:[--hm-bg:rgb(12_10_9)] dark:[--hm-empty:rgb(41_37_36)] dark:[--hm-from:rgb(67_20_7)] dark:[--hm-to:rgb(253_186_116)]">
      {/* Hour ruler */}
      <div className="grid grid-cols-[2rem_minmax(0,1fr)] items-end gap-x-1">
        <span />
        <div className="grid grid-cols-[repeat(24,minmax(0,1fr))] gap-[2px] sm:gap-[3px]">
          {Array.from({ length: 24 }, (_, h) => (
            <div
              key={h}
              className="min-w-0 text-center text-[7px] text-stone-400 sm:text-[8px] dark:text-stone-600"
            >
              <span className="sm:hidden">
                {h % 6 === 0 ? formatHour(h) : ""}
              </span>
              <span className="hidden sm:inline">
                {h % 3 === 0 ? formatHour(h) : ""}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Grid */}
      <div className="flex flex-col gap-[2px] sm:gap-[3px]">
        {matrix.map((row, dow) => (
          <div
            key={dow}
            className="grid grid-cols-[2rem_minmax(0,1fr)] items-center gap-x-1"
          >
            <span className="pr-1 text-right text-[9px] text-stone-400 dark:text-stone-600">
              {DAY_LABELS[dow]}
            </span>
            <div className="grid grid-cols-[repeat(24,minmax(0,1fr))] gap-[2px] sm:gap-[3px]">
              {row.map((cost, hour) => {
                const ratio = logRatio(cost, max)
                return (
                  <span
                    key={hour}
                    className="aspect-square min-w-0 rounded-[2px] transition-transform duration-150 hover:z-10 hover:scale-[1.35] hover:shadow-[0_2px_8px_rgba(180,83,9,0.35)] sm:rounded-[3px]"
                    style={{ backgroundColor: cellColor(ratio) }}
                    title={
                      cost > 0
                        ? `${DAY_LABELS[dow]} ${formatHour(hour)} · ${fmt(cost)}`
                        : `${DAY_LABELS[dow]} ${formatHour(hour)} · idle`
                    }
                  />
                )
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-1.5 pt-1 pl-9 text-[9px] text-stone-400 dark:text-stone-600">
        <span>cooler</span>
        <div className="flex gap-[3px]">
          {[0, 0.25, 0.5, 0.75, 1].map((r, i) => (
            <span
              key={i}
              className="h-[10px] w-[10px] rounded-[2px]"
              style={{ backgroundColor: cellColor(r) }}
            />
          ))}
        </div>
        <span>busier</span>
        {peak && (
          <span className="text-stone-500 min-[480px]:ml-auto dark:text-stone-500">
            peak {DAY_LABELS[peak.dayOfWeek]} {formatHour(peak.hour)} ·{" "}
            {fmt(peak.costUsd)}
          </span>
        )}
      </div>
    </div>
  )
}
