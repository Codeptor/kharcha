import type { NormalizedModelKey } from "./types"

const WRAPPED_CLAUDE_PROVIDERS = new Set([
  "github-copilot",
  "vercel",
  "opencode",
])

const PROVIDER_ALIASES: Record<string, string> = {}

function normalizeAgyModel(model: string): NormalizedModelKey {
  const normalized = model
    .trim()
    .toLowerCase()
    .replace(/\(([^)]+)\)/gu, "-$1")
    .replace(/\s+/gu, "-")
    .replace(/[^a-z0-9.-]/gu, "-")
    .replace(/-+/gu, "-")
    .replace(/^-|-$/gu, "")

  if (normalized.startsWith("claude-")) {
    return {
      provider: "anthropic",
      model: normalized.replace(/-thinking$/u, "").replace(/\.6$/u, "-6"),
    }
  }

  if (normalized === "gemini-3-flash-a") {
    return { provider: "google", model: "gemini-3.5-flash" }
  }

  return {
    provider: "google",
    model: normalized.replace(/-(low|medium|high)$/u, ""),
  }
}

export function normalizeModelKey(
  provider: string,
  model: string
): NormalizedModelKey {
  if (provider === "agy") {
    return normalizeAgyModel(model)
  }

  if (provider === "kimi-for-coding" && model === "k3") {
    return { provider: "moonshotai", model: "kimi-k3" }
  }

  const baseModel = model.includes("/")
    ? (model.split("/").pop() ?? model)
    : model
  if (baseModel.startsWith("muse-spark")) {
    return { provider: "meta", model: baseModel }
  }

  if (WRAPPED_CLAUDE_PROVIDERS.has(provider)) {
    const wrappedModel = model.includes("/")
      ? (model.split("/").pop() ?? model)
      : model
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
