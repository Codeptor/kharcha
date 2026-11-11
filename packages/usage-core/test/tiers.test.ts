import { describe, expect, it } from "bun:test"
import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { runTokenWindow } from "../src/token-window"
import { freezePricing } from "../src/pricing/freeze-pricing"
import { parseModelsDevCatalog } from "../src/pricing/models-dev"

const tieredMatch = {
  inputCost: 1,
  outputCost: 10,
  cacheReadCost: 0.1,
  cacheWriteCost: 1.25,
  tiers: [
    {
      promptTokensAbove: 200_000,
      inputCost: 2,
      outputCost: 15,
      cacheReadCost: 0.2,
      cacheWriteCost: 2.5,
    },
  ],
}

describe("long-context tiers", () => {
  it("prices a request above the threshold at the tier and one at or below at base", () => {
    const base = {
      exactCostUsd: null,
      pricingMatch: tieredMatch,
      outputTokens: 1_000_000,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    }
    const below = freezePricing({ ...base, inputTokens: 200_000 })
    const above = freezePricing({ ...base, inputTokens: 200_001 })

    expect(below.costUsd).toBeCloseTo(0.2 + 10, 9)
    expect(above.costUsd).toBeCloseTo((200_001 / 1_000_000) * 2 + 15, 9)
  })

  it("keeps cost.tiers and maps context_over_200k to a 200K tier", () => {
    const rows = parseModelsDevCatalog({
      p: {
        models: {
          tiered: {
            cost: {
              input: 0.1,
              output: 0.5,
              cache_read: 0.01,
              cache_write: 0.125,
              tiers: [{ input: 0.5, output: 2.5, tier: { type: "context", size: 100_000 } }],
            },
          },
          legacy: {
            cost: {
              input: 1,
              output: 2,
              context_over_200k: { input: 3, output: 4, cache_read: 0.3, cache_write: 3.75 },
            },
          },
          flat: { cost: { input: 1, output: 2 } },
        },
      },
    })

    expect(rows[0]?.tiers).toEqual([
      {
        promptTokensAbove: 100_000,
        inputCost: 0.5,
        outputCost: 2.5,
        cacheReadCost: 0.01,
        cacheWriteCost: 0.125,
      },
    ])
    expect(rows[1]?.tiers).toEqual([
      { promptTokensAbove: 200_000, inputCost: 3, outputCost: 4, cacheReadCost: 0.3, cacheWriteCost: 3.75 },
    ])
    expect(rows[2]?.tiers).toBeUndefined()
  })

  it("prices Claude Code responses by their own prompt, not the band's summed cache reads", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kharcha-tiers-"))
    const when = new Date(Date.now() - 36 * 3_600_000).toISOString()
    const line = (n: number) =>
      JSON.stringify({
        timestamp: when,
        requestId: `r${n}`,
        message: {
          id: `m${n}`,
          model: "claude-sonnet-4-6",
          usage: { input_tokens: 1000, output_tokens: 1000, cache_read_input_tokens: 60_000 },
        },
      })
    await writeFile(join(dir, "s.jsonl"), [1, 2, 3].map(line).join("\n") + "\n")
    const tiered = { ...tieredMatch, tiers: [{ ...tieredMatch.tiers[0]!, promptTokensAbove: 100_000 }] }
    await writeFile(
      join(dir, "pricing.json"),
      JSON.stringify({ catalog: { "anthropic:claude-sonnet-4-6": tiered } })
    )

    const window = await runTokenWindow({
      root: dir,
      windowDays: 3,
      cachePath: null,
      pricingPath: join(dir, "pricing.json"),
    })

    // Each response has a 61K prompt (base rates) although the cache reads sum to 180K.
    const expected = 3 * ((1000 / 1e6) * 1 + (1000 / 1e6) * 10 + (60_000 / 1e6) * 0.1)
    expect(window.models[0]?.costUsd).toBeCloseTo(expected, 9)
  })
})
