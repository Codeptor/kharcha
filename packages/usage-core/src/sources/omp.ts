import { createHash } from "node:crypto"
import { createReadStream } from "node:fs"
import { readdir, stat } from "node:fs/promises"
import { createInterface } from "node:readline"
import { normalizeModelKey } from "../model-aliases"
import type { UsageSlice } from "../types"

type OmpUsage = {
  input?: number
  output?: number
  cacheRead?: number
  cacheWrite?: number
  totalTokens?: number
  reasoningTokens?: number
  cost?: {
    input?: number
    output?: number
    cacheRead?: number
    cacheWrite?: number
    total?: number
  }
}

type OmpSessionLine = {
  type?: string
  id?: string
  timestamp?: string
  message?: {
    role?: string
    provider?: string
    model?: string
    responseId?: string
    usage?: OmpUsage
  }
}

function localDay(epochMs: number): string {
  const date = new Date(epochMs)
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

async function collectSessionFiles(targetPath: string): Promise<string[]> {
  const info = await stat(targetPath)
  if (info.isFile()) return targetPath.endsWith(".jsonl") ? [targetPath] : []

  const entries = await readdir(targetPath, { withFileTypes: true })
  const found = await Promise.all(
    entries.map(async entry => {
      const childPath = `${targetPath}/${entry.name}`
      if (entry.isDirectory()) return collectSessionFiles(childPath)
      return childPath.endsWith(".jsonl") ? [childPath] : []
    })
  )
  return found.flat()
}

/**
 * Reads omp (oh-my-pi) usage from its session transcripts.
 *
 * The harness's `stats.db` is a derived view that only ingests session files on
 * its own schedule, so it lags by hours and misses sessions entirely; the
 * transcripts are the record that carries every assistant response's counters
 * and the harness's own cost calculation, which is used as exact.
 *
 * `sinceEpochMs` narrows the read for consumers that only need a recent window:
 * a file last written before then cannot hold an in-window response.
 */
export async function readOmpUsage(targetPath: string, options: { sinceEpochMs?: number } = {}): Promise<UsageSlice[]> {
  const rows: UsageSlice[] = []
  const seen = new Set<string>()
  const files = await collectSessionFiles(targetPath)

  for (const file of files) {
    if (options.sinceEpochMs !== undefined) {
      const info = await stat(file)
      if (info.mtimeMs < options.sinceEpochMs) continue
    }

    const lines = createInterface({
      input: createReadStream(file, { encoding: "utf8" }),
      crlfDelay: Infinity,
    })

    for await (const line of lines) {
      if (!line.trim()) continue

      let parsed: OmpSessionLine
      try {
        parsed = JSON.parse(line) as OmpSessionLine
      } catch {
        continue
      }

      const message = parsed.message
      const usage = message?.usage
      if (parsed.type !== "message" || message?.role !== "assistant" || !usage) continue

      const startedAt = parsed.timestamp
      const startedMs = startedAt ? new Date(startedAt).getTime() : NaN
      if (Number.isNaN(startedMs)) continue
      if (options.sinceEpochMs !== undefined && startedMs < options.sinceEpochMs) continue

      // One response per record id; omp only repeats a response when a session
      // is replayed, and the replay carries the same id.
      const key = message.responseId ?? parsed.id
      if (key) {
        if (seen.has(key)) continue
        seen.add(key)
      }

      const normalized = normalizeModelKey(message.provider ?? "omp", message.model ?? "unknown")
      const cacheWriteTokens = usage.cacheWrite ?? 0
      rows.push({
        source: "omp",
        provider: normalized.provider,
        model: normalized.model,
        day: localDay(startedMs),
        startedAt: startedAt ?? null,
        inputTokens: usage.input ?? 0,
        outputTokens: usage.output ?? 0,
        cacheReadTokens: usage.cacheRead ?? 0,
        cacheWriteTokens,
        exactCostUsd: finiteOrNull(usage.cost?.total),
        sourceSessionHash: createHash("sha256")
          .update(`${file}:${key ?? startedMs}`)
          .digest("hex"),
      })
    }
  }

  return rows
}
