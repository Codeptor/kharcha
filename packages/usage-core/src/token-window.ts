import { createHash } from "node:crypto"
import { open, readdir, readFile, rename, stat, writeFile } from "node:fs/promises"
import { normalizeModelKey } from "./model-aliases"
import { CUSTOM_PRICING } from "./pricing/custom-pricing"
import { readAgyUsage } from "./sources/agy"
import { toDay } from "./sources/claude-code"
import { readCodexRollouts } from "./sources/codex"
import { readDshUsage } from "./sources/dsh"
import { readKimiUsage } from "./sources/kimi"
import { readOmpUsage } from "./sources/omp"
import { readOpenCodeUsage } from "./sources/opencode"
import type { PricingSnapshot, UsageSlice } from "./types"

export type TokenCounters = {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  cacheWrite1hTokens: number
}

export type TokenWindowModelTotals = TokenCounters & {
  /** Normalized `provider:model`, the same key the sync pipeline stores. */
  model: string
  totalTokens: number
  costUsd: number | null
}

export type TokenWindowSourceTotals = {
  id: UsageSlice["source"]
  totalTokens: number
}

export type TokenWindow = {
  schema: 1
  generatedAt: string
  windowDays: number
  windowStart: string
  windowEnd: string
  /** Every source that contributed in-window tokens, largest first. */
  sources: TokenWindowSourceTotals[]
  totals: TokenCounters & {
    totalTokens: number
    costUsd: number | null
    unpricedModels: string[]
  }
  /** One entry per window day, ascending, zero-filled. */
  days: { day: string; totalTokens: number }[]
  models: TokenWindowModelTotals[]
  scan: {
    files: number
    filesRead: number
    bytesRead: number
    cold: boolean
    sources: { id: UsageSlice["source"]; rows: number; durationMs: number; error?: string }[]
    durationMs: number
  }
}

type ClaudeUsageLine = {
  timestamp?: string
  requestId?: string
  message?: {
    id?: string
    model?: string
    usage?: {
      input_tokens?: number
      output_tokens?: number
      cache_read_input_tokens?: number
      cache_creation_input_tokens?: number
      cache_creation?: { ephemeral_1h_input_tokens?: number }
    }
  }
}

type FileEntry = {
  /** Byte offset of the first unread byte, always on a line boundary. */
  offset: number
  /** Size at the last read, so truncation or rewrite is detectable. */
  size: number
  /** day -> normalized model -> counters, limited to the tracked window. */
  days: Record<string, Record<string, TokenCounters>>
  /**
   * day -> concatenated 8-byte hashes of the response keys this file has
   * already contributed. Kept per file so a rewritten file can forget them and
   * be counted again. A response can be logged far from its first appearance
   * when a session is resumed or replayed, so this spans the whole window
   * rather than a window of the last few keys.
   */
  keys: Record<string, string>
}

type WindowCache = {
  schema: 3
  windowDays: number
  source: string
  files: Record<string, FileEntry>
}

const KEY_HASH_LENGTH = 11

function hashResponseKey(key: string): string {
  return createHash("sha1").update(key).digest("base64url").slice(0, KEY_HASH_LENGTH)
}

/**
 * Tokens accumulate per model, with the part that still needs a price kept
 * apart from the part whose source reported its own cost, so a model used by
 * two harnesses is neither priced twice nor priced at zero.
 */
type ModelTotals = {
  counters: TokenCounters
  pricedCounters: TokenCounters
  unpricedCounters: TokenCounters
  exactCostUsd: number
  hasExactCost: boolean
}

export type TokenWindowSources = {
  omp?: string | null
  dsh?: string | null
  agy?: string | null
  kimi?: string | null
  codex?: string | null
  codexCachePath?: string | null
  opencode?: string | null
}

export type TokenWindowOptions = {
  /** Directory holding the Claude Code JSONL transcripts. */
  root: string
  /** Trailing local days to include, today included. */
  windowDays?: number
  /** Incremental state for the Claude Code transcripts; null forces a cold read. */
  cachePath?: string | null
  /** Snapshot written by the hourly sync; keys are `provider:model`. */
  pricingPath?: string | null
  /** Other local stores to fold in. Omitted sources are simply not read. */
  sources?: TokenWindowSources
  now?: Date
}

const READ_CHUNK_BYTES = 4 * 1024 * 1024

