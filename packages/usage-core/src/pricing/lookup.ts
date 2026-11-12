import type { PricingSnapshot } from "../types"
import { CUSTOM_PRICING } from "./custom-pricing"
import { toPricingSnapshot, type ModelsDevCatalogRow } from "./models-dev"

// First-party vendors price their own models; hosts resell them. A borrowed
// retail rate comes from the best tier, then the cheapest non-zero entry in it.
const PROVIDER_TIERS = [
  new Set([
    "anthropic",
    "openai",
    "google",
    "deepseek",
    "moonshotai",
    "minimax",
    "mistral",
    "cohere",
    "zai",
    "alibaba",
    "xiaomi",
    "xai",
    "meta",
  ]),
  new Set(["groq", "amazon-bedrock", "azure", "azure-cognitive-services", "vertex", "deepinfra", "fireworks", "together"]),
]

function providerTier(id: string) {
  const tier = PROVIDER_TIERS.findIndex(set => set.has(id))
  return tier === -1 ? PROVIDER_TIERS.length : tier
}

const splitKey = (key: string) => {
  const colon = key.indexOf(":")
  return { providerId: key.slice(0, colon), modelId: key.slice(colon + 1) }
}
const lastSegment = (id: string) => (id.split("/").pop() ?? id).toLowerCase()
const hasRate = (snap: PricingSnapshot) => (snap.inputCost ?? 0) > 0 || (snap.outputCost ?? 0) > 0

type RetailIndex = Map<string, [string, PricingSnapshot][]>

// Entries that publish a rate, grouped by trailing model id (any case), in map order.
function retailIndex(entries: Map<string, PricingSnapshot>): RetailIndex {
  const index: RetailIndex = new Map()
  for (const [key, snap] of entries) {
    if (!hasRate(snap)) continue
    const tail = lastSegment(splitKey(key).modelId)
    const list = index.get(tail)
    if (list) list.push([key, snap])
    else index.set(tail, [[key, snap]])
  }
  return index
}

// Retail rate of the same model under the best provider that publishes one.
function borrowRetail(index: RetailIndex, key: string): PricingSnapshot | null {
  let best: PricingSnapshot | null = null
  let bestTier = Number.POSITIVE_INFINITY
  let bestRate = Number.POSITIVE_INFINITY
  for (const [otherKey, snap] of index.get(lastSegment(splitKey(key).modelId)) ?? []) {
    if (otherKey === key) continue
    const rate = (snap.inputCost ?? 0) + (snap.outputCost ?? 0)
    const tier = providerTier(splitKey(otherKey).providerId)
    if (tier < bestTier || (tier === bestTier && rate < bestRate)) {
      bestTier = tier
      bestRate = rate
      best = snap
    }
  }
  return best
}

const GATEWAYS = new Set(["nvidia", "tokenrouter", "opencode", "openrouter", "qwencloud"])
const isFree = (modelId: string) => /(^|[-_/])free($|[-_/])|free$/i.test(modelId)

/**
 * Pricing for the catalog rows, with the rules the sync applies on top.
 * The catalog, official-price overrides and the QwenCloud mirror of Alibaba
 * are built up front; everything else is derived per key on first `get`:
 * NIM zero-rate borrowing, the exact entry, case-insensitive aliasing, then
 * the gateway rules (a `free` model with no entry is $0, otherwise the retail
 * rate of the same model under the best provider).
 */
export function derivePricing(rows: ModelsDevCatalogRow[]) {
  const catalog = new Map<string, PricingSnapshot>()
  for (const row of rows) catalog.set(`${row.providerId}:${row.modelId}`, toPricingSnapshot(row))

  const lookup = new Map(catalog)
  // Override with pricing for models models.dev does not list.
  for (const [key, snapshot] of Object.entries(CUSTOM_PRICING)) lookup.set(key, snapshot)

  // QwenCloud (Alibaba Model Studio) sells at Alibaba's own pay-as-you-go
  // prices, so it mirrors the `alibaba` catalog; models.dev lists the Token
  // Plan itself at $0. Gaps fall through to the gateway rule.
  for (const [key, snapshot] of [...lookup]) {
    if (key.startsWith("alibaba:")) lookup.set(`qwencloud:${key.slice("alibaba:".length)}`, snapshot)
  }

  let catalogIndex: RetailIndex | undefined
  let lookupIndex: RetailIndex | undefined
  const folded = new Map<string, string>()
  for (const key of lookup.keys()) folded.set(key.toLowerCase(), key)

  // NVIDIA NIM is free-tier hosted; models.dev lists most NIM models at $0/$0.
  // Swap those for the retail equivalent so the tokens carry a shadow cost.
  const entry = (key: string): PricingSnapshot | undefined => {
    const snap = lookup.get(key)
    if (!snap || !key.startsWith("nvidia:") || key in CUSTOM_PRICING || hasRate(snap)) return snap
    return borrowRetail((catalogIndex ??= retailIndex(catalog)), key) ?? snap
  }

  const memo = new Map<string, PricingSnapshot | undefined>()
  const derive = (key: string): PricingSnapshot | undefined => {
    let snap = entry(key)
    if (!snap) {
      const alias = folded.get(key.toLowerCase())
      if (alias !== undefined) snap = entry(alias)
    }
    const { providerId, modelId } = splitKey(key)
    if (!GATEWAYS.has(providerId) || (snap && hasRate(snap))) return snap
    // A model whose id says free with no catalog entry is genuinely $0.
    if (isFree(modelId)) return snap ?? { inputCost: 0, outputCost: 0, cacheReadCost: 0, cacheWriteCost: 0 }
    return borrowRetail((lookupIndex ??= retailIndex(lookup)), key) ?? snap
  }

  return {
    get(key: string): PricingSnapshot | undefined {
      if (!memo.has(key)) memo.set(key, derive(key))
      return memo.get(key)
    },
  }
}
