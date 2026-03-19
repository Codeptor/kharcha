import { describe, expect, it } from "bun:test"
import { normalizeModelKey } from "../src/model-aliases"

describe("normalizeModelKey", () => {
  it("maps github copilot claude opus to anthropic claude opus 4 6", () => {
    expect(normalizeModelKey("github-copilot", "claude-opus-4.6")).toEqual({
      provider: "anthropic",
      model: "claude-opus-4-6",
    })
  })

  it("maps vercel wrapped claude ids to anthropic claude sonnet 4 6", () => {
    expect(normalizeModelKey("vercel", "anthropic/claude-sonnet-4.6")).toEqual({
      provider: "anthropic",
      model: "claude-sonnet-4-6",
    })
  })

  it("keeps codex model ids intact", () => {
    expect(normalizeModelKey("openai", "gpt-5.3-codex")).toEqual({
      provider: "openai",
      model: "gpt-5.3-codex",
    })
  })
})
