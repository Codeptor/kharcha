import { describe, expect, it } from "bun:test"
import { Database } from "bun:sqlite"
import { createHash } from "node:crypto"
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
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

  it("reads omp assistant usage from session transcripts", async () => {
    const directory = await mkdtemp(join(tmpdir(), "kharcha-omp-"))
    const sessionPath = join(directory, "session.jsonl")
    await writeFile(
      sessionPath,
      [
        JSON.stringify({ type: "session", version: 3, id: "s1", timestamp: "2026-09-25T09:00:00.000Z", cwd: "/tmp" }),
        JSON.stringify({
          type: "message",
          id: "m1",
          timestamp: "2026-09-25T09:00:01.000Z",
          message: {
            role: "assistant",
            provider: "deepseek",
            model: "deepseek-flash",
            responseId: "resp-1",
            usage: {
              input: 100,
              output: 20,
              cacheRead: 5_000,
              cacheWrite: 0,
              totalTokens: 5_120,
              reasoningTokens: 7,
              cost: { input: 0.0001, output: 0.0002, cacheRead: 0.0003, cacheWrite: 0, total: 0.0006 },
            },
          },
        }),
        // A replayed response repeats the id and must not be counted twice
        JSON.stringify({
          type: "message",
          id: "m1",
          timestamp: "2026-09-25T09:00:01.000Z",
          message: {
            role: "assistant",
            provider: "deepseek",
            model: "deepseek-flash",
            responseId: "resp-1",
            usage: { input: 100, output: 20, cacheRead: 5_000, cacheWrite: 0, totalTokens: 5_120 },
          },
        }),
        // A usage-less record is not an assistant response
        JSON.stringify({ type: "message", id: "m2", timestamp: "2026-09-25T09:00:02.000Z", message: { role: "user" } }),
      ].join("\n")
    )

    try {
      const rows = await readOmpUsage(sessionPath)
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({
        source: "omp",
        provider: "deepseek",
        model: "deepseek-flash",
        day: "2026-09-25",
        inputTokens: 100,
        outputTokens: 20,
        cacheReadTokens: 5_000,
        cacheWriteTokens: 0,
        exactCostUsd: 0.0006,
      })

      const filtered = await readOmpUsage(sessionPath, { sinceEpochMs: Date.parse("2026-09-26T00:00:00") })
      expect(filtered).toHaveLength(0)
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  })

  it("reads DeepSeek Harness usage from session transcripts", async () => {
    const directory = await mkdtemp(join(tmpdir(), "kharcha-dsh-"))
    const sessionDir = join(directory, "sessions", "project")
    await mkdir(sessionDir, { recursive: true })
    const sessionPath = join(sessionDir, "session.v3.jsonl.zstd")
    await writeFile(
      sessionPath,
      Bun.zstdCompressSync(
        Buffer.from(
          [
            JSON.stringify({ type: "session", id: "s1", time: 1_756_000_000_000 }),
            JSON.stringify({ type: "model/selection", data: { provider: "deepseek-official", model: "deepseek-flash" } }),
            JSON.stringify({
              type: "assistant/message",
              id: "r1",
              time: 1_756_000_001_000,
              data: { usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 5_000, totalTokens: 5_120, reasoningTokens: 7 } },
            }),
            // A replayed response repeats the record id and must not be counted twice
            JSON.stringify({
              type: "assistant/message",
              id: "r1",
              time: 1_756_000_001_000,
              data: { usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 5_000, totalTokens: 5_120 } },
            }),
            JSON.stringify({ type: "assistant/message", id: "r2", time: 1_756_000_002_000, data: {} }),
          ].join("\n")
        )
      )
    )

    try {
      const rows = await readDshUsage(join(directory, "sessions"))
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({
        source: "dsh",
        provider: "deepseek",
        model: "deepseek-flash",
        inputTokens: 100,
        outputTokens: 20,
        cacheReadTokens: 5_000,
        cacheWriteTokens: 0,
        exactCostUsd: null,
      })

      const filtered = await readDshUsage(join(directory, "sessions"), { sinceEpochMs: Date.parse("2026-01-01T00:00:00") })
      expect(filtered).toHaveLength(0)
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  })
})
