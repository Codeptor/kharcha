import { asc } from "drizzle-orm"

import { db } from "@/lib/db/client"
import { usageRows } from "@/lib/db/schema"
import { buildChartData } from "./chart-shape"

export async function getDashboardData() {
  const rows = await db
    .select({
      day: usageRows.day,
      source: usageRows.source,
      provider: usageRows.provider,
      model: usageRows.model,
      costUsd: usageRows.costUsd,
      createdAt: usageRows.createdAt,
    })
    .from(usageRows)
    .orderBy(asc(usageRows.day), asc(usageRows.provider), asc(usageRows.model))

  return buildChartData(rows)
}
