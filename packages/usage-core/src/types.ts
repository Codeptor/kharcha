export type PricingMode = "exact" | "estimated" | "unpriced"

export type NormalizedModelKey = {
  provider: string
  model: string
}

export type PricingSnapshot = {
  inputCost: number | null
  outputCost: number | null
  cacheReadCost: number | null
  cacheWriteCost: number | null
}

export type UsageSlice = {
  source: "claude-code" | "codex" | "opencode"
  provider: string
  model: string
  day: string
  startedAt: string | null
  inputTokens: number | null
  outputTokens: number | null
  cacheReadTokens: number | null
  cacheWriteTokens: number | null
  exactCostUsd: number | null
  sourceSessionHash: string
}
