import type { PricingMode, PricingSnapshot } from "../types"
import { parseModelsDevCatalog } from "./models-dev"

export function freezePricing(input: {
  exactCostUsd: number | null
  pricingMatch: PricingSnapshot | null
  inputTokens: number | null
  outputTokens: number | null
  cacheReadTokens: number | null
  cacheWriteTokens: number | null
}): {
  pricingMode: PricingMode
  costUsd: number
  snapshot: PricingSnapshot | null
} {
  if (input.exactCostUsd !== null) {
    return {
      pricingMode: "exact",
      costUsd: input.exactCostUsd,
      snapshot: null,
    }
  }

  if (!input.pricingMatch) {
    return {
      pricingMode: "unpriced",
      costUsd: 0,
      snapshot: null,
    }
  }

  const costUsd =
    ((input.inputTokens ?? 0) / 1_000_000) * (input.pricingMatch.inputCost ?? 0) +
    ((input.outputTokens ?? 0) / 1_000_000) * (input.pricingMatch.outputCost ?? 0) +
    ((input.cacheReadTokens ?? 0) / 1_000_000) * (input.pricingMatch.cacheReadCost ?? 0) +
    ((input.cacheWriteTokens ?? 0) / 1_000_000) * (input.pricingMatch.cacheWriteCost ?? 0)

  return {
    pricingMode: "estimated",
    costUsd,
    snapshot: input.pricingMatch,
  }
}

export { parseModelsDevCatalog }
