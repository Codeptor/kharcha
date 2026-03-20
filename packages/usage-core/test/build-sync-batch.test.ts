import { describe, expect, it } from "bun:test"
import { buildSyncBatch } from "../src/build-sync-batch"

describe("buildSyncBatch", () => {
  it("deduplicates rows and freezes pricing snapshots", async () => {
    const batch = await buildSyncBatch(
      [
        {
          source: "opencode",
          provider: "vercel",
          model: "anthropic/claude-sonnet-4.6",
          day: "2026-03-20",
          startedAt: "2026-03-20T10:00:00.000Z",
          inputTokens: 1_000_000,
          outputTokens: 2_000_000,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          exactCostUsd: null,
          sourceSessionHash: "abc123",
        },
        {
          source: "opencode",
          provider: "vercel",
          model: "anthropic/claude-sonnet-4.6",
          day: "2026-03-20",
          startedAt: "2026-03-20T10:00:00.000Z",
          inputTokens: 1_000_000,
          outputTokens: 2_000_000,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          exactCostUsd: null,
          sourceSessionHash: "abc123",
        },
      ],
      new Map([
        [
          "anthropic:claude-sonnet-4-6",
          {
            inputCost: 2,
            outputCost: 3,
            cacheReadCost: 4,
            cacheWriteCost: 5,
          },
        ],
      ]),
    )

    expect(batch.rows).toHaveLength(1)
    expect(batch.rows[0]).toMatchObject({
      source: "opencode",
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      costUsd: 16,
      pricingMode: "estimated",
    })
    expect(batch.pricingSnapshots).toHaveLength(1)
    expect(batch.pricingSnapshots[0]).toMatchObject({
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      inputCost: 2,
      outputCost: 3,
    })
  })
})
