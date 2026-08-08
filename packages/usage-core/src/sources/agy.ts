import { createHash } from "node:crypto"
import { createReadStream } from "node:fs"
import { createInterface } from "node:readline"
import { normalizeModelKey } from "../model-aliases"
import type { UsageSlice } from "../types"

type AgyUsageEvent = {
  at: string
  cacheCreationInputTokens?: number
  cacheReadTokens?: number
  eventId: string
  inputTokens: number
  modelId: string
  outputTokens: number
  version: 2
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
}

function parseAgyUsageEvent(input: unknown): AgyUsageEvent | null {
  if (!input || typeof input !== "object") return null
  const value = input as Record<string, unknown>
  if (
    value.version !== 2 ||
    typeof value.at !== "string" ||
    Number.isNaN(new Date(value.at).getTime()) ||
    typeof value.eventId !== "string" ||
    typeof value.modelId !== "string" ||
    !isNonNegativeInteger(value.inputTokens) ||
    !isNonNegativeInteger(value.outputTokens) ||
    (value.cacheReadTokens !== undefined &&
      !isNonNegativeInteger(value.cacheReadTokens)) ||
    (value.cacheCreationInputTokens !== undefined &&
      !isNonNegativeInteger(value.cacheCreationInputTokens))
  ) {
    return null
  }

  return value as AgyUsageEvent
}

function localDay(value: string): string {
  const date = new Date(value)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
}

function hashEventId(eventId: string): string {
  return createHash("sha256").update(eventId).digest("hex")
}

/**
 * Reads the local ledger produced by the configured AGY status-line callback.
 * AGY's SQLite conversation history keeps content and model selection but not
 * server-reported token counters, so only callback-captured events are valid.
 */
export async function readAgyUsage(targetPath: string): Promise<UsageSlice[]> {
  const rows: UsageSlice[] = []
  let previousSnapshot: { at: number; key: string } | null = null
  const lines = createInterface({
    input: createReadStream(targetPath, { encoding: "utf8" }),
    crlfDelay: Infinity,
  })

  for await (const line of lines) {
    if (!line.trim()) continue

    try {
      const event = parseAgyUsageEvent(JSON.parse(line) as unknown)
      if (!event) continue

      const at = new Date(event.at).getTime()
      const snapshotKey = JSON.stringify([
        event.modelId,
        event.inputTokens,
        event.outputTokens,
        event.cacheReadTokens ?? 0,
        event.cacheCreationInputTokens ?? 0,
      ])
      if (
        previousSnapshot?.key === snapshotKey &&
        at - previousSnapshot.at >= 0 &&
        at - previousSnapshot.at <= 10_000
      ) {
        continue
      }
      previousSnapshot = { at, key: snapshotKey }

      const normalized = normalizeModelKey("agy", event.modelId)
      rows.push({
        source: "agy",
        provider: normalized.provider,
        model: normalized.model,
        day: localDay(event.at),
        startedAt: event.at,
        inputTokens: event.inputTokens,
        outputTokens: event.outputTokens,
        cacheReadTokens: event.cacheReadTokens ?? 0,
        cacheWriteTokens: event.cacheCreationInputTokens ?? 0,
        exactCostUsd: null,
        requiresCacheWritePricing: (event.cacheCreationInputTokens ?? 0) > 0,
        sourceSessionHash: hashEventId(event.eventId),
      })
    } catch {
      continue
    }
  }

  return rows
}
