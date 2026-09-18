import { describe, expect, it } from "bun:test"
import {
  buildChartData,
  isUnpricedSegment,
  sortSegmentsByCost,
} from "../lib/dashboard/chart-shape"

describe("buildChartData", () => {
  it("groups rows by day and totals costs", () => {
    const result = buildChartData([
      {
        day: "2026-03-20",
        source: "claude-code",
        provider: "anthropic",
        model: "claude-opus-4-6",
        costUsd: "1.50",
        pricingMode: "estimated",
        inputTokens: 1000,
        outputTokens: 200,
        cacheReadTokens: 3000,
        cacheWriteTokens: 400,
        createdAt: null,
      },
      {
        day: "2026-03-20",
        source: "codex",
        provider: "google",
        model: "gemini-3.1-pro-preview-customtools",
        costUsd: "2.00",
        pricingMode: "exact",
        inputTokens: 500,
        outputTokens: 100,
        cacheReadTokens: null,
        cacheWriteTokens: null,
        createdAt: null,
      },
    ])

    expect(result.lifetimeTotalUsd).toBe(3.5)
    expect(result.days).toHaveLength(1)
    expect(result.days[0]?.segments).toHaveLength(2)
    expect(result.days[0]?.segments[0]?.modeTotals).toHaveLength(1)
  })
})

function row(
  overrides: Partial<Parameters<typeof buildChartData>[0][number]> & {
    provider: string
    model: string
  }
) {
  return {
    day: "2026-03-20",
    source: "kimi",
    costUsd: "0",
    pricingMode: "unpriced",
    inputTokens: null,
    outputTokens: null,
    cacheReadTokens: null,
    cacheWriteTokens: null,
    createdAt: null,
    ...overrides,
  }
}

describe("isUnpricedSegment", () => {
  const { days } = buildChartData([
    row({
      provider: "moonshotai",
      model: "kimi-k2.5",
      inputTokens: 50_000,
      outputTokens: 2_000,
    }),
    row({
      provider: "openai",
      model: "gpt-5.5",
      source: "codex",
      costUsd: "1.25",
      pricingMode: "estimated",
      inputTokens: 1_000,
    }),
    row({
      provider: "anthropic",
      model: "claude-opus-4-6",
      source: "claude-code",
      costUsd: "0",
      pricingMode: "exact",
      inputTokens: 300,
    }),
    row({ provider: "acme", model: "empty" }),
  ])
  const byKey = new Map(days[0]!.segments.map((s) => [s.key, s]))

  it("flags a $0 segment whose tokens are all unpriced", () => {
    expect(isUnpricedSegment(byKey.get("moonshotai:kimi-k2.5")!)).toBe(true)
  })

  it("ignores priced segments, free exact rows, and token-less rows", () => {
    expect(isUnpricedSegment(byKey.get("openai:gpt-5.5")!)).toBe(false)
    expect(isUnpricedSegment(byKey.get("anthropic:claude-opus-4-6")!)).toBe(
      false
    )
    expect(isUnpricedSegment(byKey.get("acme:empty")!)).toBe(false)
  })

  it("does not flag a segment that mixes unpriced rows with a real cost", () => {
    const mixed = buildChartData([
      row({ provider: "openai", model: "fugu-ultra", inputTokens: 100 }),
      row({
        provider: "openai",
        model: "fugu-ultra",
        costUsd: "0.02",
        pricingMode: "exact",
        inputTokens: 10,
      }),
    ]).days[0]!.segments[0]!
    expect(mixed.costUsd).toBeCloseTo(0.02, 10)
    expect(isUnpricedSegment(mixed)).toBe(false)
  })
})

describe("sortSegmentsByCost", () => {
  it("orders by cost, then by total tokens, without mutating the input", () => {
    const { days } = buildChartData([
      row({ provider: "a", model: "small-unpriced", inputTokens: 10 }),
      row({
        provider: "b",
        model: "priced",
        costUsd: "0.50",
        pricingMode: "estimated",
        inputTokens: 5,
      }),
      row({
        provider: "c",
        model: "big-unpriced",
        inputTokens: 1_000,
        aggregateTokens: 500,
      }),
      row({
        provider: "d",
        model: "cheap",
        costUsd: "0.10",
        pricingMode: "exact",
        cacheReadTokens: 999_999,
      }),
    ])
    const segments = days[0]!.segments
    const before = segments.map((s) => s.key)

    expect(sortSegmentsByCost(segments).map((s) => s.key)).toEqual([
      "b:priced",
      "d:cheap",
      "c:big-unpriced",
      "a:small-unpriced",
    ])
    expect(segments.map((s) => s.key)).toEqual(before)
  })
})
