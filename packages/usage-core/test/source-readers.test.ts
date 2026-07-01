import { Database } from "bun:sqlite"
import { mkdtempSync } from "node:fs"
import { mkdir, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { describe, expect, it } from "bun:test"
import { readClaudeCodeUsage } from "../src/sources/claude-code"
import { readClaudeStatsCache } from "../src/sources/claude-code-cache"
import { readCodexUsage } from "../src/sources/codex"
import { readOpenCodeUsage } from "../src/sources/opencode"

describe("source readers", () => {
  it("reads Claude Code JSONL rows", async () => {
    const rows = await readClaudeCodeUsage(
      "packages/usage-core/test/fixtures/claude-session.jsonl"
    )

    expect(rows).toHaveLength(2)
    expect(rows[0]?.provider).toBe("anthropic")
    expect(rows[0]?.model).toBe("claude-opus-4-6")
    expect(rows[0]?.exactCostUsd).toBeNull()
  })

  it("skips Claude Code synthetic placeholder rows", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "claude-reader-"))
    const filePath = join(tempDir, "session.jsonl")

    try {
      await Bun.write(
        filePath,
        [
          JSON.stringify({
            timestamp: "2026-03-20T12:00:00.000Z",
            sessionId: "session-1",
            message: {
              model: "<synthetic>",
              usage: {
                input_tokens: 0,
                output_tokens: 0,
                cache_read_input_tokens: 0,
                cache_creation_input_tokens: 0,
              },
            },
          }),
        ].join("\n")
      )

      await expect(readClaudeCodeUsage(tempDir)).resolves.toEqual([])
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it("reads Codex rollout metadata", async () => {
    const rows = await readCodexUsage(
      "packages/usage-core/test/fixtures/codex-rollout.jsonl"
    )

    // One rollout file = one session. Tokens come from the final cumulative token_count;
    // cached input is removed from input, and Codex output already includes reasoning.
    expect(rows).toHaveLength(1)
    expect(rows[0]?.provider).toBe("openai")
    expect(rows[0]?.model).toBe("gpt-5.4")
    expect(rows[0]?.inputTokens).toBe(3000)
    expect(rows[0]?.outputTokens).toBe(900)
    expect(rows[0]?.cacheReadTokens).toBe(1000)
  })

  it("reads Codex sqlite rows returned as objects", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "codex-reader-sqlite-"))
    const dbPath = join(tempDir, "state.sqlite")
    const db = new Database(dbPath, { create: true })

    try {
      db.exec(`
        create table if not exists threads (
          id text primary key,
          model_provider text not null,
          model text,
          created_at integer,
          tokens_used integer
        )
      `)
      db.exec(`
        insert into threads (id, model_provider, model, created_at, tokens_used)
        values ('thread-1', 'openai', 'gpt-5.4', 1773162088, 42)
      `)
    } finally {
      db.close()
    }

    try {
      const rows = await readCodexUsage(dbPath)

      expect(rows).toHaveLength(1)
      expect(rows[0]?.day).toBe("2026-03-10")
      expect(rows[0]?.startedAt).toBe("2026-03-10T17:01:28.000Z")
      expect(rows[0]?.inputTokens).toBe(42)
      expect(rows[0]?.outputTokens).toBeNull()
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it("uses Codex sqlite model and token ledger while reading rollout token split", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "codex-reader-ledger-"))
    const sessionsDir = join(tempDir, "sessions")
    const rolloutPath = join(sessionsDir, "rollout.jsonl")
    const dbPath = join(tempDir, "state.sqlite")
    const db = new Database(dbPath, { create: true })

    try {
      await mkdir(sessionsDir, { recursive: true })
      await Bun.write(
        rolloutPath,
        [
          JSON.stringify({
            timestamp: "2026-03-10T17:01:28.000Z",
            type: "session_meta",
            payload: {
              id: "thread-1",
              model_provider: "openai",
              model: "gpt-5.4",
            },
          }),
          JSON.stringify({
            timestamp: "2026-03-10T17:02:28.000Z",
            type: "event_msg",
            payload: {
              type: "token_count",
              info: {
                total_token_usage: {
                  input_tokens: 1200,
                  cached_input_tokens: 200,
                  output_tokens: 300,
                  total_tokens: 1500,
                },
              },
            },
          }),
        ].join("\n")
      )

      db.exec(`
        create table if not exists threads (
          id text primary key,
          rollout_path text not null,
          model_provider text not null,
          model text,
          created_at integer,
          tokens_used integer
        )
      `)
      db.query(
        `
          insert into threads (id, rollout_path, model_provider, model, created_at, tokens_used)
          values ('thread-1', ?, 'openai', 'gpt-5.4-mini', 1773162088, 1500)
        `
      ).run(rolloutPath)
    } finally {
      db.close()
    }

    try {
      const rows = await readCodexUsage(tempDir)

      expect(rows).toHaveLength(1)
      expect(rows[0]?.provider).toBe("openai")
      expect(rows[0]?.model).toBe("gpt-5.4-mini")
      expect(rows[0]?.inputTokens).toBe(1000)
      expect(rows[0]?.outputTokens).toBe(300)
      expect(rows[0]?.cacheReadTokens).toBe(200)
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it("skips sqlite files without a threads table", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "codex-reader-"))
    const dbPath = join(tempDir, "logs_1.sqlite")
    const db = new Database(dbPath, { create: true })

    try {
      db.exec(
        "create table if not exists logs (id text primary key, note text)"
      )
      db.exec("insert into logs (id, note) values ('1', 'no threads here')")
    } finally {
      db.close()
    }

    try {
      await expect(readCodexUsage(tempDir)).resolves.toEqual([])
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it("reads OpenCode sqlite rows returned as objects", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "opencode-reader-sqlite-"))
    const dbPath = join(tempDir, "opencode.sqlite")
    const db = new Database(dbPath, { create: true })

    try {
      db.exec(`
        create table if not exists message (
          id text primary key,
          session_id text not null,
          time_created integer not null,
          data text not null
        )
      `)
      db.exec(`
        insert into message (id, session_id, time_created, data)
        values (
          'msg-1',
          'session-1',
          1771551784680,
          '{"role":"assistant","providerID":"anthropic","modelID":"claude-opus-4-6","cost":0.42,"tokens":{"input":1000,"output":300,"reasoning":50,"total":1550,"cache":{"read":200,"write":0}}}'
        )
      `)
    } finally {
      db.close()
    }

    try {
      const rows = await readOpenCodeUsage(dbPath)

      expect(rows).toHaveLength(1)
      expect(rows[0]?.outputTokens).toBe(350)
      expect(rows[0]?.cacheReadTokens).toBe(200)
      expect(rows[0]?.cacheWriteTokens).toBe(0)
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it("reads OpenCode assistant rows", async () => {
    const rows = await readOpenCodeUsage(
      "packages/usage-core/test/fixtures/opencode-message.json"
    )

    expect(rows).toHaveLength(1)
    expect(rows[0]?.provider).toBe("anthropic")
    expect(rows[0]?.model).toBe("claude-opus-4-6")
    expect(rows[0]?.exactCostUsd).toBe(0.42)
  })

  it("namespaces stats-cache backfill so WSL and Windows rows never collide", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "claude-stats-cache-"))
    const cachePath = join(tempDir, "stats-cache.json")

    try {
      await Bun.write(
        cachePath,
        JSON.stringify({
          dailyModelTokens: [
            {
              date: "2025-10-08",
              tokensByModel: { "claude-sonnet-4-5-20250929": 1128 },
            },
          ],
          modelUsage: {
            "claude-sonnet-4-5-20250929": {
              inputTokens: 90,
              outputTokens: 1038,
              cacheReadInputTokens: 270951,
              cacheCreationInputTokens: 87116,
            },
          },
        })
      )

      const wsl = await readClaudeStatsCache(cachePath, [])
      const windows = await readClaudeStatsCache(cachePath, [], "windows-bhanu")

      expect(wsl).toHaveLength(1)
      expect(windows).toHaveLength(1)
      // Identical day/model/tokens, but the namespace forces distinct session hashes
      // (and therefore distinct dedupe keys downstream) so the two machines sum, never merge.
      expect(wsl[0]?.inputTokens).toBe(90)
      expect(windows[0]?.inputTokens).toBe(90)
      expect(wsl[0]?.sourceSessionHash).not.toBe(windows[0]?.sourceSessionHash)
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })
})
