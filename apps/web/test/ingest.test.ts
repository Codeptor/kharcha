import { describe, expect, it } from "bun:test"
import { getAffectedDays, parseSyncBatch, rollupRowsByDay } from "@/lib/db/ingest"

describe("rollupRowsByDay", () => {
  it("groups costs by day, provider, and model", () => {
    const rows = [
      { day: "2026-03-20", provider: "anthropic", model: "claude-opus-4-6", costUsd: 1.2 },
      { day: "2026-03-20", provider: "anthropic", model: "claude-opus-4-6", costUsd: 0.3 },
    ]

    expect(rollupRowsByDay(rows)).toEqual([
      { day: "2026-03-20", provider: "anthropic", model: "claude-opus-4-6", costUsd: 1.5 },
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
      }),
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
        },
      ],
      hourBuckets: [],
    })
  })
})

describe("getAffectedDays", () => {
  it("returns unique sorted days from incoming rows", () => {
    expect(
      getAffectedDays([
        { day: "2026-03-21" },
        { day: "2026-03-20" },
        { day: "2026-03-21" },
      ]),
    ).toEqual(["2026-03-20", "2026-03-21"])
  })
})
