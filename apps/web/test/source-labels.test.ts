import { describe, expect, it } from "bun:test"

import { sourceLabel } from "../lib/dashboard/source-labels"

describe("source labels", () => {
  it("renders readable labels for every pipeline source", () => {
    expect(sourceLabel("claude-code")).toBe("Claude Code")
    expect(sourceLabel("codex")).toBe("Codex")
    expect(sourceLabel("opencode")).toBe("OpenCode")
    expect(sourceLabel("kimi")).toBe("Kimi")
    expect(sourceLabel("agy")).toBe("AGY")
    expect(sourceLabel("omp")).toBe("OMP")
    expect(sourceLabel("dsh")).toBe("DSH")
  })

  it("falls back to the raw id so unknown sources stay visible", () => {
    expect(sourceLabel("gemini-cli")).toBe("gemini-cli")
    expect(sourceLabel("")).toBe("")
  })
})
