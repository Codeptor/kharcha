import type { PricingMode, PricingSnapshot } from "../types"
import { parseModelsDevCatalog } from "./models-dev"

export function freezePricing(input: {
  exactCostUsd: number | null
  pricingMatch: PricingSnapshot | null
  inputTokens: number | null
  outputTokens: number | null
  cacheReadTokens: number | null
  cacheWriteTokens: number | null
  cacheWrite1hTokens?: number | null
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

  const hasTokenCounters =
    input.inputTokens !== null ||
    input.outputTokens !== null ||
    input.cacheReadTokens !== null ||
    input.cacheWriteTokens !== null

  if (!hasTokenCounters) {
    return {
      pricingMode: "unpriced",
      costUsd: 0,
      snapshot: null,
    }
  }

  // Catalog cache_write is the 5-minute rate (1.25x input); 1-hour cache
  // writes bill at 2x input. Anthropic prompt caching pricing:
  // https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching
  const inputCost = input.pricingMatch.inputCost ?? 0
  const cacheWrite = input.cacheWriteTokens ?? 0
  const cacheWrite1h = Math.min(input.cacheWrite1hTokens ?? 0, cacheWrite)
  const costUsd =
    ((input.inputTokens ?? 0) / 1_000_000) * inputCost +
    ((input.outputTokens ?? 0) / 1_000_000) * (input.pricingMatch.outputCost ?? 0) +
    ((input.cacheReadTokens ?? 0) / 1_000_000) * (input.pricingMatch.cacheReadCost ?? 0) +
    ((cacheWrite - cacheWrite1h) / 1_000_000) * (input.pricingMatch.cacheWriteCost ?? 0) +
    (cacheWrite1h / 1_000_000) * inputCost * 2

  return {
    pricingMode: "estimated",
    costUsd,
    snapshot: input.pricingMatch,
  }
}

export { parseModelsDevCatalog }
