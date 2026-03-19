import { asc } from "drizzle-orm"

import { db } from "@/lib/db/client"
import { dailyRollups } from "@/lib/db/schema"
import { buildChartData } from "./chart-shape"

export async function getDashboardData() {
  const rows = await db
    .select({
      day: dailyRollups.day,
      provider: dailyRollups.provider,
      model: dailyRollups.model,
      costUsd: dailyRollups.costUsd,
    })
    .from(dailyRollups)
    .orderBy(asc(dailyRollups.day), asc(dailyRollups.provider), asc(dailyRollups.model))

  return buildChartData(rows)
}
