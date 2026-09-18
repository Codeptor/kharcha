import { beforeAll, describe, expect, it } from "bun:test"
import { createHash } from "node:crypto"
import { join } from "node:path"
import { readCodexUsage } from "../src/sources/codex"
import type { UsageSlice } from "../src/types"

const fixturesRoot = join(import.meta.dir, "fixtures/codex")
const sessionsRoot = join(fixturesRoot, "sessions")

const PARENT_ID = "01a05c00-0000-7000-8000-00000000000a"
const FORK_ID = "01a05c00-0000-7000-8000-00000000000b"
const SAKANA_ID = "01a05c00-0000-7000-8000-00000000000c"
const HELD_ID = "01a05c00-0000-7000-8000-00000000000d"
const NO_MODEL_ID = "01a05c00-0000-7000-8000-00000000000e"
const SUFFIX_FORK_ID = "01a05c00-0000-7000-8000-00000000000f"

const forkFile = join(
  sessionsRoot,
  "2026/09/03",
  `rollout-2026-09-03T09-00-00-${FORK_ID}.jsonl`
)

function sessionHash(id: string): string {
  return createHash("sha256").update(id).digest("hex")
}

function bySession(rows: UsageSlice[], id: string): UsageSlice[] {
  return rows.filter((row) => row.sourceSessionHash === sessionHash(id))
}

describe("readCodexUsage", () => {
  let rows: UsageSlice[] = []

  beforeAll(async () => {
    rows = await readCodexUsage(sessionsRoot)
  })

  it("counts a forked rollout's replayed history once, keeping the parent's timestamps", () => {
    const parent = bySession(rows, PARENT_ID)
    const fork = bySession(rows, FORK_ID)

    expect(parent).toHaveLength(3)
    expect(fork).toHaveLength(2)
    expect(parent.map((row) => row.startedAt)).toEqual([
      "2026-09-01T10:00:05.000Z",
      "2026-09-01T10:00:15.000Z",
      "2026-09-01T10:01:10.000Z",
    ])
    expect(parent.every((row) => row.day === "2026-09-01")).toBe(true)
    expect(parent.map((row) => row.model)).toEqual([
      "gpt-5.6-luna",
      "gpt-5.6-luna",
      "gpt-5.6-terra",
    ])
    expect(fork).toEqual([
      expect.objectContaining({
        source: "codex",
        provider: "openai",
        model: "gpt-5.6-terra",
        day: "2026-09-03",
        startedAt: "2026-09-03T09:05:10.000Z",
        inputTokens: 0,
        outputTokens: 500,
        cacheReadTokens: 3000,
        cacheWriteTokens: null,
        exactCostUsd: null,
      }),
      expect.objectContaining({
        startedAt: "2026-09-03T09:06:00.000Z",
        inputTokens: 1000,
        outputTokens: 700,
        cacheReadTokens: 3000,
      }),
    ])
  })

  it("splits uncached input from cache reads using last_token_usage", () => {
    const [first, second, third] = bySession(rows, PARENT_ID)

    expect(first).toMatchObject({
      inputTokens: 1000,
      outputTokens: 300,
      cacheReadTokens: 200,
      cacheWriteTokens: null,
    })
    expect(second).toMatchObject({
      inputTokens: 1000,
      outputTokens: 400,
      cacheReadTokens: 1000,
    })
    expect(third).toMatchObject({
      inputTokens: 500,
      outputTokens: 600,
      cacheReadTokens: 2500,
    })
  })

  it("keeps the session's model_provider so Sakana rows price as sakana", () => {
    const sakana = bySession(rows, SAKANA_ID)

    expect(sakana).toHaveLength(2)
    expect(sakana.every((row) => row.provider === "sakana")).toBe(true)
    expect(sakana.every((row) => row.model === "fugu-ultra")).toBe(true)
    expect(sakana[0]).toMatchObject({
      inputTokens: 4000,
      outputTokens: 800,
      cacheReadTokens: 1000,
      cacheWriteTokens: null,
    })
    expect(sakana[1]).toMatchObject({
      inputTokens: 2000,
      outputTokens: 700,
      cacheReadTokens: 4000,
      cacheWriteTokens: 1500,
    })
  })

  it("assigns turns logged before the first turn_context to the model named later", () => {
    const held = bySession(rows, HELD_ID)

    expect(held).toHaveLength(2)
    expect(held[0]).toMatchObject({
      provider: "openai",
      model: "gpt-5.6-sol",
      startedAt: "2026-09-01T13:00:05.000Z",
      inputTokens: 800,
      outputTokens: 100,
      cacheReadTokens: 0,
    })
    expect(held[1]).toMatchObject({
      model: "gpt-5.6-sol",
      startedAt: "2026-09-01T13:00:10.000Z",
      inputTokens: 1300,
      outputTokens: 200,
      cacheReadTokens: 700,
    })
  })

  it("anchors a replay that starts mid-history to the parent's chain", () => {
    const suffixFork = bySession(rows, SUFFIX_FORK_ID)

    expect(suffixFork).toHaveLength(1)
    expect(suffixFork[0]).toMatchObject({
      model: "gpt-5.6-terra",
      day: "2026-09-03",
      startedAt: "2026-09-03T10:00:30.000Z",
      inputTokens: 0,
      outputTokens: 400,
      cacheReadTokens: 2000,
    })
  })

  it("drops turns from a rollout that never names a model", () => {
    expect(bySession(rows, NO_MODEL_ID)).toHaveLength(0)
    expect(rows).toHaveLength(10)
  })

  it("reads a lone fork file as fresh history when its parent is absent", async () => {
    const rows = await readCodexUsage(forkFile)

    expect(rows).toHaveLength(5)
    expect(rows.every((row) => row.day === "2026-09-03")).toBe(true)
    expect(
      rows.every((row) => row.sourceSessionHash === sessionHash(FORK_ID))
    ).toBe(true)
  })

  it("accepts the Codex home as well as the sessions directory", async () => {
    const fromHome = await readCodexUsage(fixturesRoot)

    expect(fromHome).toEqual(rows)
    expect(fromHome).toHaveLength(10)
  })
})
