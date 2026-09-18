import { describe, expect, it } from "bun:test"
import {
  freezePricing,
  parseModelsDevCatalog,
} from "../src/pricing/freeze-pricing"
import { buildSyncBatch } from "../src/build-sync-batch"
import { CUSTOM_PRICING } from "../src/pricing/custom-pricing"

describe("freezePricing", () => {
  it("prefers exact logged cost when present", () => {
    expect(
      freezePricing({
        exactCostUsd: 1.23,
        pricingMatch: null,
        inputTokens: 100,
        outputTokens: 50,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      })
    ).toEqual({
      pricingMode: "exact",
      costUsd: 1.23,
      snapshot: null,
    })
  })

  it("estimates cost from a pricing snapshot when exact cost is missing", () => {
    expect(
      freezePricing({
        exactCostUsd: null,
        pricingMatch: {
          inputCost: 2,
          outputCost: 3,
          cacheReadCost: 4,
          cacheWriteCost: 5,
        },
        inputTokens: 1_000_000,
        outputTokens: 2_000_000,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      })
    ).toMatchObject({
      pricingMode: "estimated",
      costUsd: 8,
    })
  })

  it("bills 1-hour cache writes at 2x input and the rest at the catalog rate", () => {
    expect(
      freezePricing({
        exactCostUsd: null,
        pricingMatch: {
          inputCost: 5,
          outputCost: 25,
          cacheReadCost: 0.5,
          cacheWriteCost: 6.25,
        },
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 1_000_000,
        cacheWrite1hTokens: 600_000,
      }).costUsd
      // 0.4M*$6.25 (5-minute) + 0.6M*$10 (1-hour, 2x input) = $8.50
    ).toBeCloseTo(8.5, 6)
  })

  it("clamps 1-hour cache writes to the cache-write total", () => {
    expect(
      freezePricing({
        exactCostUsd: null,
        pricingMatch: {
          inputCost: 5,
          outputCost: 25,
          cacheReadCost: 0.5,
          cacheWriteCost: 6.25,
        },
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 1_000_000,
        cacheWrite1hTokens: 2_000_000,
      }).costUsd
    ).toBeCloseTo(10, 6)
  })

  it("does not mark missing token counters as a zero-dollar estimate", () => {
    expect(
      freezePricing({
        exactCostUsd: null,
        pricingMatch: {
          inputCost: 2,
          outputCost: 3,
          cacheReadCost: 4,
          cacheWriteCost: 5,
        },
        inputTokens: null,
        outputTokens: null,
        cacheReadTokens: null,
        cacheWriteTokens: null,
      })
    ).toEqual({
      pricingMode: "unpriced",
      costUsd: 0,
      snapshot: null,
    })
  })
})

describe("custom pricing", () => {
  it("prices Sakana Fugu Ultra (absent from models.dev) from the override", async () => {
    const lookup = new Map(Object.entries(CUSTOM_PRICING))
    const batch = await buildSyncBatch(
      [
        {
          source: "codex",
          provider: "sakana",
          model: "fugu-ultra",
          day: "2026-06-26",
          startedAt: null,
          inputTokens: 1_000_000,
          outputTokens: 1_000_000,
          cacheReadTokens: 1_000_000,
          cacheWriteTokens: null,
          exactCostUsd: null,
          sourceSessionHash: "fugu-1",
        },
      ],
      lookup
    )

    const row = batch.rows[0]
    expect(row?.pricingMode).toBe("estimated")
    // 1M*$5 input + 1M*$30 output + 1M*$0.50 cache-read = $35.50
    expect(row?.costUsd).toBeCloseTo(35.5, 6)
  })

  it("prices Kimi CLI K2.5 rows (dropped from models.dev) from the Moonshot override", async () => {
    const lookup = new Map(Object.entries(CUSTOM_PRICING))
    const batch = await buildSyncBatch(
      [
        {
          source: "kimi",
          provider: "moonshotai",
          model: "kimi-k2.5",
          day: "2026-09-01",
          startedAt: null,
          inputTokens: 1_000_000,
          outputTokens: 1_000_000,
          cacheReadTokens: 1_000_000,
          cacheWriteTokens: null,
          exactCostUsd: null,
          sourceSessionHash: "kimi-1",
        },
      ],
      lookup
    )

    const row = batch.rows[0]
    expect(row).toMatchObject({
      provider: "moonshotai",
      model: "kimi-k2.5",
      pricingMode: "estimated",
    })
    // 1M*$0.60 input + 1M*$3 output + 1M*$0.10 cache-read = $3.70
    expect(row?.costUsd).toBeCloseTo(3.7, 6)
  })
})

describe("parseModelsDevCatalog", () => {
  it("normalizes provider-keyed nested pricing rows from models.dev", () => {
    expect(
      parseModelsDevCatalog({
        anthropic: {
          id: "anthropic",
          models: {
            "claude-opus-4-6": {
              id: "claude-opus-4-6",
              cost: {
                input: 1,
                output: 2,
                cache_read: 3,
                cache_write: 4,
              },
            },
          },
        },
      })
    ).toEqual([
      {
        providerId: "anthropic",
        modelId: "claude-opus-4-6",
        inputCost: 1,
        outputCost: 2,
        cacheReadCost: 3,
        cacheWriteCost: 4,
      },
    ])
  })
})
