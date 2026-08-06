import type { PricingSnapshot } from "../types"

/**
 * Provider-published pricing for models that models.dev either does not list
 * or where we want the sync path to prefer an official fixed rate. Keyed by
 * `${normalizedProvider}:${normalizedModel}` (see normalizeModelKey); costs are
 * USD per 1,000,000 tokens, matching the models.dev catalog and freezePricing.
 * Applied as an override on top of the fetched catalog at sync time.
 */
export const CUSTOM_PRICING: Record<string, PricingSnapshot> = {
  // OpenAI API pricing:
  // https://developers.openai.com/api/docs/pricing
  "openai:gpt-5.4": {
    inputCost: 2.5,
    outputCost: 15,
    cacheReadCost: 0.25,
    cacheWriteCost: null,
  },
  "openai:gpt-5.4-mini": {
    inputCost: 0.75,
    outputCost: 4.5,
    cacheReadCost: 0.075,
    cacheWriteCost: null,
  },
  "openai:gpt-5.5": {
    inputCost: 5,
    outputCost: 30,
    cacheReadCost: 0.5,
    cacheWriteCost: null,
  },

  // Anthropic API pricing and prompt-caching multipliers:
  // https://docs.anthropic.com/en/docs/about-claude/pricing
  // https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching
  "anthropic:claude-fable-5": {
    inputCost: 10,
    outputCost: 50,
    cacheReadCost: 1,
    cacheWriteCost: 12.5,
  },
  "anthropic:claude-opus-4-8": {
    inputCost: 5,
    outputCost: 25,
    cacheReadCost: 0.5,
    cacheWriteCost: 6.25,
  },
  "anthropic:claude-opus-4-7": {
    inputCost: 5,
    outputCost: 25,
    cacheReadCost: 0.5,
    cacheWriteCost: 6.25,
  },
  "anthropic:claude-opus-4-6": {
    inputCost: 5,
    outputCost: 25,
    cacheReadCost: 0.5,
    cacheWriteCost: 6.25,
  },
  "anthropic:claude-opus-4-5-20251101": {
    inputCost: 5,
    outputCost: 25,
    cacheReadCost: 0.5,
    cacheWriteCost: 6.25,
  },
  "anthropic:claude-sonnet-4-6": {
    inputCost: 3,
    outputCost: 15,
    cacheReadCost: 0.3,
    cacheWriteCost: 3.75,
  },
  "anthropic:claude-sonnet-4-5-20250929": {
    inputCost: 3,
    outputCost: 15,
    cacheReadCost: 0.3,
    cacheWriteCost: 3.75,
  },
  "anthropic:claude-haiku-4-5-20251001": {
    inputCost: 1,
    outputCost: 5,
    cacheReadCost: 0.1,
    cacheWriteCost: 1.25,
  },

  // Meta Muse Spark — Model API pricing (spirit — correct):
  // https://developer.meta.com/ai/products/meta-model-api
  // Standard: not used to improve products; Contributor: used to improve products.
  "meta:muse-spark-1.1": {
    inputCost: 1.25,
    outputCost: 4.25,
    cacheReadCost: 0.15,
    cacheWriteCost: null,
  },
  "meta:muse-spark-1.2": {
    inputCost: 1.25,
    outputCost: 4.25,
    cacheReadCost: 0.15,
    cacheWriteCost: null,
  },
  "meta:muse-spark-1.2-contributor": {
    inputCost: 0.1,
    outputCost: 0.2,
    cacheReadCost: 0.002,
    cacheWriteCost: null,
  },

  // Sakana Fugu Ultra fixed token pricing:
  // https://sakana.ai/fugu/
  "sakana:fugu-ultra": {
    inputCost: 5,
    outputCost: 30,
    cacheReadCost: 0.5,
    cacheWriteCost: null,
  },
}
