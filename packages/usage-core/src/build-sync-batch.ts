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

export type SyncBatch = {
  generatedAt: string
  pricingSnapshots: SyncPricingSnapshot[]
  rows: SyncBatchRow[]
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
      })
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    pricingSnapshots: [...snapshots.values()],
    rows: [...deduped.values()],
  }
}
