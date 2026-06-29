import type { DashboardData, PricingMode, TokenTotals } from "./chart-shape"

export type StreakInfo = {
  current: number
  longest: number
  activeDays: number
  totalDays: number
}

export type ModelStat = {
  key: string
  label: string
  provider: string
  costUsd: number
  totalTokens: number
  rows: number
  exactCostUsd: number
  estimatedCostUsd: number
  unpricedTokens: number
  activeDays: number
  avgPerActiveDay: number
  costPerMillionTokens: number | null
  share: number
}

export type ModeStat = TokenTotals & {
  mode: PricingMode
  costUsd: number
  rows: number
  nonzeroTokenRows: number
  totalTokens: number
}

export type SourceStat = TokenTotals & {
  source: string
  costUsd: number
  rows: number
  nonzeroTokenRows: number
  totalTokens: number
  costPerMillionTokens: number | null
}

export type UsageMetrics = TokenTotals & {
  costUsd: number
  rows: number
  nonzeroTokenRows: number
  totalTokens: number
  directTokens: number
  cacheTokens: number
  pricedTokens: number
  unpricedTokens: number
  pricedCoverage: number
  exactCostUsd: number
  estimatedCostUsd: number
  unpricedCostUsd: number
  unpricedNonzeroRows: number
  costPerMillionTokens: number | null
  cacheShare: number
  cacheReadShare: number
  outputShare: number
  modeStats: ModeStat[]
  sourceStats: SourceStat[]
}

const MODE_ORDER: PricingMode[] = ["exact", "estimated", "unpriced"]

function emptyTokens(): TokenTotals {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
}

function addTokens(target: TokenTotals, source: TokenTotals) {
  target.input += source.input
  target.output += source.output
  target.cacheRead += source.cacheRead
  target.cacheWrite += source.cacheWrite
}

function totalTokens(tokens: TokenTotals): number {
  return tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite
}

function costPerMillion(costUsd: number, tokens: number): number | null {
  return tokens > 0 ? (costUsd / tokens) * 1_000_000 : null
}

function modeSort(a: { mode: PricingMode }, b: { mode: PricingMode }): number {
  return MODE_ORDER.indexOf(a.mode) - MODE_ORDER.indexOf(b.mode)
}

export function computeStreaks(days: DashboardData["days"]): StreakInfo {
  if (days.length === 0) {
    return { current: 0, longest: 0, activeDays: 0, totalDays: 0 }
  }

  const active = new Set(days.filter((d) => d.total > 0).map((d) => d.day))
  const first = new Date(`${days[0]!.day}T00:00:00Z`)
  const last = new Date(`${days[days.length - 1]!.day}T00:00:00Z`)

  let longest = 0
  let run = 0
  const cur = new Date(first)
  while (cur <= last) {
    const iso = cur.toISOString().slice(0, 10)
    if (active.has(iso)) {
      run += 1
      if (run > longest) longest = run
    } else {
      run = 0
    }
    cur.setUTCDate(cur.getUTCDate() + 1)
  }

  let current = 0
  const walk = new Date(last)
  while (walk >= first) {
    const iso = walk.toISOString().slice(0, 10)
    if (!active.has(iso)) break
    current += 1
    walk.setUTCDate(walk.getUTCDate() - 1)
  }

  const totalDays =
    Math.round((last.getTime() - first.getTime()) / 86_400_000) + 1

  return { current, longest, activeDays: active.size, totalDays }
}

export function computeModelStats(days: DashboardData["days"]): ModelStat[] {
  const map = new Map<
    string,
    ModelStat & TokenTotals & { _daysUsed: Set<string> }
  >()
  let grandTotal = 0

  for (const day of days) {
    for (const seg of day.segments) {
      grandTotal += seg.costUsd
      const provider = seg.key.split(":")[0] ?? ""
      const entry = map.get(seg.key) ?? {
        key: seg.key,
        label: seg.label,
        provider,
        costUsd: 0,
        rows: 0,
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        exactCostUsd: 0,
        estimatedCostUsd: 0,
        unpricedTokens: 0,
        activeDays: 0,
        avgPerActiveDay: 0,
        costPerMillionTokens: null,
        share: 0,
        _daysUsed: new Set<string>(),
      }
      entry.costUsd += seg.costUsd
      entry.rows += seg.rows
      addTokens(entry, seg)
      for (const mode of seg.modeTotals) {
        if (mode.mode === "exact") entry.exactCostUsd += mode.costUsd
        if (mode.mode === "estimated") entry.estimatedCostUsd += mode.costUsd
        if (mode.mode === "unpriced") entry.unpricedTokens += totalTokens(mode)
      }
      if (seg.costUsd > 0) entry._daysUsed.add(day.day)
      map.set(seg.key, entry)
    }
  }

  const stats: ModelStat[] = []
  for (const entry of map.values()) {
    const activeDays = entry._daysUsed.size
    const tokens = totalTokens(entry)
    stats.push({
      key: entry.key,
      label: entry.label,
      provider: entry.provider,
      costUsd: entry.costUsd,
      totalTokens: tokens,
      rows: entry.rows,
      exactCostUsd: entry.exactCostUsd,
      estimatedCostUsd: entry.estimatedCostUsd,
      unpricedTokens: entry.unpricedTokens,
      activeDays,
      avgPerActiveDay: activeDays > 0 ? entry.costUsd / activeDays : 0,
      costPerMillionTokens: costPerMillion(entry.costUsd, tokens),
      share: grandTotal > 0 ? entry.costUsd / grandTotal : 0,
    })
  }

  return stats.sort((a, b) => b.costUsd - a.costUsd)
}

