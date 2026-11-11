import type { PricingMode, PricingSnapshot } from "../types"
import { parseModelsDevCatalog } from "./models-dev"

export type RateSet = Omit<PricingSnapshot, "tiers">

export type PricedCounters = {
  inputTokens: number | null
  outputTokens: number | null
  cacheReadTokens: number | null
  cacheWriteTokens: number | null
  cacheWrite1hTokens?: number | null
}

/**
 * The rates a single request bills at: the tier with the largest threshold
 * strictly below its prompt (input + cache read + cache write), else the base.
 */
export function resolveRates(pricing: PricingSnapshot, counters: PricedCounters): RateSet {
  const prompt = (counters.inputTokens ?? 0) + (counters.cacheReadTokens ?? 0) + (counters.cacheWriteTokens ?? 0)
  let rates: RateSet = pricing
  for (const tier of pricing.tiers ?? []) {
    if (prompt > tier.promptTokensAbove) rates = tier
  }
  return rates
}

export function priceCounters(rates: RateSet, counters: PricedCounters): number {
  // Catalog cache_write is the 5-minute rate (1.25x input); 1-hour cache
  // writes bill at 2x input. Anthropic prompt caching pricing:
  // https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching
  const inputCost = rates.inputCost ?? 0
  const cacheWrite = counters.cacheWriteTokens ?? 0
  const cacheWrite1h = Math.min(counters.cacheWrite1hTokens ?? 0, cacheWrite)
  return (
    ((counters.inputTokens ?? 0) / 1_000_000) * inputCost +
    ((counters.outputTokens ?? 0) / 1_000_000) * (rates.outputCost ?? 0) +
    ((counters.cacheReadTokens ?? 0) / 1_000_000) * (rates.cacheReadCost ?? 0) +
    ((cacheWrite - cacheWrite1h) / 1_000_000) * (rates.cacheWriteCost ?? 0) +
    (cacheWrite1h / 1_000_000) * inputCost * 2
  )
}

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

  // models.dev lists placeholder entries with no rates at all (e.g. sakana:fugu
  // with null input and output). Those are no better than a missing match, so
  // the row must not become a $0 estimate. A match that has an input or output
  // rate but no cache rate still prices below; required cache-write pricing is
  // enforced by the caller via requiresCacheWritePricing.
  if (
    input.pricingMatch.inputCost == null &&
    input.pricingMatch.outputCost == null
  ) {
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

  const costUsd = priceCounters(resolveRates(input.pricingMatch, input), input)

  return {
    pricingMode: "estimated",
    costUsd,
    snapshot: input.pricingMatch,
  }
}

export { parseModelsDevCatalog }
