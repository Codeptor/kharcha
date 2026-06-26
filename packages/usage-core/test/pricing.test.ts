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
