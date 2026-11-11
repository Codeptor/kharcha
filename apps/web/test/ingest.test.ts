import { describe, expect, it } from "bun:test"
import {
  getAffectedDays,
  parseSyncBatch,
  rollupRowsByDay,
} from "@/lib/db/ingest"

describe("rollupRowsByDay", () => {
  it("groups costs by day, provider, and model", () => {
    const rows = [
      {
        day: "2026-03-20",
        provider: "anthropic",
        model: "claude-opus-4-6",
        costUsd: 1.2,
      },
      {
        day: "2026-03-20",
        provider: "anthropic",
        model: "claude-opus-4-6",
        costUsd: 0.3,
      },
    ]

    expect(rollupRowsByDay(rows)).toEqual([
      {
        day: "2026-03-20",
        provider: "anthropic",
        model: "claude-opus-4-6",
        costUsd: 1.5,
      },
    ])
  })
})

describe("parseSyncBatch", () => {
  it("validates batch rows and pricing snapshots", () => {
    expect(
      parseSyncBatch({
        generatedAt: "2026-03-20T00:00:00.000Z",
        pricingSnapshots: [
          {
            snapshotKey: "snap-1",
            provider: "anthropic",
            model: "claude-opus-4-6",
            inputCost: 1,
            outputCost: 2,
            cacheReadCost: null,
            cacheWriteCost: null,
          },
        ],
        rows: [
          {
            dedupeKey: "row-1",
            source: "opencode",
            provider: "anthropic",
            model: "claude-opus-4-6",
            day: "2026-03-20",
            costUsd: 1.5,
            pricingMode: "exact",
            pricingSnapshotKey: null,
          },
        ],
      })
    ).toEqual({
      generatedAt: "2026-03-20T00:00:00.000Z",
      pricingSnapshots: [
        {
          snapshotKey: "snap-1",
          provider: "anthropic",
          model: "claude-opus-4-6",
          inputCost: 1,
          outputCost: 2,
          cacheReadCost: null,
          cacheWriteCost: null,
          tiers: null,
        },
      ],
      rows: [
        {
          dedupeKey: "row-1",
          source: "opencode",
          provider: "anthropic",
          model: "claude-opus-4-6",
          day: "2026-03-20",
          costUsd: 1.5,
          pricingMode: "exact",
          pricingSnapshotKey: null,
          inputTokens: null,
          outputTokens: null,
          cacheReadTokens: null,
          cacheWriteTokens: null,
          aggregateTokens: null,
        },
      ],
      hourBuckets: [],
    })
  })
})

describe("parseSyncBatch tiers", () => {
  const batch = (tiers: unknown) => ({
    generatedAt: "2026-03-20T00:00:00.000Z",
    pricingSnapshots: [
      {
        snapshotKey: "snap-1",
        provider: "anthropic",
        model: "claude-sonnet-4-5",
        inputCost: 3,
        outputCost: 15,
        cacheReadCost: null,
        cacheWriteCost: null,
        tiers,
      },
    ],
    rows: [],
  })

  it("keeps valid tiers and rejects malformed ones", () => {
    const tiers = [
      {
        promptTokensAbove: 200000,
        inputCost: 6,
        outputCost: 22.5,
        cacheReadCost: null,
        cacheWriteCost: 7.5,
      },
    ]
    expect(parseSyncBatch(batch(tiers)).pricingSnapshots[0]?.tiers).toEqual(
      tiers
    )
    expect(parseSyncBatch(batch(null)).pricingSnapshots[0]?.tiers).toBeNull()
    expect(() => parseSyncBatch(batch([{ ...tiers[0], inputCost: "6" }]))).toThrow(
      "Invalid sync batch"
    )
    expect(() => parseSyncBatch(batch("flat"))).toThrow("Invalid sync batch")
  })
})

describe("getAffectedDays", () => {
  it("returns unique sorted days from incoming rows", () => {
    expect(
      getAffectedDays([
        { day: "2026-03-21" },
        { day: "2026-03-20" },
        { day: "2026-03-21" },
      ])
    ).toEqual(["2026-03-20", "2026-03-21"])
  })
})
