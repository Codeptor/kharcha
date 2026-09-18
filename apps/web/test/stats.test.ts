import { describe, expect, it } from "bun:test"
import { buildChartData } from "../lib/dashboard/chart-shape"
import { computeModelStats, computeUsageMetrics } from "../lib/dashboard/stats"

describe("computeUsageMetrics", () => {
  it("tracks token totals and pricing coverage", () => {
    const chart = buildChartData([
      {
        day: "2026-03-20",
        source: "codex",
        provider: "openai",
        model: "gpt-5.5",
        costUsd: "1.25",
        pricingMode: "estimated",
        inputTokens: 1000,
        outputTokens: 200,
        cacheReadTokens: 3000,
        cacheWriteTokens: null,
        createdAt: null,
      },
      {
        day: "2026-03-20",
        source: "codex",
        provider: "sakana",
        model: "fugu",
        costUsd: "0",
        pricingMode: "unpriced",
        inputTokens: null,
        outputTokens: null,
        cacheReadTokens: null,
        cacheWriteTokens: null,
        aggregateTokens: 1000,
        createdAt: null,
      },
    ])

    const metrics = computeUsageMetrics(chart.days)

    expect(metrics.totalTokens).toBe(5200)
    expect(metrics.pricedTokens).toBe(4200)
    expect(metrics.unpricedTokens).toBe(1000)
    expect(metrics.aggregate).toBe(1000)
    expect(metrics.input).toBe(1000)
    expect(metrics.pricedCoverage).toBeCloseTo(4200 / 5200, 6)
    expect(metrics.unpricedNonzeroRows).toBe(1)
    expect(metrics.modeStats.map((m) => m.mode)).toEqual([
      "estimated",
      "unpriced",
    ])
  })
})

describe("computeModelStats", () => {
  const base = {
    day: "2026-03-20",
    source: "kimi",
    costUsd: "0",
    pricingMode: "unpriced",
    inputTokens: null,
    outputTokens: null,
    cacheReadTokens: null,
    cacheWriteTokens: null,
    createdAt: null,
  }
  const chart = buildChartData([
    {
      ...base,
      provider: "moonshotai",
      model: "kimi-k2.5",
      inputTokens: 72_000,
    },
    { ...base, provider: "nvidia", model: "z-ai/glm-5.1", inputTokens: 4_000 },
    {
      ...base,
      source: "codex",
      provider: "openai",
      model: "gpt-5.5",
      costUsd: "1.25",
      pricingMode: "estimated",
      inputTokens: 1_000,
    },
    {
      ...base,
      source: "codex",
      provider: "openai",
      model: "fugu-ultra",
      inputTokens: 122_000,
    },
    {
      ...base,
      source: "codex",
      provider: "openai",
      model: "fugu-ultra",
      costUsd: "0.30",
      pricingMode: "exact",
      inputTokens: 1_000,
    },
  ])
  const stats = computeModelStats(chart.days)
  const byKey = new Map(stats.map((s) => [s.key, s]))

  it("orders by cost and then by tokens so unpriced models stay ranked", () => {
    expect(stats.map((s) => s.key)).toEqual([
      "openai:gpt-5.5",
      "openai:fugu-ultra",
      "moonshotai:kimi-k2.5",
      "nvidia:z-ai/glm-5.1",
    ])
  })

  it("reports n/a cost per million for a fully unpriced model", () => {
    const kimi = byKey.get("moonshotai:kimi-k2.5")!
    expect(kimi.costUsd).toBe(0)
    expect(kimi.unpricedTokens).toBe(72_000)
    expect(kimi.costPerMillionTokens).toBeNull()
  })

  it("keeps a rate and the unpriced token count for a partly priced model", () => {
    const fugu = byKey.get("openai:fugu-ultra")!
    expect(fugu.costUsd).toBeCloseTo(0.3, 10)
    expect(fugu.unpricedTokens).toBe(122_000)
    expect(fugu.costPerMillionTokens).toBeCloseTo(
      (0.3 / 123_000) * 1_000_000,
      6
    )
  })
})