function emptyCounters(): TokenCounters {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    cacheWrite1hTokens: 0,
  }
}

function addCounters(target: TokenCounters, source: TokenCounters): void {
  target.inputTokens += source.inputTokens
  target.outputTokens += source.outputTokens
  target.cacheReadTokens += source.cacheReadTokens
  target.cacheWriteTokens += source.cacheWriteTokens
  target.cacheWrite1hTokens += source.cacheWrite1hTokens
}

function totalOf(counters: TokenCounters): number {
  return counters.inputTokens + counters.outputTokens + counters.cacheReadTokens + counters.cacheWriteTokens
}

function emptyModelTotals(): ModelTotals {
  return {
    counters: emptyCounters(),
    pricedCounters: emptyCounters(),
    unpricedCounters: emptyCounters(),
    exactCostUsd: 0,
    hasExactCost: false,
  }
}

function localDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

function shiftDays(day: string, delta: number): string {
  const [y, m, d] = day.split("-").map(Number)
  const date = new Date(y, m - 1, d)
  date.setDate(date.getDate() + delta)
  return localDate(date)
}

export function windowStartDay(now: Date, windowDays: number): string {
  return shiftDays(localDate(now), -(windowDays - 1))
}

async function collectJsonlFiles(targetPath: string): Promise<string[]> {
  const entries = await readdir(targetPath, { withFileTypes: true })
  const found = await Promise.all(
    entries.map(async entry => {
      const childPath = `${targetPath}/${entry.name}`
      if (entry.isDirectory()) return collectJsonlFiles(childPath)
      return childPath.endsWith(".jsonl") ? [childPath] : []
    })
  )
  return found.flat()
}

function parseUsageLine(line: string): { key: string | null; day: string; model: string; counters: TokenCounters } | null {
  const trimmed = line.trim()
  if (!trimmed) return null

  let parsed: ClaudeUsageLine
  try {
    parsed = JSON.parse(trimmed) as ClaudeUsageLine
  } catch {
    return null
  }

  const model = parsed.message?.model
  if (!model || model === "<synthetic>") return null

  const usage = parsed.message?.usage
  const cacheWriteTokens = usage?.cache_creation_input_tokens ?? 0
  const counters: TokenCounters = {
    inputTokens: usage?.input_tokens ?? 0,
    outputTokens: usage?.output_tokens ?? 0,
    cacheReadTokens: usage?.cache_read_input_tokens ?? 0,
    cacheWriteTokens,
    cacheWrite1hTokens: Math.min(usage?.cache_creation?.ephemeral_1h_input_tokens ?? 0, cacheWriteTokens),
  }

  const messageId = parsed.message?.id
  const normalized = normalizeModelKey("anthropic", model)
  return {
    key: messageId ? `${messageId}:${parsed.requestId ?? ""}` : null,
    day: toDay(parsed.timestamp),
    model: `${normalized.provider}:${normalized.model}`,
    counters,
  }
}

/**
 * Reads the bytes appended since the last run, advancing the offset only past
 * complete lines so a write in flight is retried instead of half-counted.
 */
async function ingestFile(path: string, entry: FileEntry, windowStart: string, seen: Set<string>): Promise<number> {
  const handle = await open(path, "r")
  try {
    const info = await handle.stat()
    if (info.size < entry.offset) {
      // Truncated or rewritten: the file has to be replayed from the start, and
      // the keys it contributed have to be forgotten or the replay counts as
      // duplicates and the contents vanish from the window.
      for (const hash of keyHashes(entry.keys ?? {})) seen.delete(hash)
      entry.offset = 0
      entry.days = {}
      entry.keys = {}
    }
    const start = entry.offset
    if (info.size === start) return 0

    let position = start
    let carry = Buffer.alloc(0)

    while (position < info.size) {
      const want = Math.min(READ_CHUNK_BYTES, info.size - position)
      const buffer = Buffer.allocUnsafe(want)
      const { bytesRead } = await handle.read(buffer, 0, want, position)
      if (bytesRead <= 0) break
      position += bytesRead

      const chunk = buffer.subarray(0, bytesRead)
      const data = carry.length > 0 ? Buffer.concat([carry, chunk]) : chunk
      const lastNewline = data.lastIndexOf(0x0a)
      if (lastNewline === -1) {
        carry = Buffer.from(data)
        continue
      }

      for (const line of data.subarray(0, lastNewline).toString("utf8").split("\n")) {
        const record = parseUsageLine(line)
        if (!record) continue
        if (record.key) {
          const hash = hashResponseKey(record.key)
          if (seen.has(hash)) continue
          seen.add(hash)
          if (record.day >= windowStart) {
            const blobs = (entry.keys ??= {})
            blobs[record.day] = (blobs[record.day] ?? "") + hash
          }
        }
        if (record.day < windowStart) continue
        const day = (entry.days[record.day] ??= {})
        addCounters((day[record.model] ??= emptyCounters()), record.counters)
      }

      carry = Buffer.from(data.subarray(lastNewline + 1))
    }

    entry.offset = position - carry.length
    entry.size = info.size
    return entry.offset - start
  } finally {
    await handle.close()
  }
}

