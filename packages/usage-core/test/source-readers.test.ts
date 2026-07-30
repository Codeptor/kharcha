import { describe, expect, it } from "bun:test"
import { readClaudeCodeUsage } from "../src/sources/claude-code"
import { parseCcusageCodexDaily } from "../src/sources/codex"

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
})
