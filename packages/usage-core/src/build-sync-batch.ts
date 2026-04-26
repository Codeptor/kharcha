import { createHash } from "node:crypto"
import { freezePricing } from "./pricing/freeze-pricing"
import { normalizeModelKey } from "./model-aliases"
import type { PricingMode, PricingSnapshot, UsageSlice } from "./types"

export type SyncPricingLookup = Map<string, PricingSnapshot>

export type SyncBatchRow = {
  dedupeKey: string
  source: UsageSlice["source"]
  provider: string
  model: string
  day: string
  costUsd: number
  pricingMode: PricingMode
  pricingSnapshotKey: string | null
  inputTokens: number | null
  outputTokens: number | null
  cacheReadTokens: number | null
  cacheWriteTokens: number | null
}

export type SyncPricingSnapshot = {
  snapshotKey: string
  provider: string
  model: string
  inputCost: number | null
  outputCost: number | null
  cacheReadCost: number | null
  cacheWriteCost: number | null
}

export type SyncHourBucket = {
  dayOfWeek: number
  hour: number
  costUsd: number
}

export type SyncBatch = {
  generatedAt: string
  pricingSnapshots: SyncPricingSnapshot[]
  rows: SyncBatchRow[]
  hourBuckets: SyncHourBucket[]
}

function hashSnapshot(provider: string, model: string, snapshot: PricingSnapshot): string {
  return createHash("sha256")
    .update(
      [
        provider,
        model,
        snapshot.inputCost ?? "",
        snapshot.outputCost ?? "",
        snapshot.cacheReadCost ?? "",
        snapshot.cacheWriteCost ?? "",
      ].join(":"),
    )
    .digest("hex")
}

export async function buildSyncBatch(rows: UsageSlice[], pricingLookup: SyncPricingLookup): Promise<SyncBatch> {
  const deduped = new Map<string, SyncBatchRow>()
  const snapshots = new Map<string, SyncPricingSnapshot>()
  const hourBuckets = new Map<string, SyncHourBucket>()

  for (const row of rows) {
    const normalized = normalizeModelKey(row.provider, row.model)
    const pricingMatch = pricingLookup.get(`${normalized.provider}:${normalized.model}`) ?? null
    const pricing = freezePricing({
      exactCostUsd: row.exactCostUsd,
      pricingMatch,
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      cacheReadTokens: row.cacheReadTokens,
      cacheWriteTokens: row.cacheWriteTokens,
    })

    const dedupeKey = createHash("sha256")
      .update([row.source, row.sourceSessionHash, normalized.provider, normalized.model, row.day].join(":"))
      .digest("hex")

    let pricingSnapshotKey: string | null = null
    if (pricing.snapshot) {
      pricingSnapshotKey = hashSnapshot(normalized.provider, normalized.model, pricing.snapshot)
      if (!snapshots.has(pricingSnapshotKey)) {
        snapshots.set(pricingSnapshotKey, {
          snapshotKey: pricingSnapshotKey,
          provider: normalized.provider,
          model: normalized.model,
          inputCost: pricing.snapshot.inputCost,
          outputCost: pricing.snapshot.outputCost,
          cacheReadCost: pricing.snapshot.cacheReadCost,
          cacheWriteCost: pricing.snapshot.cacheWriteCost,
        })
      }
    }

    if (deduped.has(dedupeKey)) {
      const existing = deduped.get(dedupeKey)!
      existing.costUsd += pricing.costUsd
      if (row.inputTokens != null)
        existing.inputTokens = (existing.inputTokens ?? 0) + row.inputTokens
      if (row.outputTokens != null)
        existing.outputTokens = (existing.outputTokens ?? 0) + row.outputTokens
      if (row.cacheReadTokens != null)
        existing.cacheReadTokens =
          (existing.cacheReadTokens ?? 0) + row.cacheReadTokens
      if (row.cacheWriteTokens != null)
        existing.cacheWriteTokens =
          (existing.cacheWriteTokens ?? 0) + row.cacheWriteTokens
    } else {
      deduped.set(dedupeKey, {
        dedupeKey,
        source: row.source,
        provider: normalized.provider,
        model: normalized.model,
        day: row.day,
        costUsd: pricing.costUsd,
        pricingMode: pricing.pricingMode,
        pricingSnapshotKey,
        inputTokens: row.inputTokens ?? null,
        outputTokens: row.outputTokens ?? null,
        cacheReadTokens: row.cacheReadTokens ?? null,
        cacheWriteTokens: row.cacheWriteTokens ?? null,
      })
    }

    if (row.startedAt) {
      const ts = new Date(row.startedAt)
      if (!Number.isNaN(ts.getTime())) {
        const dow = (ts.getUTCDay() + 6) % 7
        const hour = ts.getUTCHours()
        const k = `${dow}:${hour}`
        const cur =
          hourBuckets.get(k) ?? { dayOfWeek: dow, hour, costUsd: 0 }
        cur.costUsd += pricing.costUsd
        hourBuckets.set(k, cur)
      }
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    pricingSnapshots: [...snapshots.values()],
    rows: [...deduped.values()],
    hourBuckets: [...hourBuckets.values()],
  }
}
