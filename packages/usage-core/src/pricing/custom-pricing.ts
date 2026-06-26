import type { PricingSnapshot } from "../types"

/**
 * Pricing for models that models.dev does not list. Keyed by
 * `${normalizedProvider}:${normalizedModel}` (see normalizeModelKey); costs are
 * USD per 1,000,000 tokens, matching the models.dev catalog and freezePricing.
 * Applied as an override on top of the fetched catalog at sync time.
 */
export const CUSTOM_PRICING: Record<string, PricingSnapshot> = {
  // Sakana Fugu, used via `codex-fugu` (Codex configured with
  // model_provider="sakana", model="fugu-ultra"). Standard tier, context <= 272K,
  // from the Sakana pricing page (https://sakana.ai/fugu): $5 input / $30 output /
  // $0.50 cached input per 1M tokens. The API is OpenAI-compatible and bills no
  // separate cache-write, and Codex never reports cache-write tokens, so
  // cacheWriteCost is null. The >272K tier ($10/$45/$1.00) is not modelled because
  // per-request context size is not retained in usage rows.
  "sakana:fugu-ultra": {
    inputCost: 5,
    outputCost: 30,
    cacheReadCost: 0.5,
    cacheWriteCost: null,
  },
}
