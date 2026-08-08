import type { NormalizedModelKey } from "./types"

const WRAPPED_CLAUDE_PROVIDERS = new Set(["github-copilot", "vercel", "opencode"])

const PROVIDER_ALIASES: Record<string, string> = {}

export function normalizeModelKey(provider: string, model: string): NormalizedModelKey {
  if (provider === "kimi-for-coding" && model === "k3") {
    return { provider: "moonshotai", model: "kimi-k3" }
  }

  const baseModel = model.includes("/") ? (model.split("/").pop() ?? model) : model
  if (baseModel.startsWith("muse-spark")) {
    return { provider: "meta", model: baseModel }
  }

  if (WRAPPED_CLAUDE_PROVIDERS.has(provider)) {
    const wrappedModel = model.includes("/") ? model.split("/").pop() ?? model : model
    if (wrappedModel.startsWith("claude-")) {
      return {
        provider: "anthropic",
        model: wrappedModel.replace(/\.6$/u, "-6"),
      }
    }
  }

  const normalizedProvider = PROVIDER_ALIASES[provider] ?? provider

  return { provider: normalizedProvider, model }
}
