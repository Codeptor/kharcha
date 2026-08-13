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
  // Legacy alias: Claude Code logs via ANTHROPIC_BASE_URL still emit
  // provider "anthropic" before normalizeModelKey routes muse-* to "meta".
  // Keep both keys priced so already-synced rows aren't stuck unpriced.
  "anthropic:muse-spark-1.1": {
    inputCost: 1.25,
    outputCost: 4.25,
    cacheReadCost: 0.15,
    cacheWriteCost: null,
  },
  "anthropic:muse-spark-1.2": {
    inputCost: 1.25,
    outputCost: 4.25,
    cacheReadCost: 0.15,
    cacheWriteCost: null,
  },
  "anthropic:muse-spark-1.2-contributor": {
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

  // Alibaba Cloud Model Studio (QwenCloud) — models served on the Anthropic-
  // compatible endpoint that the international models.dev catalog does not
  // list under `alibaba` but are published on the CN mirror. Per 1M tokens.
  // The `alibaba` catalog prices are mirrored onto `qwencloud:*` keys in
  // loadPricingLookup (scripts/sync.ts); this overrides the gaps.
  "qwencloud:deepseek-v4-pro": {
    inputCost: 0.435,
    outputCost: 0.87,
    cacheReadCost: 0.003625,
    cacheWriteCost: null,
  },
  "qwencloud:deepseek-v4-flash": {
    inputCost: 0.14,
    outputCost: 0.28,
    cacheReadCost: 0.0028,
    cacheWriteCost: null,
  },
  "qwencloud:glm-5": {
    inputCost: 0.86,
    outputCost: 3.15,
    cacheReadCost: null,
    cacheWriteCost: null,
  },
  "qwencloud:glm-5.1": {
    inputCost: 0.87,
    outputCost: 3.48,
    cacheReadCost: 0.17,
    cacheWriteCost: null,
  },
}
