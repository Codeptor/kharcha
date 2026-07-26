import { asc, sql } from "drizzle-orm"

import { db } from "@/lib/db/client"
import { hourOfDayBuckets, usageRows } from "@/lib/db/schema"
import { buildChartData } from "./chart-shape"

export async function getDashboardData() {
  const [rows, hourBuckets, tokenTotals] = await Promise.all([
    db
      .select({
        day: usageRows.day,
        source: usageRows.source,
        provider: usageRows.provider,
        model: usageRows.model,
        costUsd: usageRows.costUsd,
        pricingMode: usageRows.pricingMode,
        inputTokens: usageRows.inputTokens,
        outputTokens: usageRows.outputTokens,
        cacheReadTokens: usageRows.cacheReadTokens,
        cacheWriteTokens: usageRows.cacheWriteTokens,
        aggregateTokens: usageRows.aggregateTokens,
        createdAt: usageRows.createdAt,
      })
      .from(usageRows)
      .orderBy(
        asc(usageRows.day),
        asc(usageRows.provider),
        asc(usageRows.model)
      ),
    db
      .select({
        dayOfWeek: hourOfDayBuckets.dayOfWeek,
        hour: hourOfDayBuckets.hour,
        costUsd: hourOfDayBuckets.costUsd,
      })
      .from(hourOfDayBuckets),
    db
      .select({
        input: sql<string>`coalesce(sum(${usageRows.inputTokens}),0)`,
        output: sql<string>`coalesce(sum(${usageRows.outputTokens}),0)`,
        cacheRead: sql<string>`coalesce(sum(${usageRows.cacheReadTokens}),0)`,
        cacheWrite: sql<string>`coalesce(sum(${usageRows.cacheWriteTokens}),0)`,
        aggregate: sql<string>`coalesce(sum(${usageRows.aggregateTokens}),0)`,
      })
      .from(usageRows),
  ])

  const chart = buildChartData(rows)
  const totals = tokenTotals[0]
  return {
    ...chart,
    hourBuckets: hourBuckets.map((b) => ({
      dayOfWeek: b.dayOfWeek,
      hour: b.hour,
      costUsd: Number(b.costUsd),
    })),
    tokenTotals: {
      input: Number(totals?.input ?? 0),
      output: Number(totals?.output ?? 0),
      cacheRead: Number(totals?.cacheRead ?? 0),
      cacheWrite: Number(totals?.cacheWrite ?? 0),
      aggregate: Number(totals?.aggregate ?? 0),
    },
  }
}
