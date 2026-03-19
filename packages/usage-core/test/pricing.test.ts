import { describe, expect, it } from "bun:test"
import { freezePricing, parseModelsDevCatalog } from "../src/pricing/freeze-pricing"

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
      }),
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
      }),
    ).toMatchObject({
      pricingMode: "estimated",
      costUsd: 8,
    })
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
      }),
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
