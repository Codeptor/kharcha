import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { normalizeModelKey } from "../model-aliases"
import type { UsageSlice } from "../types"

type ModelUsage = {
  inputTokens?: number
  outputTokens?: number
  cacheReadInputTokens?: number
  cacheCreationInputTokens?: number
}

type DailyModelTokens = {
  date: string
  tokensByModel: Record<string, number>
}

type StatsCache = {
  modelUsage?: Record<string, ModelUsage>
  dailyModelTokens?: DailyModelTokens[]
}

type TokenBreakdown = {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

function keyFor(day: string, provider: string, model: string) {
  return `${day}|${provider}|${model}`
}

function totalsFromJsonl(rows: UsageSlice[]): Map<string, TokenBreakdown> {
  const map = new Map<string, TokenBreakdown>()
  for (const row of rows) {
    if (row.source !== "claude-code") continue
    const k = keyFor(row.day, row.provider, row.model)
    const cur = map.get(k) ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
    cur.input += row.inputTokens ?? 0
    cur.output += row.outputTokens ?? 0
    cur.cacheRead += row.cacheReadTokens ?? 0
    cur.cacheWrite += row.cacheWriteTokens ?? 0
    map.set(k, cur)
  }
  return map
}

export async function readClaudeStatsCache(cachePath: string, priorRows: UsageSlice[]): Promise<UsageSlice[]> {
  const content = await readFile(cachePath, "utf8")
  const cache = JSON.parse(content) as StatsCache

  const modelUsage = cache.modelUsage ?? {}
  const daily = cache.dailyModelTokens ?? []
  if (daily.length === 0) return []

  const modelInOutTotals = new Map<string, number>()
  const modelSplits = new Map<string, TokenBreakdown>()
  for (const [model, usage] of Object.entries(modelUsage)) {
    const split: TokenBreakdown = {
      input: usage.inputTokens ?? 0,
      output: usage.outputTokens ?? 0,
      cacheRead: usage.cacheReadInputTokens ?? 0,
      cacheWrite: usage.cacheCreationInputTokens ?? 0,
    }
    const inOut = split.input + split.output
    if (inOut === 0) continue
    modelInOutTotals.set(model, inOut)
    modelSplits.set(model, split)
  }

  const jsonlTotals = totalsFromJsonl(priorRows)
  const rows: UsageSlice[] = []

  for (const entry of daily) {
    for (const [model, dayInOut] of Object.entries(entry.tokensByModel)) {
      if (!dayInOut || dayInOut <= 0) continue
      const inOut = modelInOutTotals.get(model)
      const split = modelSplits.get(model)
      if (!inOut || !split) continue

      const normalized = normalizeModelKey("anthropic", model)
      const ratio = dayInOut / inOut
      const dayInput = Math.round(split.input * ratio)
      const dayOutput = Math.round(split.output * ratio)
      const dayCacheRead = Math.round(split.cacheRead * ratio)
      const dayCacheWrite = Math.round(split.cacheWrite * ratio)

      const existing =
        jsonlTotals.get(keyFor(entry.date, normalized.provider, normalized.model)) ??
        { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }

      const deficitInput = Math.max(0, dayInput - existing.input)
      const deficitOutput = Math.max(0, dayOutput - existing.output)
      const deficitCacheRead = Math.max(0, dayCacheRead - existing.cacheRead)
      const deficitCacheWrite = Math.max(0, dayCacheWrite - existing.cacheWrite)

      if (deficitInput + deficitOutput + deficitCacheRead + deficitCacheWrite === 0) continue

      const sessionHash = createHash("sha256")
        .update(`stats-cache:${normalized.provider}:${normalized.model}:${entry.date}`)
        .digest("hex")

      rows.push({
        source: "claude-code",
        provider: normalized.provider,
        model: normalized.model,
        day: entry.date,
        startedAt: null,
        inputTokens: deficitInput || null,
        outputTokens: deficitOutput || null,
        cacheReadTokens: deficitCacheRead || null,
        cacheWriteTokens: deficitCacheWrite || null,
        exactCostUsd: null,
        sourceSessionHash: sessionHash,
      })
    }
  }

  return rows
}
