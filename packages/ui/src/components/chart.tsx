"use client"

import * as React from "react"
import { Tooltip as RechartsTooltip } from "recharts"

import { cn } from "@workspace/ui/lib/utils"

export type ChartConfig = Record<
  string,
  {
    label: string
    color: string
  }
>

type ChartContextValue = {
  config: ChartConfig
}

const ChartContext = React.createContext<ChartContextValue | null>(null)

function useChart() {
  const context = React.useContext(ChartContext)

  if (!context) {
    throw new Error("useChart must be used within ChartContainer")
  }

  return context
}

function ChartContainer({
  className,
  config,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  config: ChartConfig
}) {
  return (
    <ChartContext.Provider value={{ config }}>
      <div data-slot="chart" className={cn("relative", className)} {...props}>
        {children}
      </div>
    </ChartContext.Provider>
  )
}

type ChartTooltipProps = React.ComponentProps<typeof RechartsTooltip>

function ChartTooltip({ cursor = { fill: "rgba(127, 127, 127, 0.08)" }, ...props }: ChartTooltipProps) {
  return <RechartsTooltip cursor={cursor} {...props} />
}

type ChartTooltipContentProps = {
  active?: boolean
  label?: string | number
  payload?: Array<{
    dataKey?: string | number
    name?: string
    value?: number | string
    color?: string
    payload?: Record<string, unknown>
  }>
  className?: string
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: value >= 100 ? 0 : 2,
  }).format(value)
}

function ChartTooltipContent({ active, label, payload, className }: ChartTooltipContentProps) {
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
    <div
      className={cn(
        "min-w-64 rounded-2xl border border-border/70 bg-popover/95 px-4 py-3 text-popover-foreground shadow-2xl backdrop-blur",
        className,
      )}
    >
      <div className="flex items-baseline justify-between gap-4">
        <p className="text-sm font-medium tracking-tight">{dayLabel}</p>
        <p className="font-mono text-sm tabular-nums">{formatCurrency(total)}</p>
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

export { ChartContainer, ChartTooltip, ChartTooltipContent, useChart }
