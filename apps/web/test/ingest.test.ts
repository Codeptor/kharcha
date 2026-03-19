import { describe, expect, it } from "bun:test"
import { rollupRowsByDay } from "@/lib/db/ingest"

describe("rollupRowsByDay", () => {
  it("groups costs by day, provider, and model", () => {
    const rows = [
      { day: "2026-03-20", provider: "anthropic", model: "claude-opus-4-6", costUsd: 1.2 },
      { day: "2026-03-20", provider: "anthropic", model: "claude-opus-4-6", costUsd: 0.3 },
    ]

    expect(rollupRowsByDay(rows)).toEqual([
      { day: "2026-03-20", provider: "anthropic", model: "claude-opus-4-6", costUsd: 1.5 },
    ])
  })
})
