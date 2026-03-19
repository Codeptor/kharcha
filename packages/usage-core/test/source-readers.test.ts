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

  it("reads Codex rollout metadata", async () => {
    const rows = await readCodexUsage("packages/usage-core/test/fixtures/codex-rollout.jsonl")

    expect(rows).toHaveLength(2)
    expect(rows[0]?.provider).toBe("openai")
    expect(rows[0]?.model).toBe("gpt-5.4")
  })

  it("reads OpenCode assistant rows", async () => {
    const rows = await readOpenCodeUsage("packages/usage-core/test/fixtures/opencode-message.json")

    expect(rows).toHaveLength(1)
    expect(rows[0]?.provider).toBe("anthropic")
    expect(rows[0]?.model).toBe("claude-opus-4-6")
    expect(rows[0]?.exactCostUsd).toBe(0.42)
  })
})
