import { describe, expect, it } from "bun:test"
import { mkdtemp, readdir, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { buildSyncBatch } from "../src/build-sync-batch"
import { openCatalogArchive, writeCatalogArchive } from "../src/pricing/catalog-archive"
import { createDatedPricing } from "../src/pricing/dated-pricing"
import type { PeakRule } from "../src/pricing/price-history"
import type { UsageSlice } from "../src/types"

const slice = (over: Partial<UsageSlice>): UsageSlice => ({
  source: "opencode",
  provider: "acme",
  model: "m",
  day: "2026-09-14",
  startedAt: null,
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  exactCostUsd: null,
  sourceSessionHash: Math.random().toString(36),
  ...over,
})

const catalog = (provider: string, model: string, cost: Record<string, number>) => ({
  [provider]: { models: { [model]: { cost } } },
})

const costOf = async (dir: string, rows: UsageSlice[], peakRules: PeakRule[] = []) => {
  const dated = createDatedPricing({ archiveDir: dir, peakRules })
  const batch = await buildSyncBatch(rows, dated.resolve)
  return batch.rows.map(row => ({ cost: row.costUsd, mode: row.pricingMode }))
}

describe("dated pricing", () => {
  it("prices Sonnet 5.5 cache reads at $0.20 before 2026-10-07 and $0.10 from then on", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kharcha-dated-"))
    writeCatalogArchive(
      dir,
      catalog("anthropic", "claude-sonnet-5-5", { input: 2, output: 10, cache_read: 0.1, cache_write: 2.5 }),
      new Date(2026, 9, 20, 12),
      1
    )
    const read = (day: string, startedAt: string) =>
      slice({ provider: "anthropic", model: "claude-sonnet-5-5", day, startedAt, cacheReadTokens: 1_000_000 })
    const costs = await costOf(dir, [read("2026-10-06", "2026-10-06T23:59:59Z"), read("2026-10-07", "2026-10-07T00:00:00Z")])
    expect(costs.map(c => c.cost)).toEqual([0.2, 0.1])
  })

  it("uses the newest archived catalog at or before the day, else the oldest", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kharcha-dated-"))
    writeCatalogArchive(dir, catalog("acme", "m", { input: 1, output: 1 }), new Date(2026, 7, 1, 12), 1)
    writeCatalogArchive(dir, catalog("acme", "m", { input: 2, output: 2 }), new Date(2026, 8, 1, 12), 1)
    const day = (d: string) => slice({ day: d, inputTokens: 1_000_000 })
    const costs = await costOf(dir, [day("2026-08-15"), day("2026-09-02"), day("2026-07-01")])
    expect(costs.map(c => c.cost)).toEqual([1, 2, 1])
  })

  it("applies a peak rule to in-window weekday slices and ignores logged cost from its start", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kharcha-dated-"))
    writeCatalogArchive(dir, catalog("acme", "m", { input: 1, output: 1 }), new Date(2026, 8, 20, 12), 1)
    const rule: PeakRule = {
      provider: "acme",
      from: "2026-09-10T00:00:00Z",
      multiplier: 2,
      windowsUtc: [{ weekdays: [1, 2, 3, 4, 5], startHour: 8, endHour: 16 }],
      excludeDatesUtc8: ["2026-09-15"],
      source: "test",
    }
    const at = (day: string, startedAt: string, exactCostUsd: number | null = null) =>
      slice({ day, startedAt, inputTokens: 1_000_000, exactCostUsd })
    const costs = await costOf(
      dir,
      [
        at("2026-09-14", "2026-09-14T10:00:00Z"), // Monday, in window
        at("2026-09-15", "2026-09-15T10:00:00Z"), // excluded China-local date
        at("2026-09-12", "2026-09-12T10:00:00Z"), // Saturday
        at("2026-09-14", "2026-09-14T17:00:00Z"), // after the window
        at("2026-09-14", "2026-09-14T11:00:00Z", 7), // logged cost ignored from `from`
        at("2026-09-07", "2026-09-07T10:00:00Z", 5), // before `from`: logged cost stands
      ].map((row, i) => ({ ...row, sourceSessionHash: `s${i}` })),
      [rule]
    )
    expect(costs).toEqual([
      { cost: 2, mode: "estimated" },
      { cost: 1, mode: "estimated" },
      { cost: 1, mode: "estimated" },
      { cost: 1, mode: "estimated" },
      { cost: 2, mode: "estimated" },
      { cost: 5, mode: "exact" },
    ])
  })

  it("prices a model that models.dev listed only later at the first listed rate", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kharcha-dated-"))
    writeCatalogArchive(dir, catalog("acme", "other", { input: 9, output: 9 }), new Date(2026, 7, 1, 12), 1)
    writeCatalogArchive(
      dir,
      { acme: { models: { other: { cost: { input: 9, output: 9 } }, m: { cost: { input: 3, output: 3 } } } } },
      new Date(2026, 8, 1, 12),
      1
    )
    const costs = await costOf(dir, [slice({ day: "2026-08-15", inputTokens: 1_000_000 })])
    expect(costs).toEqual([{ cost: 3, mode: "estimated" }])
  })

  it("survives a zero-byte archive file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kharcha-dated-"))
    writeCatalogArchive(dir, catalog("acme", "m", { input: 1, output: 1 }), new Date(2026, 7, 1, 12), 1)
    await writeFile(join(dir, "2026-09-01.json.gz"), "")
    const result = writeCatalogArchive(dir, catalog("acme", "m", { input: 2, output: 2 }), new Date(2026, 8, 5, 12), 1)
    expect(result).toEqual({ file: "2026-09-05.json.gz", written: true })
    expect(openCatalogArchive(dir).dateFor("2026-09-02")).toBe("2026-08-01")
    expect(openCatalogArchive(dir).catalogFor("2026-09-02").map(row => row.inputCost)).toEqual([1])
  })

  it("refuses a payload far smaller than the newest archive", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kharcha-dated-"))
    const models = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`m${i}`, { cost: { input: 1, output: 1 } }]))
    writeCatalogArchive(dir, { acme: { models } }, new Date(2026, 7, 1, 12), 1)
    const before = await readdir(dir)
    expect(() => writeCatalogArchive(dir, catalog("acme", "m0", { input: 1, output: 1 }), new Date(2026, 8, 1, 12), 1)).toThrow()
    expect(await readdir(dir)).toEqual(before)
  })

  it("keeps a logged cost when the peak provider's model has no rate", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kharcha-dated-"))
    writeCatalogArchive(dir, catalog("acme", "m", { input: 1, output: 1 }), new Date(2026, 8, 20, 12), 1)
    const rule: PeakRule = {
      provider: "acme",
      from: "2026-09-10T00:00:00Z",
      multiplier: 2,
      windowsUtc: [{ weekdays: [1, 2, 3, 4, 5], startHour: 8, endHour: 16 }],
      excludeDatesUtc8: [],
      source: "test",
    }
    const row = slice({ model: "ghost", day: "2026-09-14", startedAt: "2026-09-14T10:00:00Z", inputTokens: 1_000_000, exactCostUsd: 4 })
    expect(await costOf(dir, [row], [rule])).toEqual([{ cost: 4, mode: "exact" }])
  })
})