export function computeUsageMetrics(days: DashboardData["days"]): UsageMetrics {
  const modeMap = new Map<PricingMode, ModeStat>()
  const sourceMap = new Map<string, SourceStat>()
  const totals: UsageMetrics = {
    costUsd: 0,
    rows: 0,
    nonzeroTokenRows: 0,
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    directTokens: 0,
    cacheTokens: 0,
    pricedTokens: 0,
    unpricedTokens: 0,
    pricedCoverage: 0,
    exactCostUsd: 0,
    estimatedCostUsd: 0,
    unpricedCostUsd: 0,
    unpricedNonzeroRows: 0,
    costPerMillionTokens: null,
    cacheShare: 0,
    cacheReadShare: 0,
    outputShare: 0,
    modeStats: [],
    sourceStats: [],
  }

  for (const day of days) {
    for (const seg of day.segments) {
      totals.costUsd += seg.costUsd
      totals.rows += seg.rows
      totals.nonzeroTokenRows += seg.nonzeroTokenRows
      addTokens(totals, seg)

      for (const mode of seg.modeTotals) {
        const existing = modeMap.get(mode.mode) ?? {
          mode: mode.mode,
          costUsd: 0,
          rows: 0,
          nonzeroTokenRows: 0,
          totalTokens: 0,
          ...emptyTokens(),
        }
        existing.costUsd += mode.costUsd
        existing.rows += mode.rows
        existing.nonzeroTokenRows += mode.nonzeroTokenRows
        addTokens(existing, mode)
        existing.totalTokens = totalTokens(existing)
        modeMap.set(mode.mode, existing)
      }

      for (const source of seg.sourceTotals) {
        const existing = sourceMap.get(source.source) ?? {
          source: source.source,
          costUsd: 0,
          rows: 0,
          nonzeroTokenRows: 0,
          totalTokens: 0,
          costPerMillionTokens: null,
          ...emptyTokens(),
        }
        existing.costUsd += source.costUsd
        existing.rows += source.rows
        existing.nonzeroTokenRows += source.nonzeroTokenRows
        addTokens(existing, source)
        existing.totalTokens = totalTokens(existing)
        existing.costPerMillionTokens = costPerMillion(
          existing.costUsd,
          existing.totalTokens
        )
        sourceMap.set(source.source, existing)
      }
    }
  }

  totals.totalTokens = totalTokens(totals)
  totals.directTokens = totals.input + totals.output
  totals.cacheTokens = totals.cacheRead + totals.cacheWrite

  const exact = modeMap.get("exact")
  const estimated = modeMap.get("estimated")
  const unpriced = modeMap.get("unpriced")
  totals.exactCostUsd = exact?.costUsd ?? 0
  totals.estimatedCostUsd = estimated?.costUsd ?? 0
  totals.unpricedCostUsd = unpriced?.costUsd ?? 0
  totals.pricedTokens =
    (exact?.totalTokens ?? 0) + (estimated?.totalTokens ?? 0)
  totals.unpricedTokens = unpriced?.totalTokens ?? 0
  totals.unpricedNonzeroRows = unpriced?.nonzeroTokenRows ?? 0
  totals.pricedCoverage =
    totals.totalTokens > 0 ? totals.pricedTokens / totals.totalTokens : 1
  totals.costPerMillionTokens = costPerMillion(
    totals.costUsd,
    totals.totalTokens
  )
  totals.cacheShare =
    totals.totalTokens > 0 ? totals.cacheTokens / totals.totalTokens : 0
  totals.cacheReadShare =
    totals.totalTokens > 0 ? totals.cacheRead / totals.totalTokens : 0
  totals.outputShare =
    totals.totalTokens > 0 ? totals.output / totals.totalTokens : 0
  totals.modeStats = [...modeMap.values()].sort(modeSort)
  totals.sourceStats = [...sourceMap.values()].sort(
    (a, b) => b.costUsd - a.costUsd
  )

  return totals
}
