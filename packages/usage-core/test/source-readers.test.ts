import { Database } from "bun:sqlite"
import { mkdtempSync } from "node:fs"
import { rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { describe, expect, it } from "bun:test"
import { readClaudeCodeUsage } from "../src/sources/claude-code"
import { readCodexUsage } from "../src/sources/codex"
import { readOpenCodeUsage } from "../src/sources/opencode"

describe("source readers", () => {
  it("reads Claude Code JSONL rows", async () => {
    const rows = await readClaudeCodeUsage("packages/usage-core/test/fixtures/claude-session.jsonl")

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
        ].join("\n"),
      )

      await expect(readClaudeCodeUsage(tempDir)).resolves.toEqual([])
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it("reads Codex rollout metadata", async () => {
    const rows = await readCodexUsage("packages/usage-core/test/fixtures/codex-rollout.jsonl")

    expect(rows).toHaveLength(2)
    expect(rows[0]?.provider).toBe("openai")
    expect(rows[0]?.model).toBe("gpt-5.4")
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
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it("skips sqlite files without a threads table", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "codex-reader-"))
    const dbPath = join(tempDir, "logs_1.sqlite")
    const db = new Database(dbPath, { create: true })

    try {
      db.exec("create table if not exists logs (id text primary key, note text)")
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
          '{"role":"assistant","providerID":"anthropic","modelID":"claude-opus-4-6","cost":0.42,"tokens":{"input":1000,"output":300,"total":1300}}'
        )
      `)
    } finally {
      db.close()
    }

    try {
      await expect(readOpenCodeUsage(dbPath)).resolves.toHaveLength(1)
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it("reads OpenCode assistant rows", async () => {
    const rows = await readOpenCodeUsage("packages/usage-core/test/fixtures/opencode-message.json")

    expect(rows).toHaveLength(1)
    expect(rows[0]?.provider).toBe("anthropic")
    expect(rows[0]?.model).toBe("claude-opus-4-6")
    expect(rows[0]?.exactCostUsd).toBe(0.42)
  })
})
