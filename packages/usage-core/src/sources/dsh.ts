import { createHash } from "node:crypto"
import { readdir, readFile, stat } from "node:fs/promises"
import { normalizeModelKey } from "../model-aliases"
import type { UsageSlice } from "../types"

type DshUsage = {
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  totalTokens?: number
  reasoningTokens?: number
}

type DshLine = {
  type?: string
  id?: string
  time?: number
  data?: {
    provider?: string
    model?: string
    usage?: DshUsage
    // request/header carries the provider and model the request was made with
    header?: { config?: { provider?: string; model?: string } }
  }
}

function localDay(epochMs: number): string {
  const date = new Date(epochMs)
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

async function collectSessionFiles(targetPath: string): Promise<string[]> {
  const info = await stat(targetPath)
  if (info.isFile()) return [targetPath]

  const entries = await readdir(targetPath, { withFileTypes: true })
  const found = await Promise.all(
    entries.map(async entry => {
      const childPath = `${targetPath}/${entry.name}`
      if (entry.isDirectory()) return collectSessionFiles(childPath)
      return childPath.endsWith(".jsonl.zstd") || childPath.endsWith(".jsonl") ? [childPath] : []
    })
  )
  return found.flat()
}

async function sessionLines(path: string): Promise<string[]> {
  if (path.endsWith(".zstd")) {
    const compressed = await readFile(path)
    return new TextDecoder().decode(Bun.zstdDecompressSync(new Uint8Array(compressed))).split("\n")
  }
  return (await readFile(path, "utf8")).split("\n")
}

/**
 * Reads DeepSeek Harness usage from its session transcripts.
 *
 * The harness's cost-meter ledger is a snapshot its UI writes, so it stops at
 * whenever that UI was last open: the ledger's final day was hours short of the
 * truth. The session transcripts carry one usage record per assistant response
 * and are the record that keeps up. They report input, output and cache-read
 * tokens with no cost, so those rows are priced from the catalog.
 *
 * `sinceEpochMs` narrows the read for consumers that only need a recent window:
 * a session file last written before then cannot hold an in-window response.
 */
export async function readDshUsage(targetPath: string, options: { sinceEpochMs?: number } = {}): Promise<UsageSlice[]> {
  const rows: UsageSlice[] = []
  const seen = new Set<string>()
  const files = await collectSessionFiles(targetPath)

  for (const file of files) {
    if (options.sinceEpochMs !== undefined) {
      const info = await stat(file)
      if (info.mtimeMs < options.sinceEpochMs) continue
    }

    let provider = "deepseek-official"
    let model = "unknown"

    for (const line of await sessionLines(file)) {
      if (!line.trim()) continue

      let parsed: DshLine
      try {
        parsed = JSON.parse(line) as DshLine
      } catch {
        continue
      }

      // The harness picks a provider and model per session and can switch.
      // Older sessions record it on the request header instead of a selection.
      if (parsed.type === "model/selection") {
        provider = parsed.data?.provider ?? provider
        model = parsed.data?.model ?? model
        continue
      }
      if (parsed.type === "request/header") {
        provider = parsed.data?.header?.config?.provider ?? provider
        model = parsed.data?.header?.config?.model ?? model
        continue
      }

      if (parsed.type !== "assistant/message") continue
      const usage = parsed.data?.usage
      if (!usage) continue

      const startedMs = parsed.time
      if (typeof startedMs !== "number" || !Number.isFinite(startedMs)) continue
      if (options.sinceEpochMs !== undefined && startedMs < options.sinceEpochMs) continue

      const key = parsed.id
      if (key) {
        if (seen.has(key)) continue
        seen.add(key)
      }

      const inputTokens = usage.inputTokens ?? 0
      const outputTokens = usage.outputTokens ?? 0
      const cacheReadTokens = usage.cacheReadTokens ?? 0
      const cacheWriteTokens = usage.cacheWriteTokens ?? 0
      if (inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens === 0) continue

      const normalized = normalizeModelKey(provider, model)
      rows.push({
        source: "dsh",
        provider: normalized.provider,
        model: normalized.model,
        day: localDay(startedMs),
        startedAt: new Date(startedMs).toISOString(),
        inputTokens,
        outputTokens,
        cacheReadTokens,
        cacheWriteTokens,
        exactCostUsd: null,
        sourceSessionHash: createHash("sha256").update(`dsh:${file}:${key ?? startedMs}`).digest("hex"),
      })
    }
  }

  return rows
}
