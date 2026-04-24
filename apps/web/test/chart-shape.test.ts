import { describe, expect, it } from "bun:test"
import { buildChartData } from "../lib/dashboard/chart-shape"

describe("buildChartData", () => {
  it("groups rows by day and totals costs", () => {
    const result = buildChartData([
      {
        day: "2026-03-20",
        source: "claude-code",
        provider: "anthropic",
        model: "claude-opus-4-6",
        costUsd: "1.50",
        createdAt: null,
      },
      {
        day: "2026-03-20",
        source: "codex",
        provider: "google",
        model: "gemini-3.1-pro-preview-customtools",
        costUsd: "2.00",
        createdAt: null,
      },
    ])

    expect(result.lifetimeTotalUsd).toBe(3.5)
    expect(result.days).toHaveLength(1)
    expect(result.days[0]?.segments).toHaveLength(2)
  })
})
