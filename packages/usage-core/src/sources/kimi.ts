import { createHash } from "node:crypto"
import { readdir, readFile, stat } from "node:fs/promises"
import { normalizeModelKey } from "../model-aliases"
import type { UsageSlice } from "../types"

type KimiStatusUpdate = {
  timestamp?: number
  message?: {
    type?: string
    payload?: {
      token_usage?: {
        input_other?: number
        output?: number
        input_cache_read?: number
        input_cache_creation?: number
      }
      message_id?: string
    }
  }
}

async function collectJsonlFiles(targetPath: string): Promise<string[]> {
  const targetStat = await stat(targetPath)

  if (targetStat.isFile()) {
    return targetPath.endsWith(".jsonl") ? [targetPath] : []
  }

  const entries = await readdir(targetPath, { withFileTypes: true })
  const files = await Promise.all(
    entries.map(async (entry) => {
      const childPath = `${targetPath}/${entry.name}`
      if (entry.isDirectory()) {
        return collectJsonlFiles(childPath)
      }
      return childPath.endsWith(".jsonl") ? [childPath] : []
    }),
  )

  return files.flat()
}

function localDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

function toDay(value?: number): string {
  if (value === undefined || value === null) return localDate(new Date())
  const ms = value < 1_000_000_000_000 ? value * 1000 : value
  const date = new Date(ms)
  return Number.isNaN(date.getTime()) ? localDate(new Date()) : localDate(date)
}

function hashId(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

export async function readKimiUsage(targetPath: string): Promise<UsageSlice[]> {
  const files = await collectJsonlFiles(targetPath)
  const rows: UsageSlice[] = []

  for (const file of files) {
    const content = await readFile(file, "utf8")
    for (const line of content.split("\n")) {
      if (!line.trim()) continue
      let parsed: KimiStatusUpdate
      try {
        parsed = JSON.parse(line) as KimiStatusUpdate
      } catch {
        continue
      }

      if (parsed.message?.type !== "StatusUpdate") continue
      const usage = parsed.message.payload?.token_usage
      if (!usage) continue

      const normalized = normalizeModelKey("moonshotai", "kimi-k2.5")
      const messageId = parsed.message.payload?.message_id ?? `${file}:${parsed.timestamp}`

      rows.push({
        source: "kimi",
        provider: normalized.provider,
        model: normalized.model,
        day: toDay(parsed.timestamp),
        startedAt: parsed.timestamp ? new Date(parsed.timestamp * 1000).toISOString() : null,
        inputTokens: usage.input_other ?? null,
        outputTokens: usage.output ?? null,
        cacheReadTokens: usage.input_cache_read ?? null,
        cacheWriteTokens: usage.input_cache_creation ?? null,
        exactCostUsd: null,
        sourceSessionHash: hashId(messageId),
      })
    }
  }

  return rows
}
