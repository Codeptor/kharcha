"use client"
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts"

import { ChartContainer, ChartTooltip, type ChartConfig } from "@workspace/ui/components/chart"
import { cn } from "@workspace/ui/lib/utils"

import { DayBreakdownTooltip } from "./day-breakdown-tooltip"

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

const palette = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
]

function formatDayTick(value: string) {
  const date = new Date(`${value}T00:00:00Z`)

  if (Number.isNaN(date.getTime())) {
    return value
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(date)
}

function formatAxisCurrency(value: number) {
  if (value === 0) {
    return "$0"
  }

  if (value >= 1000) {
    return `$${Math.round(value / 1000)}k`
  }

  return `$${Math.round(value)}`
}

function buildSeries(days: ChartDay[]) {
  const keys = [...new Set(days.flatMap((day) => day.segments.map((segment) => segment.key)))]
  const totals = new Map<string, number>()

  for (const day of days) {
    for (const segment of day.segments) {
      totals.set(segment.key, (totals.get(segment.key) ?? 0) + segment.costUsd)
    }
  }

  keys.sort((left, right) => {
    const leftTotal = totals.get(left) ?? 0
    const rightTotal = totals.get(right) ?? 0

    if (rightTotal !== leftTotal) {
      return rightTotal - leftTotal
    }

    return left.localeCompare(right)
  })

  const config = Object.fromEntries(
    keys.map((key, index) => {
      const preview = days.flatMap((day) => day.segments).find((segment) => segment.key === key)
      const color = palette[index % palette.length]

      return [
        key,
        {
          label: preview?.label ?? key,
          color,
        },
      ]
    }),
  ) as ChartConfig

  const data = days.map((day) => {
    const row: Record<string, string | number> = {
      day: day.day,
      total: day.total,
    }

    for (const segment of day.segments) {
      row[segment.key] = segment.costUsd
    }

    return row
  })

  return { config, data, keys }
}

export function CostChart({ days }: { days: ChartDay[] }) {
  if (days.length === 0) {
    return (
      <section className="rounded-[2rem] border border-border/60 bg-card/80 p-6 shadow-[0_24px_100px_-36px_rgba(0,0,0,0.24)] backdrop-blur">
        <div className="flex min-h-[18rem] items-center justify-center rounded-[1.5rem] border border-dashed border-border/70 bg-background/60 px-6 text-center">
          <div className="space-y-2">
            <p className="text-sm font-medium">No usage synced yet</p>
            <p className="text-sm text-muted-foreground">
              Run the local sync command to populate the historical chart.
            </p>
          </div>
        </div>
      </section>
    )
  }

  const { config, data, keys } = buildSeries(days)

  return (
    <section className="overflow-hidden rounded-[2rem] border border-border/60 bg-card/80 shadow-[0_24px_100px_-36px_rgba(0,0,0,0.24)] backdrop-blur">
      <div className="border-b border-border/60 px-5 py-4 sm:px-6">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.35em] text-muted-foreground">Daily spend</p>
            <p className="text-sm text-muted-foreground">Hover any bar to inspect provider and model costs.</p>
          </div>
          <p className="text-xs uppercase tracking-[0.28em] text-muted-foreground">
            {days.length} days
          </p>
        </div>
      </div>

      <div className={cn("h-[360px] w-full px-2 py-4 sm:px-4")}>
        <ChartContainer config={config} className="h-full w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
              <CartesianGrid vertical={false} stroke="var(--border)" strokeOpacity={0.5} />
              <XAxis
                dataKey="day"
                tickFormatter={formatDayTick}
                tickLine={false}
                axisLine={false}
                minTickGap={24}
                tickMargin={12}
                style={{ fontSize: 12 }}
              />
              <YAxis
                tickFormatter={formatAxisCurrency}
                tickLine={false}
                axisLine={false}
                width={56}
                tickMargin={8}
                style={{ fontSize: 12 }}
              />
              <ChartTooltip content={<DayBreakdownTooltip />} />
              {keys.map((key) => (
                <Bar
                  key={key}
                  dataKey={key}
                  stackId="spend"
                  fill={config[key]?.color ?? "var(--chart-1)"}
                  radius={2}
                  maxBarSize={24}
                  isAnimationActive={false}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </ChartContainer>
      </div>
    </section>
  )
}
