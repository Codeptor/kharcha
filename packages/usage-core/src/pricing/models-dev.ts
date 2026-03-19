import { z } from "zod"
import type { PricingSnapshot } from "../types"

export type ModelsDevCatalogRow = {
  providerId: string
  modelId: string
  inputCost: number | null
  outputCost: number | null
  cacheReadCost: number | null
  cacheWriteCost: number | null
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
  })
  .passthrough()

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

function normalizeCost(cost: z.infer<typeof nestedCostSchema> | undefined) {
  return {
    inputCost: cost?.input ?? null,
    outputCost: cost?.output ?? null,
    cacheReadCost: cost?.cache_read ?? cost?.cacheRead ?? null,
    cacheWriteCost: cost?.cache_write ?? cost?.cacheWrite ?? null,
  }
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

export async function fetchModelsDevCatalog(): Promise<ModelsDevCatalogRow[]> {
  const response = await fetch("https://models.dev/api.json", {
    headers: { accept: "application/json" },
  })
  const json = (await response.json()) as unknown
  return parseModelsDevCatalog(json)
}

export function toPricingSnapshot(row: ModelsDevCatalogRow): PricingSnapshot {
  return {
    inputCost: row.inputCost,
    outputCost: row.outputCost,
    cacheReadCost: row.cacheReadCost,
    cacheWriteCost: row.cacheWriteCost,
  }
}
