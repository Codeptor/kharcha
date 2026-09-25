import { createHash } from "node:crypto"
import { Database } from "bun:sqlite"
import { normalizeModelKey } from "../model-aliases"
import type { UsageSlice } from "../types"

type OmpMessageRow = {
  session_file: string
  entry_id: string
  model: string
  provider: string
  timestamp: number
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cache_write_tokens: number
  cost_total: number
  cost_unpriced: number
}

function localDay(epochMs: number): string {
  const date = new Date(epochMs)
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

/**
 * Reads the omp (oh-my-pi) harness usage store. It keeps one row per assistant
 * message with the server-reported counters and its own cost accounting, so the
 * cost is exact rather than priced here. `cost_unpriced` marks rows the harness
 * could not price, which must stay unpriced instead of becoming a $0 estimate.
 *
 * `sinceEpochMs` narrows the read for consumers that only need a recent window.
 */
export async function readOmpUsage(targetPath: string, options: { sinceEpochMs?: number } = {}): Promise<UsageSlice[]> {
  const db = new Database(targetPath, { readonly: true })
  const rows: UsageSlice[] = []
  const columns = `session_file, entry_id, model, provider, timestamp,
                   input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
                   cost_total, cost_unpriced`

  try {
    const messages =
      options.sinceEpochMs === undefined
        ? db.query<OmpMessageRow, []>(`select ${columns} from messages`).all()
        : db.query<OmpMessageRow, [number]>(`select ${columns} from messages where timestamp >= ?`).all(options.sinceEpochMs)

    for (const message of messages) {
      const normalized = normalizeModelKey(message.provider, message.model)
      rows.push({
        source: "omp",
        provider: normalized.provider,
        model: normalized.model,
        day: localDay(message.timestamp),
        startedAt: new Date(message.timestamp).toISOString(),
        inputTokens: message.input_tokens,
        outputTokens: message.output_tokens,
        cacheReadTokens: message.cache_read_tokens,
        cacheWriteTokens: message.cache_write_tokens,
        exactCostUsd: message.cost_unpriced === 0 ? message.cost_total : null,
        preventEstimatedCost: message.cost_unpriced !== 0,
        sourceSessionHash: createHash("sha256")
          .update(`${message.session_file}:${message.entry_id}`)
          .digest("hex"),
      })
    }
  } finally {
    db.close()
  }

  return rows
}
