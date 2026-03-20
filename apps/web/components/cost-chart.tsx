"use client"

import { useState, useMemo } from "react"

type ChartSegment = {
  key: string
  label: string
  costUsd: number
}

type ChartDay = {
  day: string
  total: number
  segments: ChartSegment[]
}

const MAX_HEIGHT = 300

function formatDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`)
  if (isNaN(d.getTime())) return iso
  const month = d.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" })
  const day = d.getUTCDate()
  const suffix =
    day === 1 || day === 21 || day === 31
      ? "st"
      : day === 2 || day === 22
        ? "nd"
        : day === 3 || day === 23
          ? "rd"
          : "th"
  return `${month} ${day}${suffix}`
}

function displayName(label: string): string {
  const slash = label.lastIndexOf(" / ")
  const raw = slash >= 0 ? label.slice(slash + 3) : label
  return raw
    .replace(/^claude-/, "")
    .replace(/^gpt-/, "GPT ")
    .split("-")
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(" ")
    .replace(/(\d) (\d)/g, "$1.$2")
}

function fillGaps(days: ChartDay[]): ChartDay[] {
  if (days.length <= 1) return days
  const map = new Map(days.map((d) => [d.day, d]))
  const start = new Date(`${days[0]!.day}T00:00:00Z`)
  const end = new Date(`${days[days.length - 1]!.day}T00:00:00Z`)
  const result: ChartDay[] = []
  const cur = new Date(start)
  while (cur <= end) {
    const iso = cur.toISOString().slice(0, 10)
    result.push(map.get(iso) ?? { day: iso, total: 0, segments: [] })
    cur.setUTCDate(cur.getUTCDate() + 1)
  }
  return result
}

export function CostChart({ days: rawDays }: { days: ChartDay[] }) {
  const days = useMemo(() => fillGaps(rawDays), [rawDays])
  const [hovered, setHovered] = useState<number | null>(null)
  const maxCost = useMemo(
    () => Math.max(...days.map((d) => d.total), 0.01),
    [days],
  )
  const activeIndex = hovered ?? days.length - 1

  if (days.length === 0) {
    return (
      <p className="font-mono text-xs text-stone-500 dark:text-stone-400">
        No usage data synced yet.
      </p>
    )
  }

  return (
    <div
      className="relative flex items-end"
      style={{ gap: 10 }}
      onMouseLeave={() => setHovered(null)}
    >
      {days.map((day, i) => {
        const dimmed = hovered !== null && hovered !== i
        const active = i === activeIndex
        const sorted = [...day.segments].sort(
          (a, b) => b.costUsd - a.costUsd,
        )

        return (
          <div
            key={day.day}
            className="relative flex flex-col gap-0.5 select-none"
            style={{ width: 1 }}
            onMouseEnter={() => setHovered(i)}
          >
            {day.total <= 0 ? (
              <div
                className={`h-1 w-full rounded-none ${
                  dimmed
                    ? "bg-stone-400 dark:bg-stone-500"
                    : "bg-stone-300 dark:bg-stone-600"
                }`}
              />
            ) : (
              sorted.map((seg) => (
                <div
                  key={seg.key}
                  className={`w-full rounded-none ${
                    dimmed
                      ? "bg-stone-400 dark:bg-stone-500"
                      : "bg-stone-900 dark:bg-stone-100"
                  }`}
                  style={{
                    height: Math.max(
                      1,
                      (seg.costUsd / maxCost) * MAX_HEIGHT,
                    ),
                  }}
                />
              ))
            )}

            {active && (
              <div className="pointer-events-none absolute left-1/2 top-full mt-3 -translate-x-1/2 select-none">
                <div className="whitespace-nowrap text-center font-mono text-[13px] text-stone-500 dark:text-stone-400">
                  {formatDate(day.day)}
                </div>
                {hovered === i && sorted.filter((s) => s.costUsd >= 0.01).length > 0 && (
                  <div className="mt-2.5 flex flex-col gap-1.5">
                    {sorted
                      .filter((s) => s.costUsd >= 0.01)
                      .map((seg) => (
                        <div
                          key={seg.key}
                          className="flex items-center gap-2 whitespace-nowrap"
                        >
                          <span className="font-mono text-[13px] text-stone-700 dark:text-stone-300">
                            {displayName(seg.label)}
                          </span>
                          <span className="font-mono text-[13px] text-stone-500 dark:text-stone-400">
                            {`$${seg.costUsd.toFixed(2)}`}
                          </span>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