function pruneCache(cache: WindowCache, windowStart: string, livePaths: Set<string>): void {
  for (const [path, entry] of Object.entries(cache.files)) {
    for (const day of Object.keys(entry.days)) {
      if (day < windowStart) delete entry.days[day]
    }
    // Keys for days outside the window can no longer be needed: a response from
    // one of those days is dropped by the day filter even if it reappears.
    for (const day of Object.keys(entry.keys ?? {})) {
      if (day < windowStart) delete entry.keys[day]
    }
    // Entries survive with empty buckets on purpose: they are the record that
    // the file has been read to `offset`, which is what keeps a file that holds
    // no in-window counters from being replayed in full on every run. Only a
    // file that no longer exists drops out.
    if (!livePaths.has(path)) delete cache.files[path]
  }
}

async function loadCache(cachePath: string | null, windowDays: number, source: string): Promise<WindowCache> {
  const fresh: WindowCache = { schema: 3, windowDays, source, files: {} }
  if (!cachePath) return fresh
  try {
    const parsed = JSON.parse(await readFile(cachePath, "utf8")) as WindowCache
    // A different root, window size or schema cannot reuse buckets or offsets.
    if (parsed?.schema !== 3 || parsed.windowDays !== windowDays || parsed.source !== source || typeof parsed.files !== "object")
      return fresh
    return parsed
  } catch {
    return fresh
  }
}

function keyHashes(blobs: Record<string, string>): string[] {
  const hashes: string[] = []
  for (const blob of Object.values(blobs)) {
    for (let offset = 0; offset < blob.length; offset += KEY_HASH_LENGTH) hashes.push(blob.slice(offset, offset + KEY_HASH_LENGTH))
  }
  return hashes
}

function loadSeenKeys(cache: WindowCache): Set<string> {
  const seen = new Set<string>()
  for (const entry of Object.values(cache.files)) {
    for (const hash of keyHashes(entry.keys ?? {})) seen.add(hash)
  }
  return seen
}

async function loadPricing(pricingPath: string | null): Promise<Map<string, PricingSnapshot>> {
  const lookup = new Map<string, PricingSnapshot>()
  if (pricingPath) {
    try {
      const parsed = JSON.parse(await readFile(pricingPath, "utf8")) as { catalog?: Record<string, PricingSnapshot> }
      for (const [key, snapshot] of Object.entries(parsed?.catalog ?? {})) {
        if (snapshot) lookup.set(key, snapshot)
      }
    } catch {
      // A missing snapshot is not fatal: the bundled overrides still price the
      // models they cover, and anything left over is reported as unpriced.
    }
  }
  for (const [key, snapshot] of Object.entries(CUSTOM_PRICING)) {
    if (!lookup.has(key)) lookup.set(key, snapshot)
  }
  return lookup
}

function priceCounters(counters: TokenCounters, rate: PricingSnapshot | undefined): number | null {
  if (!rate || (rate.inputCost == null && rate.outputCost == null)) return null
  const cacheWrite = counters.cacheWriteTokens
  const cacheWrite1h = Math.min(counters.cacheWrite1hTokens, cacheWrite)
  return (
    (counters.inputTokens / 1_000_000) * (rate.inputCost ?? 0) +
    (counters.outputTokens / 1_000_000) * (rate.outputCost ?? 0) +
    (counters.cacheReadTokens / 1_000_000) * (rate.cacheReadCost ?? 0) +
    ((cacheWrite - cacheWrite1h) / 1_000_000) * (rate.cacheWriteCost ?? 0) +
    (cacheWrite1h / 1_000_000) * (rate.inputCost ?? 0) * 2
  )
}

