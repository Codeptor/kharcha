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

  it("maps Kimi Coding K3 to the canonical Kimi K3 pricing key", () => {
    expect(normalizeModelKey("kimi-for-coding", "k3")).toEqual({
      provider: "moonshotai",
      model: "kimi-k3",
    })
  })

  it("maps AGY model variants to canonical provider pricing keys", () => {
    expect(normalizeModelKey("agy", "Gemini 3.6 Flash (High)")).toEqual({
      provider: "google",
      model: "gemini-3.6-flash",
    })
    expect(normalizeModelKey("agy", "claude-opus-4-6-thinking")).toEqual({
      provider: "anthropic",
      model: "claude-opus-4-6",
    })
  })

  it("maps QwenCloud provider models to QwenCloud pricing keys", () => {
    expect(normalizeModelKey("qwencloud", "qwen3.8-max")).toEqual({
      provider: "qwencloud",
      model: "qwen3.8-max",
    })
    expect(normalizeModelKey("qwencloud", "deepseek-v4-flash-0731")).toEqual({
      provider: "qwencloud",
      model: "deepseek-v4-flash-0731",
    })
    expect(normalizeModelKey("qwencloud", "glm-5.2")).toEqual({
      provider: "qwencloud",
      model: "glm-5.2",
    })
  })

  it("maps Claude Code ANTHROPIC_BASE_URL rows for QwenCloud models", () => {
    expect(normalizeModelKey("anthropic", "qwen3.7-max")).toEqual({
      provider: "qwencloud",
      model: "qwen3.7-max",
    })
    expect(normalizeModelKey("anthropic", "qwen3.8-max")).toEqual({
      provider: "qwencloud",
      model: "qwen3.8-max",
    })
  })

  it("keeps native Anthropic models on the anthropic provider", () => {
    expect(normalizeModelKey("anthropic", "claude-opus-4-6")).toEqual({
      provider: "anthropic",
      model: "claude-opus-4-6",
    })
  })

  it("keeps DeepSeek rows on the deepseek provider", () => {
    expect(normalizeModelKey("deepseek", "deepseek-v4-pro")).toEqual({
      provider: "deepseek",
      model: "deepseek-v4-pro",
    })
  })
})
