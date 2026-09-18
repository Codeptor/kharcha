import { afterEach, beforeAll, describe, expect, it } from "bun:test"
import { createHash } from "node:crypto"
import {
  appendFile,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { readCodexRollouts, readCodexUsage } from "../src/sources/codex"
import type { UsageSlice } from "../src/types"

const fixturesRoot = join(import.meta.dir, "fixtures/codex")
const sessionsRoot = join(fixturesRoot, "sessions")

const PARENT_ID = "01a05c00-0000-7000-8000-00000000000a"
const FORK_ID = "01a05c00-0000-7000-8000-00000000000b"
const SAKANA_ID = "01a05c00-0000-7000-8000-00000000000c"
const HELD_ID = "01a05c00-0000-7000-8000-00000000000d"
const NO_MODEL_ID = "01a05c00-0000-7000-8000-00000000000e"
const SUFFIX_FORK_ID = "01a05c00-0000-7000-8000-00000000000f"
const ALIASED_ID = "01a05c00-0000-7000-8000-000000000010"

const PARENT_FILE = `2026/09/01/rollout-2026-09-01T10-00-00-${PARENT_ID}.jsonl`
const SAKANA_FILE = `2026/09/01/rollout-2026-09-01T12-00-00-${SAKANA_ID}.jsonl`
const FORK_FILE = `2026/09/03/rollout-2026-09-03T09-00-00-${FORK_ID}.jsonl`
const NO_MODEL_FILE = `2026/09/01/rollout-2026-09-01T14-00-00-${NO_MODEL_ID}.jsonl`
const ALIASED_FILE = `2026/09/04/rollout-2026-09-04T09-00-00-${ALIASED_ID}.jsonl`

const forkFile = join(sessionsRoot, FORK_FILE)

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

type CacheEntry = {
  size: number
  mtimeMs: number
  provider: string
  sessionHash: string
  dropped: number
  keys: string[]
  anchors: [string, string][]
  turns: [string | null, string, number, number, number, number][]
}

type CacheFile = { version: number; files: Record<string, CacheEntry> }

function jsonl(lines: object[]): string {
  return lines.map((line) => JSON.stringify(line)).join("\n") + "\n"
}

function tokenCount(
  timestamp: string,
  total: Record<string, number>,
  last: Record<string, number>
) {
  return {
    timestamp,
    type: "event_msg",
    payload: {
      type: "token_count",
      info: { total_token_usage: total, last_token_usage: last },
      rate_limits: null,
    },
  }
}

describe("readCodexUsage cache", () => {
  const tmpDirs: string[] = []

  afterEach(async () => {
    await Promise.all(
      tmpDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))
    )
  })

  async function copyFixtures() {
    const dir = await mkdtemp(join(tmpdir(), "kharcha-codex-"))
    tmpDirs.push(dir)
    const sessions = join(dir, "sessions")
    await cp(sessionsRoot, sessions, { recursive: true })
    return { sessions, cachePath: join(dir, "cache", "codex-rollouts.json") }
  }

  async function readCache(cachePath: string): Promise<CacheFile> {
    return JSON.parse(await readFile(cachePath, "utf8")) as CacheFile
  }

  it("writes the cache and returns the rows of an uncached read", async () => {
    const { sessions, cachePath } = await copyFixtures()
    const cold = await readCodexUsage(sessions)

    const first = await readCodexRollouts(sessions, { cachePath })
    expect(first.rows).toEqual(cold)
    expect(first).toMatchObject({ filesRead: 6, filesCached: 0 })

    const cache = await readCache(cachePath)
    expect(cache.version).toBe(1)
    expect(Object.keys(cache.files)).toHaveLength(6)
    const parent = cache.files[join(sessions, PARENT_FILE)]!
    const parentStat = await stat(join(sessions, PARENT_FILE))
    expect(parent).toMatchObject({
      size: parentStat.size,
      mtimeMs: parentStat.mtimeMs,
      provider: "openai",
      sessionHash: sessionHash(PARENT_ID),
      dropped: 0,
    })
    expect(parent.keys).toHaveLength(3)
    expect(parent.keys.every((key) => /^[0-9a-f]{32}$/u.test(key))).toBe(true)
    expect(parent.anchors.map(([, key]) => key)).toEqual(parent.keys)
    expect(parent.turns).toHaveLength(3)
    // The fork only owns the two turns that were not replayed history.
    expect(cache.files[join(sessions, FORK_FILE)]!.keys).toHaveLength(2)
    expect(cache.files[join(sessions, FORK_FILE)]!.turns).toHaveLength(2)
    expect(cache.files[join(sessions, NO_MODEL_FILE)]).toMatchObject({
      dropped: 1,
      turns: [],
    })

    const second = await readCodexRollouts(sessions, { cachePath })
    expect(second.rows).toEqual(cold)
    expect(second).toMatchObject({ filesRead: 0, filesCached: 6 })
  })

  it("serves an unchanged file from the cache without reading its bytes", async () => {
    const { sessions, cachePath } = await copyFixtures()
    const file = join(sessions, SAKANA_FILE)
    const pinned = new Date("2026-09-01T12:30:00Z")
    await utimes(file, pinned, pinned)
    const cold = await readCodexUsage(sessions)
    await readCodexUsage(sessions, { cachePath })

    const { size } = await stat(file)
    await writeFile(file, "x".repeat(size))
    await utimes(file, pinned, pinned)
    expect(await stat(file)).toMatchObject({ size, mtimeMs: pinned.getTime() })
    // Reading the garbage would lose the two Sakana rows.
    expect(await readCodexUsage(sessions)).toHaveLength(cold.length - 2)

    const warm = await readCodexRollouts(sessions, { cachePath })
    expect(warm.rows).toEqual(cold)
    expect(warm).toMatchObject({ filesRead: 0, filesCached: 6 })
  })

  it("re-reads a rollout that grew and keeps its forks deduped", async () => {
    const { sessions, cachePath } = await copyFixtures()
    await readCodexUsage(sessions, { cachePath })

    const parentFile = join(sessions, PARENT_FILE)
    await appendFile(
      parentFile,
      jsonl([
        {
          timestamp: "2026-09-01T10:02:00.000Z",
          type: "turn_context",
          payload: { turn_id: "a3", model: "gpt-5.6-terra" },
        },
        tokenCount(
          "2026-09-01T10:02:10.000Z",
          {
            input_tokens: 7700,
            cached_input_tokens: 4700,
            cache_write_input_tokens: 0,
            output_tokens: 1800,
            reasoning_output_tokens: 550,
            total_tokens: 9500,
          },
          {
            input_tokens: 1500,
            cached_input_tokens: 1000,
            cache_write_input_tokens: 0,
            output_tokens: 500,
            reasoning_output_tokens: 100,
            total_tokens: 2000,
          }
        ),
      ])
    )

    const warm = await readCodexRollouts(sessions, { cachePath })
    expect(warm).toMatchObject({ filesRead: 1, filesCached: 5 })
    expect(warm.rows).toEqual(await readCodexUsage(sessions))
    expect(warm.rows).toHaveLength(11)
    const parent = bySession(warm.rows, PARENT_ID)
    expect(parent).toHaveLength(4)
    expect(parent[3]).toMatchObject({
      model: "gpt-5.6-terra",
      day: "2026-09-01",
      startedAt: "2026-09-01T10:02:10.000Z",
      inputTokens: 500,
      outputTokens: 500,
      cacheReadTokens: 1000,
    })
    expect(bySession(warm.rows, FORK_ID)).toHaveLength(2)
    expect(bySession(warm.rows, SUFFIX_FORK_ID)).toHaveLength(1)

    const cache = await readCache(cachePath)
    expect(cache.files[parentFile]!.turns).toHaveLength(4)
    expect(cache.files[parentFile]!.size).toBe((await stat(parentFile)).size)
  })

  it("re-reads a cached fork once its parent grows into a turn it claimed", async () => {
    const { sessions, cachePath } = await copyFixtures()
    await readCodexUsage(sessions, { cachePath })

    // The parent's next turn reproduces the fork's first own turn exactly, so
    // a cold read now attributes that turn to the parent and the fork's cached
    // outcome no longer matches what a fresh read would produce.
    await appendFile(
      join(sessions, PARENT_FILE),
      jsonl([
        {
          timestamp: "2026-09-01T10:02:00.000Z",
          type: "turn_context",
          payload: { turn_id: "a3", model: "gpt-5.6-terra" },
        },
        tokenCount(
          "2026-09-01T10:02:10.000Z",
          {
            input_tokens: 9200,
            cached_input_tokens: 6700,
            cache_write_input_tokens: 0,
            output_tokens: 1800,
            reasoning_output_tokens: 600,
            total_tokens: 11000,
          },
          {
            input_tokens: 3000,
            cached_input_tokens: 3000,
            cache_write_input_tokens: 0,
            output_tokens: 500,
            reasoning_output_tokens: 150,
            total_tokens: 3500,
          }
        ),
      ])
    )

    const warm = await readCodexRollouts(sessions, { cachePath })
    expect(warm).toMatchObject({ filesRead: 2, filesCached: 4 })
    expect(warm.rows).toEqual(await readCodexUsage(sessions))
    expect(warm.rows).toHaveLength(10)
    expect(bySession(warm.rows, PARENT_ID)).toHaveLength(4)
    expect(bySession(warm.rows, FORK_ID)).toEqual([
      expect.objectContaining({ startedAt: "2026-09-03T09:06:00.000Z" }),
    ])
  })

  it("drops a deleted rollout's rows and cache entry", async () => {
    const { sessions, cachePath } = await copyFixtures()
    const cold = await readCodexUsage(sessions, { cachePath })

    const file = join(sessions, SAKANA_FILE)
    await rm(file)

    const warm = await readCodexRollouts(sessions, { cachePath })
    expect(warm).toMatchObject({ filesRead: 0, filesCached: 5 })
    expect(warm.rows).toEqual(
      cold.filter((row) => row.sourceSessionHash !== sessionHash(SAKANA_ID))
    )
    expect(warm.rows).toHaveLength(8)
    const cache = await readCache(cachePath)
    expect(Object.keys(cache.files)).toHaveLength(5)
    expect(cache.files[file]).toBeUndefined()
  })

  it("falls back to a full read on a corrupt or wrong-version cache", async () => {
    const { sessions, cachePath } = await copyFixtures()
    const cold = await readCodexUsage(sessions)

    await mkdir(dirname(cachePath), { recursive: true })
    await writeFile(cachePath, "{not json")
    const corrupt = await readCodexRollouts(sessions, { cachePath })
    expect(corrupt).toMatchObject({ filesRead: 6, filesCached: 0 })
    expect(corrupt.rows).toEqual(cold)
    const rewritten = await readCache(cachePath)
    expect(rewritten.version).toBe(1)
    expect(Object.keys(rewritten.files)).toHaveLength(6)

    await writeFile(cachePath, JSON.stringify({ ...rewritten, version: 999 }))
    const wrongVersion = await readCodexRollouts(sessions, { cachePath })
    expect(wrongVersion).toMatchObject({ filesRead: 6, filesCached: 0 })
    expect(wrongVersion.rows).toEqual(cold)
    expect((await readCache(cachePath)).version).toBe(1)

    const warm = await readCodexRollouts(sessions, { cachePath })
    expect(warm).toMatchObject({ filesRead: 0, filesCached: 6 })
    expect(warm.rows).toEqual(cold)
  })

  it("stores raw model ids so aliasing runs when the cache is loaded", async () => {
    const { sessions, cachePath } = await copyFixtures()
    const file = join(sessions, ALIASED_FILE)
    await mkdir(dirname(file), { recursive: true })
    await writeFile(
      file,
      jsonl([
        {
          timestamp: "2026-09-04T09:00:00.000Z",
          type: "session_meta",
          payload: { id: ALIASED_ID, model_provider: "github-copilot" },
        },
        {
          timestamp: "2026-09-04T09:00:01.000Z",
          type: "turn_context",
          payload: { turn_id: "g1", model: "claude-opus-4.6" },
        },
        tokenCount(
          "2026-09-04T09:00:05.000Z",
          {
            input_tokens: 900,
            cached_input_tokens: 100,
            output_tokens: 50,
            total_tokens: 950,
          },
          {
            input_tokens: 900,
            cached_input_tokens: 100,
            output_tokens: 50,
            total_tokens: 950,
          }
        ),
      ])
    )

    const first = await readCodexRollouts(sessions, { cachePath })
    const aliased = bySession(first.rows, ALIASED_ID)
    expect(aliased).toEqual([
      {
        source: "codex",
        provider: "anthropic",
        model: "claude-opus-4-6",
        day: "2026-09-04",
        startedAt: "2026-09-04T09:00:05.000Z",
        inputTokens: 800,
        outputTokens: 50,
        cacheReadTokens: 100,
        cacheWriteTokens: null,
        exactCostUsd: null,
        sourceSessionHash: sessionHash(ALIASED_ID),
      },
    ])

    const entry = (await readCache(cachePath)).files[file]!
    expect(entry.provider).toBe("github-copilot")
    expect(entry.turns).toEqual([
      ["2026-09-04T09:00:05.000Z", "claude-opus-4.6", 900, 100, 50, 0],
    ])

    const warm = await readCodexRollouts(sessions, { cachePath })
    expect(warm).toMatchObject({ filesRead: 0, filesCached: 7 })
    expect(bySession(warm.rows, ALIASED_ID)).toEqual(aliased)
  })
})
