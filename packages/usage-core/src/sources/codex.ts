import { createHash } from "node:crypto"
import { createReadStream, type Stats } from "node:fs"
import {
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises"
import { basename, dirname, join } from "node:path"
import { createInterface } from "node:readline"
import { normalizeModelKey } from "../model-aliases"
import type { UsageSlice } from "../types"

type CodexTokenUsage = {
  input_tokens?: number
  cached_input_tokens?: number
  cache_write_input_tokens?: number
  output_tokens?: number
  reasoning_output_tokens?: number
  total_tokens?: number
}

type CodexRolloutLine = {
  timestamp?: string
  type?: string
  payload?: {
    id?: string
    model_provider?: string | null
    model?: string | null
    type?: string
    info?: {
      total_token_usage?: CodexTokenUsage
      last_token_usage?: CodexTokenUsage
    } | null
  }
}

type CodexTurn = {
  timestamp?: string
  usage: CodexTokenUsage
}

// One emitted turn as the rollout logged it: raw model id, raw counters.
// normalizeModelKey, day bucketing and the input-minus-cached split run when
// the tuple is turned into a slice, so alias changes never need a cache flush.
type CachedTurn = [
  timestamp: string | null,
  model: string,
  inputTokens: number,
  cachedInputTokens: number,
  outputTokens: number,
  cacheWriteInputTokens: number,
]

// Everything reading one rollout file produced: the turns it emitted, what it
// added to the cross-file dedupe state, and the stat that identifies the bytes
// it was read from.
type RolloutOutcome = {
  size: number
  mtimeMs: number
  provider: string
  sessionHash: string
  dropped: number
  keys: string[]
  anchors: [numbersHash: string, key: string][]
  turns: CachedTurn[]
}

const CACHE_VERSION = 1

type RolloutCache = {
  version: typeof CACHE_VERSION
  files: Record<string, RolloutOutcome>
}

export type CodexReadOptions = {
  cachePath?: string
}

export type CodexReadResult = {
  rows: UsageSlice[]
  filesRead: number
  filesCached: number
}

const USAGE_FIELDS = [
  "input_tokens",
  "cached_input_tokens",
  "output_tokens",
  "reasoning_output_tokens",
  "total_tokens",
] as const

// Only lines that can carry one of these are worth a JSON.parse.
const MARKERS = ['"session_meta"', '"turn_context"', '"token_count"']

async function resolveSessionsPath(targetPath: string): Promise<string> {
  const sessionsPath = join(targetPath, "sessions")
  try {
    return (await stat(sessionsPath)).isDirectory() ? sessionsPath : targetPath
  } catch {
    return targetPath
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
    })
  )

  return files.flat()
}

function localDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

function toDay(value?: string | null): string {
  if (!value) return localDate(new Date())
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? localDate(new Date()) : localDate(date)
}

