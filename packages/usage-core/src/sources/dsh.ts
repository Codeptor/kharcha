import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { normalizeModelKey } from "../model-aliases"
import type { UsageSlice } from "../types"

type DshModelTotals = {
  input?: number
  output?: number
  cacheRead?: number
  cacheWrite?: number
  cost?: number
  apiCost?: number
}

type DshDay = DshModelTotals & {
  /** Reported separately by the harness; already counted inside `output`. */
  reasoning?: number
  byProviderModel?: Record<string, DshModelTotals>
}

type DshLedger = {
  version?: number
  days?: Record<string, DshDay>
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

/**
 * Reads the DeepSeek Harness cost-meter ledger. It aggregates per local day and
 * per `provider:model`, with the harness's own cost accounting, so the cost is
 * exact rather than priced here. `reasoning` is not added to the output bucket:
 * the harness reports it beside the completion tokens that already include it.
 *
 * `sinceDay` narrows the read for consumers that only need a recent window.
 */
export async function readDshUsage(targetPath: string, options: { sinceDay?: string } = {}): Promise<UsageSlice[]> {
  const ledger = JSON.parse(await readFile(targetPath, "utf8")) as DshLedger
  const rows: UsageSlice[] = []

  for (const [day, entry] of Object.entries(ledger?.days ?? {})) {
    if (options.sinceDay && day < options.sinceDay) continue

    for (const [key, totals] of Object.entries(entry?.byProviderModel ?? {})) {
      const separator = key.indexOf(":")
      if (separator <= 0) continue

      const inputTokens = totals.input ?? 0
      const outputTokens = totals.output ?? 0
      const cacheReadTokens = totals.cacheRead ?? 0
      const cacheWriteTokens = totals.cacheWrite ?? 0
      if (inputTokens === 0 && outputTokens === 0 && cacheReadTokens === 0 && cacheWriteTokens === 0) continue

      const normalized = normalizeModelKey(key.slice(0, separator), key.slice(separator + 1))
      rows.push({
        source: "dsh",
        provider: normalized.provider,
        model: normalized.model,
        day,
        startedAt: null,
        inputTokens,
        outputTokens,
        cacheReadTokens,
        cacheWriteTokens,
        exactCostUsd: finiteOrNull(totals.apiCost) ?? finiteOrNull(totals.cost),
        sourceSessionHash: createHash("sha256").update(`dsh:${day}:${key}`).digest("hex"),
      })
    }
  }

  return rows
}
