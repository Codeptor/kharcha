type InputRow = {
  day: string
  source: string
  provider: string
  model: string
  costUsd: string
  createdAt: Date | null
}

type ChartSegment = {
  key: string
  label: string
  costUsd: number
  source: string
}

type ChartDay = {
  day: string
  total: number
  segments: ChartSegment[]
}

type ProviderTotal = {
  provider: string
  costUsd: number
}

export type HourBucket = {
  dayOfWeek: number
  hour: number
  costUsd: number
}

export type TokenTotals = {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

export type DashboardData = {
  days: ChartDay[]
  lifetimeTotalUsd: number
  lastSynced: string | null
  byProvider: ProviderTotal[]
  hourBuckets?: HourBucket[]
  tokenTotals?: TokenTotals
}

export function buildChartData(rows: InputRow[]): DashboardData {
  const dayMap = new Map<string, Map<string, ChartSegment>>()
  let lastSynced: string | null = null

  for (const row of rows) {
    const costUsd = Number(row.costUsd)
    const segKey = `${row.provider}:${row.model}`

    if (!dayMap.has(row.day)) dayMap.set(row.day, new Map())
    const segments = dayMap.get(row.day)!

    const existing = segments.get(segKey)
    if (existing) {
      existing.costUsd += costUsd
    } else {
      segments.set(segKey, {
        key: segKey,
        label: `${row.provider} / ${row.model}`,
        costUsd,
        source: row.source,
      })
    }

    if (row.createdAt) {
      const ts = row.createdAt.toISOString()
      if (!lastSynced || ts > lastSynced) lastSynced = ts
    }
  }

  const days: ChartDay[] = [...dayMap.entries()]
    .map(([day, segments]) => {
      const segs = [...segments.values()]
      return {
        day,
        total: segs.reduce((s, seg) => s + seg.costUsd, 0),
        segments: segs,
      }
    })
    .sort((a, b) => a.day.localeCompare(b.day))

  const lifetimeTotalUsd = days.reduce((sum, day) => sum + day.total, 0)

  const providerMap = new Map<string, number>()
  for (const day of days) {
    for (const seg of day.segments) {
      const provider = seg.key.split(":")[0]!
      providerMap.set(provider, (providerMap.get(provider) ?? 0) + seg.costUsd)
    }
  }
  const byProvider = [...providerMap.entries()]
    .map(([provider, costUsd]) => ({ provider, costUsd }))
    .sort((a, b) => b.costUsd - a.costUsd)

  return { days, lifetimeTotalUsd, lastSynced, byProvider }
}
