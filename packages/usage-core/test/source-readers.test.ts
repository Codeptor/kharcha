import { describe, expect, it } from "bun:test"
import { Database } from "bun:sqlite"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { readClaudeCodeUsage } from "../src/sources/claude-code"
import { parseCcusageCodexDaily } from "../src/sources/codex"
import { readOpenCodeUsage } from "../src/sources/opencode"
import { readAgyUsage } from "../src/sources/agy"

describe("source readers", () => {
  it("reads Claude Code JSONL rows", async () => {
    const rows = await readClaudeCodeUsage(
      "packages/usage-core/test/fixtures/claude-session.jsonl"
    )

    expect(rows).toHaveLength(2)
    expect(rows[0]?.provider).toBe("anthropic")
    expect(rows[0]?.model).toBe("claude-opus-4-6")
  })

  it("uses ccusage Codex totals as model-priced rows", () => {
    const rows = parseCcusageCodexDaily({
      daily: [
        {
          date: "2026-07-26",
          models: {
            "gpt-5.3-codex-spark": {
              inputTokens: 100_259,
              outputTokens: 23_145,
              cacheReadTokens: 726_272,
              cacheCreationTokens: 0,
              totalTokens: 849_676,
            },
            "gpt-5.6-luna": {
              inputTokens: 11_248_873,
              outputTokens: 1_574_102,
              cacheReadTokens: 903_218_688,
              cacheCreationTokens: 0,
              totalTokens: 916_041_663,
            },
          },
        },
      ],
    })

    expect(rows).toHaveLength(2)
    expect(rows).toContainEqual(
      expect.objectContaining({
        model: "gpt-5.6-luna",
        inputTokens: 11_248_873,
        outputTokens: 1_574_102,
        cacheReadTokens: 903_218_688,
        exactCostUsd: null,
      })
    )
  })

  it("preserves ccusage total tokens outside the split counters", () => {
    const [row] = parseCcusageCodexDaily({
      daily: [
        {
          date: "2026-07-27",
          models: {
            "gpt-5.6-luna": {
              inputTokens: 10,
              outputTokens: 5,
              cacheReadTokens: 50,
              totalTokens: 70,
            },
          },
        },
      ],
    })

    expect(row?.aggregateTokens).toBe(5)
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
})
