import type { PricingSnapshot } from "../types"

/**
 * Provider-published pricing for models that models.dev does not list. Keyed
 * by `${normalizedProvider}:${normalizedModel}` (see normalizeModelKey); costs
 * are USD per 1,000,000 tokens, matching the models.dev catalog and
 * freezePricing. Applied as an override on top of the fetched catalog at sync
 * time, so an entry here replaces the catalog's rate (and its context tiers):
 * add one only when the catalog has no usable entry.
 */
export const CUSTOM_PRICING: Record<string, PricingSnapshot> = {
  // Moonshot AI (Kimi) API pricing; models.dev dropped kimi-k2.5, which is what
  // the Kimi CLI reports. No published cache-write rate.
  // https://platform.moonshot.ai/docs/pricing/chat
  "moonshotai:kimi-k2.5": {
    inputCost: 0.6,
    outputCost: 3,
    cacheReadCost: 0.1,
    cacheWriteCost: null,
  },

  // OpenCode's Union Alpha was free for its one-week run; models.dev added it
  // at $0 (e3626b49, 2026-09-16) and removed it as expired (14f892c0).
  "opencode:union-alpha": {
    inputCost: 0,
    outputCost: 0,
    cacheReadCost: 0,
    cacheWriteCost: 0,
  },
}
