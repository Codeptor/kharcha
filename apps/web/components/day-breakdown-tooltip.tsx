"use client"

import { useChart } from "@workspace/ui/components/chart"
import { cn } from "@workspace/ui/lib/utils"

type TooltipEntry = {
  dataKey?: string | number
  name?: string
  value?: number | string
  color?: string
  payload?: Record<string, unknown>
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: value >= 100 ? 0 : 2,
  }).format(value)
}

function formatDayLabel(label: string) {
  const date = new Date(`${label}T00:00:00Z`)

  if (Number.isNaN(date.getTime())) {
    return label
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(date)
}

export function DayBreakdownTooltip({
  active,
  label,
  payload,
}: {
  active?: boolean
  label?: string | number
  payload?: TooltipEntry[]
}) {
  const { config } = useChart()

  if (!active || !payload?.length) {
    return null
  }

  const rows = payload
    .map((entry) => {
      const key = String(entry.dataKey ?? entry.name ?? "")
      const value = typeof entry.value === "string" ? Number(entry.value) : entry.value ?? 0
      const item = config[key] ?? { label: key, color: entry.color ?? "var(--chart-1)" }

      return {
        key,
        label: item.label,
        color: item.color,
        value,
      }
    })
    .filter((entry) => Number(entry.value) > 0)

  const total =
    rows.reduce((sum, row) => sum + Number(row.value ?? 0), 0) ||
    Number((payload[0]?.payload?.total as number | string | undefined) ?? 0)

  const dayLabel = typeof label === "string" ? label : String(label ?? "")

  return (
    <div className="min-w-72 rounded-2xl border border-border/70 bg-popover/95 px-4 py-3 text-popover-foreground shadow-2xl backdrop-blur">
      <div className="flex items-baseline justify-between gap-4">
        <p className="text-sm font-medium tracking-tight">{formatDayLabel(dayLabel)}</p>
        <p className={cn("font-mono text-sm tabular-nums")}>{formatCurrency(total)}</p>
      </div>
      <div className="mt-3 space-y-2">
        {rows.map((row) => (
          <div key={row.key} className="flex items-center justify-between gap-4 text-sm">
            <div className="flex min-w-0 items-center gap-2">
              <span className="size-2.5 rounded-full" style={{ backgroundColor: row.color }} />
              <span className="truncate text-muted-foreground">{row.label}</span>
            </div>
            <span className="font-mono tabular-nums">{formatCurrency(Number(row.value))}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
