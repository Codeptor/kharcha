type InputRow = {
  day: string
  source: string
  provider: string
  model: string
  costUsd: string
  pricingMode: string
  inputTokens: number | null
  outputTokens: number | null
  cacheReadTokens: number | null
  cacheWriteTokens: number | null
  aggregateTokens?: number | null
  createdAt: Date | null
}

export type PricingMode = "exact" | "estimated" | "unpriced"

export type TokenTotals = {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  aggregate: number
}

export type PricingModeTotal = TokenTotals & {
  mode: PricingMode
  costUsd: number
  rows: number
  nonzeroTokenRows: number
}

export type SourceTotal = TokenTotals & {
  source: string
  costUsd: number
  rows: number
  nonzeroTokenRows: number
}

type ChartSegment = TokenTotals & {
  key: string
  label: string
  costUsd: number
  source: string
  rows: number
  nonzeroTokenRows: number
  modeTotals: PricingModeTotal[]
  sourceTotals: SourceTotal[]
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

export type DashboardData = {
  days: ChartDay[]
  lifetimeTotalUsd: number
  lastSynced: string | null
  byProvider: ProviderTotal[]
  hourBuckets?: HourBucket[]
  tokenTotals?: TokenTotals
}

type MutableChartSegment = Omit<ChartSegment, "modeTotals" | "sourceTotals"> & {
  modeMap: Map<PricingMode, PricingModeTotal>
  sourceMap: Map<string, SourceTotal>
}

const MODE_ORDER: PricingMode[] = ["exact", "estimated", "unpriced"]

function emptyTokens(): TokenTotals {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, aggregate: 0 }
}

function tokenCount(tokens: TokenTotals): number {
  return (
    tokens.input +
    tokens.output +
    tokens.cacheRead +
    tokens.cacheWrite +
    tokens.aggregate
  )
}

function rowTokens(row: InputRow): TokenTotals {
  return {
    input: row.inputTokens ?? 0,
    output: row.outputTokens ?? 0,
    cacheRead: row.cacheReadTokens ?? 0,
    cacheWrite: row.cacheWriteTokens ?? 0,
    aggregate: row.aggregateTokens ?? 0,
  }
}

function addTokens(target: TokenTotals, tokens: TokenTotals) {
  target.input += tokens.input
  target.output += tokens.output
  target.cacheRead += tokens.cacheRead
  target.cacheWrite += tokens.cacheWrite
  target.aggregate += tokens.aggregate
}

function modeSort(left: PricingModeTotal, right: PricingModeTotal): number {
  return MODE_ORDER.indexOf(left.mode) - MODE_ORDER.indexOf(right.mode)
}

function toPricingMode(value: string): PricingMode {
  return value === "exact" || value === "estimated" || value === "unpriced"
    ? value
    : "unpriced"
}

export function buildChartData(rows: InputRow[]): DashboardData {
  const dayMap = new Map<string, Map<string, MutableChartSegment>>()
  let lastSynced: string | null = null

  for (const row of rows) {
    const costUsd = Number(row.costUsd)
    const segKey = `${row.provider}:${row.model}`
    const pricingMode = toPricingMode(row.pricingMode)
    const tokens = rowTokens(row)
    const hasNonzeroTokens = tokenCount(tokens) > 0

    if (!dayMap.has(row.day)) dayMap.set(row.day, new Map())
    const segments = dayMap.get(row.day)!

    const existing = segments.get(segKey)
    if (existing) {
      existing.costUsd += costUsd
      existing.rows += 1
      existing.nonzeroTokenRows += hasNonzeroTokens ? 1 : 0
      addTokens(existing, tokens)
    } else {
      segments.set(segKey, {
        key: segKey,
        label: `${row.provider} / ${row.model}`,
        costUsd,
        source: row.source,
        rows: 1,
        nonzeroTokenRows: hasNonzeroTokens ? 1 : 0,
        ...tokens,
        modeMap: new Map(),
        sourceMap: new Map(),
      })
    }

    const segment = segments.get(segKey)!
    const modeTotal = segment.modeMap.get(pricingMode) ?? {
      mode: pricingMode,
      costUsd: 0,
      rows: 0,
      nonzeroTokenRows: 0,
      ...emptyTokens(),
    }
    modeTotal.costUsd += costUsd
    modeTotal.rows += 1
    modeTotal.nonzeroTokenRows += hasNonzeroTokens ? 1 : 0
    addTokens(modeTotal, tokens)
    segment.modeMap.set(pricingMode, modeTotal)

    const sourceTotal = segment.sourceMap.get(row.source) ?? {
      source: row.source,
      costUsd: 0,
      rows: 0,
      nonzeroTokenRows: 0,
      ...emptyTokens(),
    }
    sourceTotal.costUsd += costUsd
    sourceTotal.rows += 1
    sourceTotal.nonzeroTokenRows += hasNonzeroTokens ? 1 : 0
    addTokens(sourceTotal, tokens)
    segment.sourceMap.set(row.source, sourceTotal)

    if (row.createdAt) {
      const ts = row.createdAt.toISOString()
      if (!lastSynced || ts > lastSynced) lastSynced = ts
    }
  }

  const days: ChartDay[] = [...dayMap.entries()]
    .map(([day, segments]) => {
      const segs = [...segments.values()].map(
        ({ modeMap, sourceMap, ...seg }) => {
          const sourceTotals = [...sourceMap.values()].sort(
            (a, b) => b.costUsd - a.costUsd
          )
          return {
            ...seg,
            source: sourceTotals[0]?.source ?? seg.source,
            modeTotals: [...modeMap.values()].sort(modeSort),
            sourceTotals,
          }
        }
      )
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