function hashId(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

// Dedupe state only needs to tell keys apart; 128 bits keep the in-memory
// sets and the cache file half the size of full digests.
function hashKey(value: string): string {
  return hashId(value).slice(0, 32)
}

function compareBasename(a: string, b: string): number {
  const left = basename(a)
  const right = basename(b)
  return left < right ? -1 : left > right ? 1 : 0
}

function parseRolloutLine(line: string): CodexRolloutLine | null {
  try {
    return JSON.parse(line) as CodexRolloutLine
  } catch {
    return null
  }
}

async function* streamFileLines(filePath: string): AsyncGenerator<string> {
  const rl = createInterface({
    input: createReadStream(filePath, { encoding: "utf8" }),
    crlfDelay: Infinity,
  })
  for await (const line of rl) {
    yield line
  }
}

// A forked, resumed, or subagent rollout replays its parent's history with
// fresh timestamps. Chaining each event's fingerprint onto the previous one in
// the same file makes a replayed run reproduce the parent's chain, so the
// parent (seen first) wins and the replay is skipped. A replay that starts
// mid-history is anchored to the parent's chain by its first counter, which
// already carries the parent's cumulative totals.
type SeenTurns = {
  chains: Set<string>
  anchors: Map<string, string>
}

function usageNumbers(total: CodexTokenUsage, last: CodexTokenUsage): string {
  return [
    ...USAGE_FIELDS.map((field) => total[field] ?? 0),
    ...USAGE_FIELDS.map((field) => last[field] ?? 0),
  ].join(",")
}

function toCachedTurn(turn: CodexTurn, model: string): CachedTurn {
  return [
    turn.timestamp ?? null,
    model,
    turn.usage.input_tokens ?? 0,
    turn.usage.cached_input_tokens ?? 0,
    turn.usage.output_tokens ?? 0,
    turn.usage.cache_write_input_tokens ?? 0,
  ]
}

function toSlice(
  [timestamp, model, input, cached, output, cacheWrite]: CachedTurn,
  provider: string,
  sourceSessionHash: string
): UsageSlice {
  const normalized = normalizeModelKey(provider, model)
  return {
    source: "codex",
    provider: normalized.provider,
    model: normalized.model,
    day: toDay(timestamp),
    startedAt: timestamp,
    inputTokens: input - cached,
    outputTokens: output,
    cacheReadTokens: cached,
    cacheWriteTokens: cacheWrite > 0 ? cacheWrite : null,
    exactCostUsd: null,
    sourceSessionHash,
  }
}

async function readRolloutFile(
  file: string,
  fileStat: Stats,
  seen: SeenTurns
): Promise<RolloutOutcome> {
  const outcome: RolloutOutcome = {
    size: fileStat.size,
    mtimeMs: fileStat.mtimeMs,
    provider: "openai",
    sessionHash: hashId(file),
    dropped: 0,
    keys: [],
    anchors: [],
    turns: [],
  }
  let hasMeta = false
  let model: string | null = null
  let previousTotal: number | null = null
  let previousFingerprint = ""
  // Turns logged before the file names a model take the first model it names.
  let pending: CodexTurn[] = []

  for await (const line of streamFileLines(file)) {
    if (!MARKERS.some((marker) => line.includes(marker))) continue
    const parsed = parseRolloutLine(line)
    if (!parsed) continue

    if (parsed.type === "session_meta") {
      if (hasMeta) continue
      hasMeta = true
      outcome.provider = parsed.payload?.model_provider || "openai"
      if (parsed.payload?.id) outcome.sessionHash = hashId(parsed.payload.id)
      continue
    }

    if (parsed.type === "turn_context") {
      const nextModel = parsed.payload?.model
      if (!nextModel) continue
      model = nextModel
      for (const turn of pending) {
        outcome.turns.push(toCachedTurn(turn, model))
      }
      pending = []
      continue
    }

    if (parsed.type !== "event_msg" || parsed.payload?.type !== "token_count") {
      continue
    }
    const total = parsed.payload.info?.total_token_usage
    const last = parsed.payload.info?.last_token_usage
    if (!total || !last) continue

    // Codex re-emits the unchanged counter on non-turn events.
    if (total.total_tokens === previousTotal) continue
    previousTotal = total.total_tokens ?? null

    const numbers = usageNumbers(total, last)
    const numbersHash = hashKey(numbers)
    const key = hashKey(`${previousFingerprint}|${numbers}`)
    const carriesHistory =
      previousFingerprint === "" && total.total_tokens !== last.total_tokens
    const anchor = carriesHistory ? seen.anchors.get(numbersHash) : undefined
    if (anchor !== undefined && !seen.chains.has(key)) {
      previousFingerprint = anchor
      continue
    }
    previousFingerprint = key
    if (seen.chains.has(key)) continue
    seen.chains.add(key)
    outcome.keys.push(key)
    if (!seen.anchors.has(numbersHash)) {
      seen.anchors.set(numbersHash, key)
      outcome.anchors.push([numbersHash, key])
    }

    const turn = { timestamp: parsed.timestamp, usage: last }
    if (model) {
      outcome.turns.push(toCachedTurn(turn, model))
    } else {
      pending.push(turn)
    }
  }

  outcome.dropped = pending.length
  return outcome
}

// Rollouts are append-only and files are processed in basename order, so an
// unchanged file meets the same dedupe state it was cached against: its parent's
// keys are in `seen` before it either way, and the keys it added are a pure
// function of its bytes and that state. The one thing that can shift is an
// earlier file growing into a key this file claimed; then a cold read would
// have skipped that turn, so the cached outcome is refused and the file is
// re-read.
function replayOutcome(outcome: RolloutOutcome, seen: SeenTurns): boolean {
  if (outcome.keys.some((key) => seen.chains.has(key))) return false
  for (const key of outcome.keys) seen.chains.add(key)
  for (const [numbersHash, key] of outcome.anchors) {
    if (!seen.anchors.has(numbersHash)) seen.anchors.set(numbersHash, key)
  }
  return true
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isOutcome(value: unknown): value is RolloutOutcome {
  if (typeof value !== "object" || value === null) return false
  const entry = value as Record<string, unknown>
  return (
    typeof entry.size === "number" &&
    typeof entry.mtimeMs === "number" &&
    typeof entry.provider === "string" &&
    typeof entry.sessionHash === "string" &&
    typeof entry.dropped === "number" &&
    Array.isArray(entry.keys) &&
    Array.isArray(entry.anchors) &&
    Array.isArray(entry.turns)
  )
}

async function loadCache(
  cachePath: string
): Promise<Record<string, RolloutOutcome>> {
  let text: string
  try {
    text = await readFile(cachePath, "utf8")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn(`  Codex: could not read rollout cache at ${cachePath}`)
    }
    return {}
  }

  try {
    const parsed = JSON.parse(text) as Partial<RolloutCache> | null
    if (parsed?.version === CACHE_VERSION && isRecord(parsed.files)) {
      return Object.fromEntries(
        Object.entries(parsed.files).filter(([, entry]) => isOutcome(entry))
      ) as Record<string, RolloutOutcome>
    }
  } catch {
    // Treated the same as a wrong version below.
  }
  console.warn(
    `  Codex: ignoring rollout cache at ${cachePath} (unreadable or wrong version)`
  )
  return {}
}

async function writeCache(
  cachePath: string,
  files: Record<string, RolloutOutcome>
): Promise<void> {
  const tempPath = `${cachePath}.${process.pid}.tmp`
  try {
    await mkdir(dirname(cachePath), { recursive: true })
    const cache: RolloutCache = { version: CACHE_VERSION, files }
    await writeFile(tempPath, JSON.stringify(cache))
    await rename(tempPath, cachePath)
  } catch (error) {
    await rm(tempPath, { force: true })
    const reason = error instanceof Error ? error.message : String(error)
    console.warn(
      `  Codex: could not write rollout cache at ${cachePath}: ${reason}`
    )
  }
}

export async function readCodexRollouts(
  targetPath: string,
  options: CodexReadOptions = {}
): Promise<CodexReadResult> {
  const files = await collectJsonlFiles(await resolveSessionsPath(targetPath))
  // The filename carries the rollout's start time, so a parent always sorts
  // before the forks that replay it.
  files.sort(compareBasename)

  const cache = options.cachePath ? await loadCache(options.cachePath) : {}
  const outcomes: Record<string, RolloutOutcome> = {}
  const rows: UsageSlice[] = []
  const seen: SeenTurns = { chains: new Set(), anchors: new Map() }
  let dropped = 0
  let filesRead = 0
  let filesCached = 0

  for (const file of files) {
    // Stat before reading: an append that lands mid-read then leaves a size or
    // mtime that no longer matches, and the next run re-reads the file.
    const fileStat = await stat(file)
    const cached = cache[file]
    let outcome: RolloutOutcome
    if (
      cached &&
      cached.size === fileStat.size &&
      cached.mtimeMs === fileStat.mtimeMs &&
      replayOutcome(cached, seen)
    ) {
      outcome = cached
      filesCached += 1
    } else {
      outcome = await readRolloutFile(file, fileStat, seen)
      filesRead += 1
    }
    outcomes[file] = outcome
    dropped += outcome.dropped
    for (const turn of outcome.turns) {
      rows.push(toSlice(turn, outcome.provider, outcome.sessionHash))
    }
  }

  if (dropped > 0) {
    console.warn(
      `  Codex: dropped ${dropped} turns from rollouts that never name a model`
    )
  }

  // Entries for files that are gone fall out here; the DB keeps their rows.
  const changed = filesRead > 0 || filesCached !== Object.keys(cache).length
  if (options.cachePath && changed) {
    await writeCache(options.cachePath, outcomes)
  }

  return { rows, filesRead, filesCached }
}

export async function readCodexUsage(
  targetPath: string,
  options?: CodexReadOptions
): Promise<UsageSlice[]> {
  return (await readCodexRollouts(targetPath, options)).rows
}
