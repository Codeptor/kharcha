import { cn } from "@workspace/ui/lib/utils"

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value)
}

export function DashboardHeader({
  title,
  lifetimeTotalUsd,
}: {
  title: string
  lifetimeTotalUsd: number
}) {
  return (
    <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="space-y-2">
        <p className="text-xs uppercase tracking-[0.35em] text-muted-foreground">Public usage archive</p>
        <h1 className={cn("text-3xl font-semibold tracking-tight sm:text-5xl")}>{title}</h1>
      </div>
      <div className="text-left sm:text-right">
        <p className="text-xs uppercase tracking-[0.35em] text-muted-foreground">Total spend</p>
        <p className="font-mono text-3xl tabular-nums sm:text-5xl">{formatCurrency(lifetimeTotalUsd)}</p>
      </div>
    </header>
  )
}
