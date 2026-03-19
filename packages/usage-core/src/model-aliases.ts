import type { NormalizedModelKey } from "./types"

const WRAPPED_CLUDE_PROVIDERS = new Set(["github-copilot", "vercel", "opencode"])

export function normalizeModelKey(provider: string, model: string): NormalizedModelKey {
  const wrappedModel = model.includes("/") ? model.split("/").pop() ?? model : model

  if (WRAPPED_CLUDE_PROVIDERS.has(provider) && wrappedModel.startsWith("claude-")) {
    return {
      provider: "anthropic",
      model: wrappedModel.replace(/\.6$/u, "-6"),
    }
  }

  return { provider, model }
}
