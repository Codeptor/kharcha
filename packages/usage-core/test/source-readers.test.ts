import { describe, expect, it } from "bun:test"
import { Database } from "bun:sqlite"
import { createHash } from "node:crypto"
import { copyFile, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { readClaudeCodeUsage } from "../src/sources/claude-code"
import { readOpenCodeUsage } from "../src/sources/opencode"
import { readAgyUsage } from "../src/sources/agy"
import { readOmpUsage } from "../src/sources/omp"
import { readDshUsage } from "../src/sources/dsh"

describe("source readers", () => {
  it("reads Claude Code JSONL rows", async () => {
    const rows = await readClaudeCodeUsage(
      "packages/usage-core/test/fixtures/claude-session.jsonl"
    )

    expect(rows).toHaveLength(2)
    expect(rows[0]?.provider).toBe("anthropic")
    expect(rows[0]?.model).toBe("claude-opus-4-6")
    expect(rows[0]?.cacheWrite1hTokens).toBeNull()
  })

  it("counts one Claude Code response per message id across content-block lines", async () => {
    const rows = await readClaudeCodeUsage(
      "packages/usage-core/test/fixtures/claude-multiblock.jsonl"
    )

    expect(rows).toHaveLength(3)
    expect(rows[0]).toMatchObject({
      model: "claude-opus-4-8",
      inputTokens: 2,
      outputTokens: 346,
      cacheReadTokens: 4567,
      cacheWriteTokens: 28652,
      cacheWrite1hTokens: 28652,
    })
    expect(rows[1]).toMatchObject({
      cacheWriteTokens: 1000,
      cacheWrite1hTokens: 600,
    })
    expect(rows[2]).toMatchObject({
      model: "claude-sonnet-4-6",
      cacheWriteTokens: 0,
      cacheWrite1hTokens: null,
    })
  })

  it("dedupes Claude Code responses repeated across session files", async () => {
    const directory = await mkdtemp(join(tmpdir(), "kharcha-claude-"))
    const fixture = "packages/usage-core/test/fixtures/claude-multiblock.jsonl"

    try {
      await copyFile(fixture, join(directory, "a.jsonl"))
      await copyFile(fixture, join(directory, "b.jsonl"))

      const rows = await readClaudeCodeUsage(directory)
      const withIds = rows.filter((row) => row.model === "claude-opus-4-8")
      const withoutIds = rows.filter((row) => row.model === "claude-sonnet-4-6")

      expect(withIds).toHaveLength(2)
      expect(withoutIds).toHaveLength(2)
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  })

  it("reads OpenCode2 session messages without duplicating legacy sessions", async () => {
    const directory = await mkdtemp(join(tmpdir(), "kharcha-opencode-"))
    const databasePath = join(directory, "opencode.db")
    const db = new Database(databasePath)

    try {
      db.run(`
        create table message (
          id text primary key,
          session_id text not null,
          time_created integer not null,
          data text not null
        );
        create table session_message (
          id text primary key,
          session_id text not null,
          type text not null,
          time_created integer not null,
          data text not null
        );
      `)

      const legacy = JSON.stringify({
        role: "assistant",
        providerID: "anthropic",
        modelID: "claude-opus-4-6",
        cost: 0.42,
        tokens: { input: 1_000, output: 300 },
      })
      const duplicateV2 = JSON.stringify({
        model: { providerID: "anthropic", id: "claude-opus-4-6" },
        cost: 0.42,
        tokens: { input: 1_000, output: 300 },
      })
      const opencode2 = JSON.stringify({
        model: { providerID: "meta", id: "muse-spark-1.2-contributor" },
        cost: 0.12,
        tokens: {
          input: 2_000,
          output: 400,
          reasoning: 100,
          cache: { read: 500 },
        },
      })
      const failedZenRequest = JSON.stringify({
        role: "assistant",
        providerID: "opencode",
        modelID: "gpt-5.6-sol",
        cost: 0,
        tokens: { input: 0, output: 0, cache: { read: 0, write: 0 } },
        error: { name: "APIError", message: "No payment method" },
      })

      db.query("insert into message values (?, ?, ?, ?)").run(
        "msg_legacy",
        "ses_legacy",
        Date.UTC(2026, 7, 9, 12),
        legacy
      )
      db.query("insert into session_message values (?, ?, ?, ?, ?)").run(
        "msg_duplicate",
        "ses_legacy",
        "assistant",
        Date.UTC(2026, 7, 9, 12),
        duplicateV2
      )
      db.query("insert into session_message values (?, ?, ?, ?, ?)").run(
        "msg_opencode2",
        "ses_opencode2",
        "assistant",
        Date.UTC(2026, 7, 9, 12),
        opencode2
      )
      db.query("insert into message values (?, ?, ?, ?)").run(
        "msg_failed_zen",
        "ses_failed_zen",
        Date.UTC(2026, 7, 9, 12),
        failedZenRequest
      )
    } finally {
      db.close()
    }

    try {
      const rows = await readOpenCodeUsage(databasePath)

      expect(rows).toHaveLength(2)
      expect(rows).toContainEqual(
        expect.objectContaining({
          source: "opencode",
          provider: "anthropic",
          model: "claude-opus-4-6",
          exactCostUsd: 0.42,
        })
      )
      expect(rows).toContainEqual(
        expect.objectContaining({
          source: "opencode",
          provider: "meta",
          model: "muse-spark-1.2-contributor",
          day: "2026-08-09",
          inputTokens: 2_000,
          outputTokens: 500,
          cacheReadTokens: 500,
          exactCostUsd: 0.12,
        })
      )
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  })

  it("keeps OpenCode SQLite rows with a null error and skips errored, malformed, and user rows", async () => {
    const directory = await mkdtemp(join(tmpdir(), "kharcha-opencode-"))
    const databasePath = join(directory, "opencode.db")
    const db = new Database(databasePath)
    const at = Date.UTC(2026, 7, 9, 12)

    try {
      db.run(`
        create table message (
          id text primary key,
          session_id text not null,
          time_created integer not null,
          data text not null
        );
      `)
      const insert = db.query("insert into message values (?, ?, ?, ?)")
      insert.run(
        "msg_null_error",
        "ses_a",
        at,
        JSON.stringify({
          role: "assistant",
          providerID: "anthropic",
          modelID: "claude-opus-4-6",
          error: null,
          cost: 0,
          tokens: { input: 10, cache: { read: 5, write: 0 } },
        })
      )
      insert.run(
        "msg_object_error",
        "ses_a",
        at,
        JSON.stringify({
          role: "assistant",
          providerID: "anthropic",
          modelID: "claude-opus-4-6",
          error: { name: "APIError", message: "boom" },
          cost: 0.5,
          tokens: { input: 10, output: 5 },
        })
      )
      insert.run("msg_malformed", "ses_a", at, '{"role":"assistant",')
      insert.run(
        "msg_user",
        "ses_a",
        at,
        JSON.stringify({
          role: "user",
          providerID: "anthropic",
          modelID: "claude-opus-4-6",
          tokens: { input: 1, output: 1 },
        })
      )
    } finally {
      db.close()
    }

    try {
      expect(await readOpenCodeUsage(databasePath)).toEqual([
        {
          source: "opencode",
          provider: "anthropic",
          model: "claude-opus-4-6",
          day: "2026-08-09",
          startedAt: "2026-08-09T12:00:00.000Z",
          inputTokens: 10,
          outputTokens: null,
          cacheReadTokens: 5,
          cacheWriteTokens: 0,
          exactCostUsd: null,
          sourceSessionHash: createHash("sha256").update("ses_a").digest("hex"),
        },
      ])
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  })

  it("reads OpenCode2 session messages when there is no legacy message table", async () => {
    const directory = await mkdtemp(join(tmpdir(), "kharcha-opencode-"))
    const databasePath = join(directory, "opencode.db")
    const db = new Database(databasePath)
    const at = Date.UTC(2026, 7, 9, 12)

    try {
      db.run(`
        create table session_message (
          id text primary key,
          session_id text not null,
          type text not null,
          time_created integer not null,
          data text not null
        );
      `)
      const insert = db.query(
        "insert into session_message values (?, ?, ?, ?, ?)"
      )
      insert.run(
        "msg_assistant",
        "ses_v2",
        "assistant",
        at,
        JSON.stringify({
          model: { providerID: "openai", id: "gpt-5.6" },
          cost: 0.03,
          tokens: {
            input: 100,
            output: 20,
            reasoning: 30,
            cache: { read: 0, write: 40 },
          },
        })
      )
      insert.run("msg_user", "ses_v2", "user", at, JSON.stringify({}))
    } finally {
      db.close()
    }

    try {
      expect(await readOpenCodeUsage(databasePath)).toEqual([
        {
          source: "opencode",
          provider: "openai",
          model: "gpt-5.6",
          day: "2026-08-09",
          startedAt: "2026-08-09T12:00:00.000Z",
          inputTokens: 100,
          outputTokens: 50,
          cacheReadTokens: 0,
          cacheWriteTokens: 40,
          exactCostUsd: 0.03,
          sourceSessionHash: createHash("sha256")
            .update("opencode2:ses_v2")
            .digest("hex"),
        },
      ])
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  })

  it("reads server-reported AGY status-line token events", async () => {
    const directory = await mkdtemp(join(tmpdir(), "kharcha-agy-"))
    const ledgerPath = join(directory, "kharcha-usage.jsonl")
    await writeFile(
      ledgerPath,
      [
        JSON.stringify({
          at: "2026-08-09T12:00:00.000Z",
          cacheCreationInputTokens: 30,
          cacheReadTokens: 800,
          eventId: "event-1",
          inputTokens: 1_200,
          modelId: "Gemini 3.6 Flash (High)",
          outputTokens: 400,
          version: 2,
        }),
        JSON.stringify({
          at: "2026-08-09T12:00:05.000Z",
          cacheCreationInputTokens: 30,
          cacheReadTokens: 800,
          eventId: "event-duplicate",
          inputTokens: 1_200,
          modelId: "Gemini 3.6 Flash (High)",
          outputTokens: 400,
          version: 2,
        }),
        "not-json",
      ].join("\n")
    )

    try {
      const rows = await readAgyUsage(ledgerPath)
      expect(rows).toHaveLength(1)
      const [row] = rows
      expect(row).toMatchObject({
        source: "agy",
        provider: "google",
        model: "gemini-3.6-flash",
        day: "2026-08-09",
        inputTokens: 1_200,
        outputTokens: 400,
        cacheReadTokens: 800,
        cacheWriteTokens: 30,
        requiresCacheWritePricing: true,
      })
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  })

  it("reads omp rows with harness costs and keeps unpriced rows unpriced", async () => {
    const directory = await mkdtemp(join(tmpdir(), "kharcha-omp-"))
    const databasePath = join(directory, "stats.db")
    const db = new Database(databasePath)

    db.run(`create table messages (
      id integer primary key autoincrement,
      session_file text not null,
      entry_id text not null,
      folder text not null,
      model text not null,
      provider text not null,
      api text not null,
      timestamp integer not null,
      duration integer,
      ttft integer,
      stop_reason text not null,
      error_message text,
      input_tokens integer not null,
      output_tokens integer not null,
      cache_read_tokens integer not null,
      cache_write_tokens integer not null,
      total_tokens integer not null,
      premium_requests real not null,
      cost_input real not null,
      cost_output real not null,
      cost_cache_read real not null,
      cost_cache_write real not null,
      cost_total real not null,
      cost_no_cache_input real,
      cost_unpriced integer not null default 0,
      agent_type text not null default 'main',
      unique(session_file, entry_id)
    )`)
    const insert = db.prepare(
      `insert into messages (session_file, entry_id, folder, model, provider, api, timestamp,
        stop_reason, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, total_tokens,
        premium_requests, cost_input, cost_output, cost_cache_read, cost_cache_write, cost_total, cost_unpriced)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    insert.run("s1.jsonl", "e1", "/tmp", "deepseek-flash", "deepseek", "chat", 1_756_000_000_000, "stop", 100, 20, 5_000, 0, 5_120, 0, 0.0001, 0.0002, 0.0003, 0, 0.0006, 0)
    insert.run("s1.jsonl", "e2", "/tmp", "deepseek-flash", "deepseek", "chat", 1_756_000_100_000, "stop", 50, 10, 2_000, 0, 2_060, 0, 0, 0, 0, 0, 0, 1)
    db.close()

    try {
      const rows = await readOmpUsage(databasePath)
      expect(rows).toHaveLength(2)
      expect(rows[0]).toMatchObject({
        source: "omp",
        provider: "deepseek",
        model: "deepseek-flash",
        inputTokens: 100,
        outputTokens: 20,
        cacheReadTokens: 5_000,
        cacheWriteTokens: 0,
        exactCostUsd: 0.0006,
        preventEstimatedCost: false,
      })
      expect(rows[1]?.exactCostUsd).toBeNull()
      expect(rows[1]?.preventEstimatedCost).toBe(true)

      const filtered = await readOmpUsage(databasePath, { sinceEpochMs: 1_756_000_050_000 })
      expect(filtered).toHaveLength(1)
      expect(filtered[0]?.sourceSessionHash).toBe(rows[1]?.sourceSessionHash)
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  })

  it("reads the DeepSeek Harness ledger per day and provider model", async () => {
    const directory = await mkdtemp(join(tmpdir(), "kharcha-dsh-"))
    const ledgerPath = join(directory, "ledger.json")
    await writeFile(
      ledgerPath,
      JSON.stringify({
        version: 1,
        days: {
          "2026-09-18": {
            input: 1,
            output: 1,
            cacheRead: 1,
            cacheWrite: 0,
            byProviderModel: {
              "deepseek-official:deepseek-flash": {
                input: 828_287,
                output: 59_065,
                cacheRead: 9_571_712,
                cacheWrite: 0,
                apiCost: 0.18839718600000002,
              },
            },
          },
          "2026-09-21": {
            byProviderModel: {
              "deepseek-official:deepseek-flash": {
                input: 118_678,
                output: 101_547,
                cacheRead: 16_306_304,
                cacheWrite: 0,
                apiCost: 0.12764881200000003,
              },
              "deepseek-official:deepseek-flash-2": {
                input: 0,
                output: 0,
                cacheRead: 0,
                cacheWrite: 0,
                apiCost: 0,
              },
            },
          },
        },
      })
    )

    try {
      const rows = await readDshUsage(ledgerPath)
      expect(rows).toHaveLength(2)
      expect(rows[0]).toMatchObject({
        source: "dsh",
        provider: "deepseek",
        model: "deepseek-flash",
        day: "2026-09-18",
        inputTokens: 828_287,
        cacheReadTokens: 9_571_712,
        cacheWriteTokens: 0,
        exactCostUsd: 0.18839718600000002,
      })

      const filtered = await readDshUsage(ledgerPath, { sinceDay: "2026-09-19" })
      expect(filtered).toHaveLength(1)
      expect(filtered[0]?.day).toBe("2026-09-21")
      expect(filtered[0]?.cacheReadTokens).toBe(16_306_304)
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  })
})
