import { z } from "zod"
import type { PricingSnapshot, PricingTier } from "../types"

export type ModelsDevCatalogRow = {
  providerId: string
  modelId: string
  inputCost: number | null
  outputCost: number | null
  cacheReadCost: number | null
  cacheWriteCost: number | null
  tiers?: PricingTier[]
}

const flatRowSchema = z.object({
  providerId: z.string(),
  modelId: z.string(),
  inputCost: z.number().nullable().optional(),
  outputCost: z.number().nullable().optional(),
  cacheReadCost: z.number().nullable().optional(),
  cacheWriteCost: z.number().nullable().optional(),
})

const nestedCostSchema = z
  .object({
    input: z.number().nullable().optional(),
    output: z.number().nullable().optional(),
    cache_read: z.number().nullable().optional(),
    cache_write: z.number().nullable().optional(),
    cacheRead: z.number().nullable().optional(),
    cacheWrite: z.number().nullable().optional(),
    tiers: z.array(z.unknown()).optional(),
    context_over_200k: z.unknown().optional(),
  })
  .passthrough()

const tierSchema = z
  .object({
    input: z.number().nullable().optional(),
    output: z.number().nullable().optional(),
    cache_read: z.number().nullable().optional(),
    cache_write: z.number().nullable().optional(),
    tier: z.object({ type: z.string(), size: z.number() }).optional(),
  })
  .passthrough()

const legacyTierSchema = tierSchema.omit({ tier: true })

const nestedModelSchema = z
  .object({
    id: z.string().optional(),
    cost: nestedCostSchema.optional(),
  })
  .passthrough()

const nestedProviderSchema = z
  .object({
    id: z.string().optional(),
    models: z.record(nestedModelSchema).optional(),
  })
  .passthrough()

function parseTiers(
  cost: z.infer<typeof nestedCostSchema> | undefined,
  base: Omit<PricingSnapshot, "tiers">
): PricingTier[] | undefined {
  if (!cost) return undefined

  // A field a tier leaves out bills at the base rate.
  const inherit = (value: number | null | undefined, fallback: number | null) =>
    value === undefined ? fallback : value
  const tiers: PricingTier[] = []

  for (const raw of cost.tiers ?? []) {
    const parsed = tierSchema.safeParse(raw)
    if (!parsed.success) continue
    const { tier, ...rates } = parsed.data
    if (tier?.type !== "context" || !(tier.size > 0)) continue
    tiers.push({
      promptTokensAbove: tier.size,
      inputCost: inherit(rates.input, base.inputCost),
      outputCost: inherit(rates.output, base.outputCost),
      cacheReadCost: inherit(rates.cache_read, base.cacheReadCost),
      cacheWriteCost: inherit(rates.cache_write, base.cacheWriteCost),
    })
  }

  if (cost.tiers === undefined) {
    const legacy = legacyTierSchema.safeParse(cost.context_over_200k)
    if (legacy.success) {
      tiers.push({
        promptTokensAbove: 200_000,
        inputCost: inherit(legacy.data.input, base.inputCost),
        outputCost: inherit(legacy.data.output, base.outputCost),
        cacheReadCost: inherit(legacy.data.cache_read, base.cacheReadCost),
        cacheWriteCost: inherit(legacy.data.cache_write, base.cacheWriteCost),
      })
    }
  }

  if (tiers.length === 0) return undefined
  return tiers.sort((a, b) => a.promptTokensAbove - b.promptTokensAbove)
}

function normalizeCost(cost: z.infer<typeof nestedCostSchema> | undefined) {
  const base = {
    inputCost: cost?.input ?? null,
    outputCost: cost?.output ?? null,
    cacheReadCost: cost?.cache_read ?? cost?.cacheRead ?? null,
    cacheWriteCost: cost?.cache_write ?? cost?.cacheWrite ?? null,
  }
  const tiers = parseTiers(cost, base)
  return tiers ? { ...base, tiers } : base
}

function parseFlatCatalog(input: unknown): ModelsDevCatalogRow[] {
  const parsed = z.array(flatRowSchema).safeParse(input)
  if (!parsed.success) {
    return []
  }

  return parsed.data.map((row) => ({
    providerId: row.providerId,
    modelId: row.modelId,
    inputCost: row.inputCost ?? null,
    outputCost: row.outputCost ?? null,
    cacheReadCost: row.cacheReadCost ?? null,
    cacheWriteCost: row.cacheWriteCost ?? null,
  }))
}

function parseNestedCatalog(input: Record<string, unknown>): ModelsDevCatalogRow[] {
  const rows: ModelsDevCatalogRow[] = []

  for (const [providerKey, rawProvider] of Object.entries(input)) {
    const provider = nestedProviderSchema.safeParse(rawProvider)
    if (!provider.success) {
      continue
    }

    const providerId = provider.data.id ?? providerKey
    for (const [modelKey, rawModel] of Object.entries(provider.data.models ?? {})) {
      const model = nestedModelSchema.safeParse(rawModel)
      if (!model.success) {
        continue
      }

      rows.push({
        providerId,
        modelId: model.data.id ?? modelKey,
        ...normalizeCost(model.data.cost),
      })
    }
  }

  return rows
}

export function parseModelsDevCatalog(input: unknown): ModelsDevCatalogRow[] {
  if (Array.isArray(input)) {
    return parseFlatCatalog(input)
  }

  if (input && typeof input === "object") {
    return parseNestedCatalog(input as Record<string, unknown>)
  }

  return []
}

export async function fetchModelsDevJson(): Promise<unknown> {
  const response = await fetch("https://models.dev/api.json", {
    headers: { accept: "application/json" },
  })
  if (!response.ok) throw new Error(`models.dev responded ${response.status} ${response.statusText}`)
  return (await response.json()) as unknown
}

export function toPricingSnapshot(row: ModelsDevCatalogRow): PricingSnapshot {
  return {
    inputCost: row.inputCost,
    outputCost: row.outputCost,
    cacheReadCost: row.cacheReadCost,
    cacheWriteCost: row.cacheWriteCost,
    ...(row.tiers ? { tiers: row.tiers } : {}),
  }
}
