import type { NormalizedModelKey } from "./types"

const WRAPPED_CLAUDE_PROVIDERS = new Set([
  "github-copilot",
  "vercel",
  "opencode",
])

const PROVIDER_ALIASES: Record<string, string> = {}

// Models served through Alibaba Model Studio's Anthropic-compatible endpoint
// (openCode provider `qwencloud`, or Claude Code via ANTHROPIC_BASE_URL which
// logs them under provider "anthropic"). Keep the `qwencloud` provider label
// on the dashboard; pricing is resolved by mirroring the models.dev `alibaba`
// catalog onto `qwencloud:*` keys (see loadPricingLookup in scripts/sync.ts).
const QWENCLOUD_MODELS = new Set([
  "MiniMax-M2.5",
  "deepseek-v3.2",
  "deepseek-v4-flash",
  "deepseek-v4-flash-0731",
  "deepseek-v4-pro",
  "glm-5",
  "glm-5.1",
  "glm-5.2",
  "kimi-k2.5",
  "kimi-k2.6",
  "kimi-k2.7-code",
  "qwen-image-2.0",
  "qwen-image-2.0-pro",
  "qwen3.6-flash",
  "qwen3.6-plus",
  "qwen3.7-max",
  "qwen3.7-plus",
  "qwen3.8-max",
  "qwen3.8-max-preview",
  "wan2.7-image",
  "wan2.7-image-pro",
])

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

  if (
    (provider === "anthropic" || provider === "qwencloud") &&
    QWENCLOUD_MODELS.has(baseModel)
  ) {
    return { provider: "qwencloud", model: baseModel }
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
