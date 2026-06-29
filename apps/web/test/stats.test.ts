import { describe, expect, it } from "bun:test"
import { buildChartData } from "../lib/dashboard/chart-shape"
import { computeUsageMetrics } from "../lib/dashboard/stats"

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
        inputTokens: 500,
        outputTokens: 100,
        cacheReadTokens: 400,
        cacheWriteTokens: null,
        createdAt: null,
      },
    ])

    const metrics = computeUsageMetrics(chart.days)

    expect(metrics.totalTokens).toBe(5200)
    expect(metrics.pricedTokens).toBe(4200)
    expect(metrics.unpricedTokens).toBe(1000)
    expect(metrics.pricedCoverage).toBeCloseTo(4200 / 5200, 6)
    expect(metrics.unpricedNonzeroRows).toBe(1)
    expect(metrics.modeStats.map((m) => m.mode)).toEqual([
      "estimated",
      "unpriced",
    ])
  })
})
