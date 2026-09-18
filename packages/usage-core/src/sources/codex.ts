import { createHash } from "node:crypto"
import { createReadStream } from "node:fs"
import { readdir, stat } from "node:fs/promises"
import { basename, join } from "node:path"
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

function toDay(value?: string): string {
  if (!value) return localDate(new Date())
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? localDate(new Date()) : localDate(date)
}

function hashId(value: string): string {
  return createHash("sha256").update(value).digest("hex")
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

function toSlice(
  turn: CodexTurn,
  provider: string,
  model: string,
  sourceSessionHash: string
): UsageSlice {
  const normalized = normalizeModelKey(provider, model)
  const cached = turn.usage.cached_input_tokens ?? 0
  const cacheWrite = turn.usage.cache_write_input_tokens ?? 0
  return {
    source: "codex",
    provider: normalized.provider,
    model: normalized.model,
    day: toDay(turn.timestamp),
    startedAt: turn.timestamp ?? null,
    inputTokens: (turn.usage.input_tokens ?? 0) - cached,
    outputTokens: turn.usage.output_tokens ?? 0,
    cacheReadTokens: cached,
    cacheWriteTokens: cacheWrite > 0 ? cacheWrite : null,
    exactCostUsd: null,
    sourceSessionHash,
  }
}

async function readRolloutFile(
  file: string,
  seen: SeenTurns,
  rows: UsageSlice[]
): Promise<number> {
  let provider = "openai"
  let sessionHash = hashId(file)
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
      provider = parsed.payload?.model_provider || "openai"
      if (parsed.payload?.id) sessionHash = hashId(parsed.payload.id)
      continue
    }

    if (parsed.type === "turn_context") {
      const nextModel = parsed.payload?.model
      if (!nextModel) continue
      model = nextModel
      for (const turn of pending) {
        rows.push(toSlice(turn, provider, model, sessionHash))
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
    const key = hashId(`${previousFingerprint}|${numbers}`)
    const carriesHistory =
      previousFingerprint === "" && total.total_tokens !== last.total_tokens
    const anchor = carriesHistory ? seen.anchors.get(numbers) : undefined
    if (anchor !== undefined && !seen.chains.has(key)) {
      previousFingerprint = anchor
      continue
    }
    previousFingerprint = key
    if (seen.chains.has(key)) continue
    seen.chains.add(key)
    if (!seen.anchors.has(numbers)) seen.anchors.set(numbers, key)

    const turn = { timestamp: parsed.timestamp, usage: last }
    if (model) {
      rows.push(toSlice(turn, provider, model, sessionHash))
    } else {
      pending.push(turn)
    }
  }

  return pending.length
}

export async function readCodexUsage(
  targetPath: string
): Promise<UsageSlice[]> {
  const files = await collectJsonlFiles(await resolveSessionsPath(targetPath))
  // The filename carries the rollout's start time, so a parent always sorts
  // before the forks that replay it.
  files.sort(compareBasename)

  const rows: UsageSlice[] = []
  const seen: SeenTurns = { chains: new Set(), anchors: new Map() }
  let dropped = 0

  for (const file of files) {
    dropped += await readRolloutFile(file, seen, rows)
  }

  if (dropped > 0) {
    console.warn(
      `  Codex: dropped ${dropped} turns from rollouts that never name a model`
    )
  }

  return rows
}