type SourceRead = {
  id: UsageSlice["source"]
  rows: UsageSlice[]
  durationMs: number
  error?: string
}

/**
 * Reads every configured non-Claude store for the window. Each source is
 * optional and isolated: a store that is missing is skipped, and one that fails
 * to read is reported in the scan instead of failing the whole window.
 */
async function collectExternalRows(
  sources: TokenWindowSources,
  windowStart: string,
  windowStartMs: number
): Promise<SourceRead[]> {
  const readers: { id: UsageSlice["source"]; path: string | null | undefined; read: (path: string) => Promise<UsageSlice[]> }[] = [
    {
      id: "omp",
      path: sources.omp,
      read: path => readOmpUsage(path, { sinceEpochMs: windowStartMs }),
    },
    {
      id: "dsh",
      path: sources.dsh,
      read: path => readDshUsage(path, { sinceEpochMs: windowStartMs }),
    },
    { id: "agy", path: sources.agy, read: path => readAgyUsage(path) },
    { id: "kimi", path: sources.kimi, read: path => readKimiUsage(path) },
    {
      id: "codex",
      path: sources.codex,
      read: async path => (await readCodexRollouts(path, { cachePath: sources.codexCachePath ?? undefined })).rows,
    },
    {
      id: "opencode",
      path: sources.opencode,
      read: path => readOpenCodeUsage(path, { sinceEpochMs: windowStartMs }),
    },
  ]

  const results: SourceRead[] = []
  for (const reader of readers) {
    if (!reader.path) continue

    try {
      await stat(reader.path)
    } catch {
      continue
    }

    const startedAt = performance.now()
    try {
      const rows = await reader.read(reader.path)
      results.push({ id: reader.id, rows, durationMs: Math.round(performance.now() - startedAt) })
    } catch (error) {
      results.push({
        id: reader.id,
        rows: [],
        durationMs: Math.round(performance.now() - startedAt),
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
  return results
}

/**
 * Aggregates token counters over a trailing window of local days, from every
 * configured local agent store: Claude Code transcripts (read incrementally),
 * the omp and DeepSeek Harness stores, and the other harness readers the sync
 * pipeline uses.
 *
 * Claude Code responses are deduped by message.id + requestId, exactly as
 * readClaudeCodeUsage does, so the counts match the dashboard rather than the
 * ~2x-inflated raw-line totals. The window is day-grained: today plus the
 * previous windowDays - 1 days, each rolling off at local midnight.
 */
export async function runTokenWindow(options: TokenWindowOptions): Promise<TokenWindow> {
  const startedAt = performance.now()
  const now = options.now ?? new Date()
  const windowDays = options.windowDays ?? 7
  const windowStart = windowStartDay(now, windowDays)
  const windowEnd = localDate(now)
  const cachePath = options.cachePath === undefined ? null : options.cachePath
  const pricing = await loadPricing(options.pricingPath ?? null)
  const windowStartMs = new Date(`${windowStart}T00:00:00`).getTime()

  const byModel = new Map<string, ModelTotals>()
  const byDay = new Map<string, number>()
  const bySource = new Map<UsageSlice["source"], number>()

  // Claude Code: incremental over the JSONL transcripts
  const cache = await loadCache(cachePath, windowDays, options.root)
  const files = (await collectJsonlFiles(options.root)).sort()
  const livePaths = new Set(files)
  const seen = loadSeenKeys(cache)

  let filesRead = 0
  let bytesRead = 0
  let cold = false

  for (const path of files) {
    let entry = cache.files[path]
    if (!entry) {
      const info = await stat(path)
      // A file last written before the window opened cannot hold in-window data.
      if (info.mtimeMs < windowStartMs) continue
      cold = true
      entry = cache.files[path] = { offset: 0, size: 0, days: {}, keys: {} }
    }
    const read = await ingestFile(path, entry, windowStart, seen)
    if (read > 0) {
      filesRead += 1
      bytesRead += read
    }
  }

  pruneCache(cache, windowStart, livePaths)

  for (const entry of Object.values(cache.files)) {
    for (const [day, models] of Object.entries(entry.days)) {
      if (day < windowStart || day > windowEnd) continue
      for (const [model, counters] of Object.entries(models)) {
        if (totalOf(counters) === 0) continue
        const totals = byModel.get(model) ?? emptyModelTotals()
        addCounters(totals.counters, counters)
        addCounters(totals.pricedCounters, counters)
        byModel.set(model, totals)
        byDay.set(day, (byDay.get(day) ?? 0) + totalOf(counters))
        bySource.set("claude-code", (bySource.get("claude-code") ?? 0) + totalOf(counters))
      }
    }
  }

  if (cachePath) {
    await writeFile(`${cachePath}.tmp`, JSON.stringify(cache))
    await rename(`${cachePath}.tmp`, cachePath)
  }

  // Other harnesses, with costs kept as their own stores reported them
  const sourceReads = await collectExternalRows(options.sources ?? {}, windowStart, windowStartMs)
  for (const read of sourceReads) {
    for (const row of read.rows) {
      if (row.day < windowStart || row.day > windowEnd) continue

      const counters: TokenCounters = {
        inputTokens: row.inputTokens ?? 0,
        outputTokens: row.outputTokens ?? 0,
        cacheReadTokens: row.cacheReadTokens ?? 0,
        cacheWriteTokens: row.cacheWriteTokens ?? 0,
        cacheWrite1hTokens: Math.min(row.cacheWrite1hTokens ?? 0, row.cacheWriteTokens ?? 0),
      }
      if (totalOf(counters) === 0) continue

      const model = `${row.provider}:${row.model}`
      const totals = byModel.get(model) ?? emptyModelTotals()
      addCounters(totals.counters, counters)
      if (row.exactCostUsd !== null && row.exactCostUsd !== undefined) {
        totals.hasExactCost = true
        totals.exactCostUsd += row.exactCostUsd
      } else if (row.preventEstimatedCost) {
        addCounters(totals.unpricedCounters, counters)
      } else {
        addCounters(totals.pricedCounters, counters)
      }
      byModel.set(model, totals)
      byDay.set(row.day, (byDay.get(row.day) ?? 0) + totalOf(counters))
      bySource.set(read.id, (bySource.get(read.id) ?? 0) + totalOf(counters))
    }
  }

  const totals = emptyCounters()
  const unpriced: string[] = []
  const models: TokenWindowModelTotals[] = []
  let costUsd = 0
  let pricedModels = 0

  for (const [model, modelTotals] of byModel) {
    addCounters(totals, modelTotals.counters)

    const pricedTokens = totalOf(modelTotals.pricedCounters)
    const pricedCost = pricedTokens === 0 ? 0 : priceCounters(modelTotals.pricedCounters, pricing.get(model))
    const isUnpriced = totalOf(modelTotals.unpricedCounters) > 0 || (pricedTokens > 0 && pricedCost === null)

    let cost: number | null
    if (isUnpriced) {
      cost = null
      unpriced.push(model)
    } else {
      cost = modelTotals.exactCostUsd + (pricedCost ?? 0)
      costUsd += cost
      pricedModels += 1
    }

    models.push({
      ...modelTotals.counters,
      model,
      totalTokens: totalOf(modelTotals.counters),
      costUsd: cost,
    })
  }

  models.sort((a, b) => b.totalTokens - a.totalTokens)

  const sources: TokenWindowSourceTotals[] = [...bySource.entries()]
    .filter(([, tokens]) => tokens > 0)
    .map(([id, tokens]) => ({ id, totalTokens: tokens }))
    .sort((a, b) => b.totalTokens - a.totalTokens)

  return {
    schema: 1,
    generatedAt: new Date().toISOString(),
    windowDays,
    windowStart,
    windowEnd,
    sources,
    totals: {
      ...totals,
      totalTokens: totalOf(totals),
      costUsd: pricedModels === 0 ? null : costUsd,
      unpricedModels: unpriced.sort(),
    },
    days: Array.from({ length: windowDays }, (_, offset) => {
      const day = shiftDays(windowStart, offset)
      return { day, totalTokens: byDay.get(day) ?? 0 }
    }),
    models,
    scan: {
      files: files.length,
      filesRead,
      bytesRead,
      cold,
      sources: sourceReads.map(read => ({
        id: read.id,
        rows: read.rows.length,
        durationMs: read.durationMs,
        ...(read.error ? { error: read.error } : {}),
      })),
      durationMs: Math.round(performance.now() - startedAt),
    },
  }
}

export function formatTokenCount(value: number): string {
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`
  return String(value)
}
