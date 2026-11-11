export type PricingMode = "exact" | "estimated" | "unpriced"

export type NormalizedModelKey = {
  provider: string
  model: string
}

export type PricingTier = {
  /** Applies to a request whose prompt (input + cache-read + cache-write tokens) is strictly greater than this. */
  promptTokensAbove: number
  inputCost: number | null
  outputCost: number | null
  cacheReadCost: number | null
  cacheWriteCost: number | null
}

export type PricingSnapshot = {
  inputCost: number | null
  outputCost: number | null
  cacheReadCost: number | null
  cacheWriteCost: number | null
  /** Ascending by promptTokensAbove. Absent (undefined) for flat pricing; never an empty array. */
  tiers?: PricingTier[]
}

export type UsageSlice = {
  source: "claude-code" | "codex" | "opencode" | "kimi" | "agy" | "omp" | "dsh"
  provider: string
  model: string
  day: string
  startedAt: string | null
  inputTokens: number | null
  outputTokens: number | null
  cacheReadTokens: number | null
  cacheWriteTokens: number | null
  cacheWrite1hTokens?: number | null
  aggregateTokens?: number | null
  exactCostUsd: number | null
  preventEstimatedCost?: boolean
  requiresCacheWritePricing?: boolean
  sourceSessionHash: string
}
