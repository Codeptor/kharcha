import { normalizeModelKey } from "../model-aliases"
import type { PricingSnapshot, UsageSlice } from "../types"
import { openCatalogArchive, type CatalogArchive } from "./catalog-archive"
import { derivePricing } from "./lookup"
import type { ModelsDevCatalogRow } from "./models-dev"
import { PEAK_RULES, PRICE_HISTORY, type DatedRate, type PeakRule } from "./price-history"

export type SlicePricing = {
  snapshot: PricingSnapshot | null
  /** The harness-logged cost is not trusted for this slice; price it from the snapshot. */
  ignoreExactCost: boolean
}

export type SlicePricingResolver = (slice: UsageSlice) => SlicePricing

export type DatedPricingOptions = {
  archiveDir?: string
  archive?: CatalogArchive
  history?: DatedRate[]
  peakRules?: PeakRule[]
}

const CHINA_OFFSET_MS = 8 * 3_600_000

// A day-grained counter has no request time; local noon puts it in the middle
// of its day, so a price change inside the day lands on the nearer side.
function requestTime(slice: Pick<UsageSlice, "day" | "startedAt">): number {
  if (slice.startedAt) {
    const parsed = Date.parse(slice.startedAt)
    if (!Number.isNaN(parsed)) return parsed
  }
  return new Date(`${slice.day}T12:00:00`).getTime()
}

const hasRate = (snapshot: PricingSnapshot | undefined): snapshot is PricingSnapshot =>
  snapshot !== undefined && (snapshot.inputCost != null || snapshot.outputCost != null)

function applyHistory(rows: ModelsDevCatalogRow[], entries: DatedRate[]): ModelsDevCatalogRow[] {
  let out = rows
  for (const entry of entries) {
    const colon = entry.key.indexOf(":")
    const providerId = entry.key.slice(0, colon)
    const modelId = entry.key.slice(colon + 1)
    const defined = Object.fromEntries(Object.entries(entry.rates).filter(([, value]) => value !== undefined))
    let matched = false
    out = out.map(row => {
      if (row.providerId !== providerId || row.modelId !== modelId) return row
      matched = true
      return { ...row, ...defined }
    })
    if (!matched) {
      out = [
        ...out,
        { providerId, modelId, inputCost: null, outputCost: null, cacheReadCost: null, cacheWriteCost: null, ...defined },
      ]
    }
  }
  return out
}

function scale(snapshot: PricingSnapshot, multiplier: number): PricingSnapshot {
  const times = (value: number | null) => (value === null ? null : value * multiplier)
  return {
    inputCost: times(snapshot.inputCost),
    outputCost: times(snapshot.outputCost),
    cacheReadCost: times(snapshot.cacheReadCost),
    cacheWriteCost: times(snapshot.cacheWriteCost),
    ...(snapshot.tiers
      ? {
          tiers: snapshot.tiers.map(tier => ({
            promptTokensAbove: tier.promptTokensAbove,
            inputCost: times(tier.inputCost),
            outputCost: times(tier.outputCost),
            cacheReadCost: times(tier.cacheReadCost),
            cacheWriteCost: times(tier.cacheWriteCost),
          })),
        }
      : {}),
  }
}

function inPeak(rule: PeakRule, time: number): boolean {
  const at = new Date(time)
  const weekday = ((at.getUTCDay() + 6) % 7) + 1
  const hour = at.getUTCHours()
  if (!rule.windowsUtc.some(w => w.weekdays.includes(weekday) && hour >= w.startHour && hour < w.endHour)) return false
  return !rule.excludeDatesUtc8.includes(new Date(time + CHINA_OFFSET_MS).toISOString().slice(0, 10))
}

/**
 * Prices a slice at the rate in force when it was made: the archived catalog
 * of its day, curated history applied over it, then peak surcharges.
 */
export function createDatedPricing(options: DatedPricingOptions) {
  const archive = options.archive ?? openCatalogArchive(options.archiveDir ?? "")
  const history = options.history ?? PRICE_HISTORY
  const peakRules = options.peakRules ?? PEAK_RULES
  const bounds = history.map(entry => ({
    from: entry.from ? Date.parse(entry.from) : Number.NEGATIVE_INFINITY,
    until: entry.until ? Date.parse(entry.until) : Number.POSITIVE_INFINITY,
  }))
  const peakFrom = peakRules.map(rule => Date.parse(rule.from))

  const derived = new Map<string, ReturnType<typeof derivePricing>>()
  const pricingFor = (date: string, active: number[]) => {
    const memoKey = `${date}|${active.join(",")}`
    let pricing = derived.get(memoKey)
    if (!pricing) {
      pricing = derivePricing(applyHistory(archive.rows(date), active.map(index => history[index]!)))
      derived.set(memoKey, pricing)
    }
    return pricing
  }

  // The snapshot of the archive that prices the day. A model models.dev listed
  // only later has no rate there, so the oldest later archive that lists one
  // (its launch price) stands in. Memoized per archive, active entries and key.
  const snapshots = new Map<string, PricingSnapshot | null>()
  const snapshotFor = (date: string, time: number, key: string): PricingSnapshot | null => {
    const active = history.flatMap((_, index) => (time >= bounds[index]!.from && time < bounds[index]!.until ? [index] : []))
    const memoKey = `${date}|${active.join(",")}|${key}`
    let hit = snapshots.get(memoKey)
    if (hit === undefined) {
      const own = pricingFor(date, active).get(key)
      hit = own ?? null
      if (!hasRate(own)) {
        for (const later of archive.datesAfter(date)) {
          const found = pricingFor(later, active).get(key)
          if (hasRate(found)) {
            hit = found
            break
          }
        }
      }
      snapshots.set(memoKey, hit)
    }
    return hit
  }

  const scaled = new Map<PricingSnapshot, Map<number, PricingSnapshot>>()
  const scaledSnapshot = (snapshot: PricingSnapshot, multiplier: number) => {
    const byMultiplier = scaled.get(snapshot) ?? new Map<number, PricingSnapshot>()
    scaled.set(snapshot, byMultiplier)
    let hit = byMultiplier.get(multiplier)
    if (!hit) {
      hit = scale(snapshot, multiplier)
      byMultiplier.set(multiplier, hit)
    }
    return hit
  }

  const resolve: SlicePricingResolver = slice => {
    const date = archive.dateFor(slice.day)
    if (date === null) return { snapshot: null, ignoreExactCost: false }

    const time = requestTime(slice)
    const normalized = normalizeModelKey(slice.provider, slice.model)
    let snapshot = snapshotFor(date, time, `${normalized.provider}:${normalized.model}`)
    let ignoreExactCost = false
    let multiplier = 1
    peakRules.forEach((rule, index) => {
      if (rule.provider !== normalized.provider || !(time >= peakFrom[index]!)) return
      // Without a rate the logged cost is the only price there is.
      if (!hasRate(snapshot ?? undefined)) return
      ignoreExactCost = true
      if (inPeak(rule, time)) multiplier *= rule.multiplier
    })
    if (snapshot && multiplier !== 1) snapshot = scaledSnapshot(snapshot, multiplier)
    return { snapshot, ignoreExactCost }
  }

  return { resolve, lookupCount: () => derived.size }
}
