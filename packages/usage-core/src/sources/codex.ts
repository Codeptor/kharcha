import { createHash } from "node:crypto"
import { readdir, readFile, stat } from "node:fs/promises"
import { Database } from "bun:sqlite"
import { normalizeModelKey } from "../model-aliases"
import type { UsageSlice } from "../types"

type CodexTokenUsage = {
  input_tokens?: number
  cached_input_tokens?: number
  output_tokens?: number
  reasoning_output_tokens?: number
  total_tokens?: number
}

type CodexSessionLine = {
  timestamp?: string
  type?: string
  payload?: {
    id?: string
    model_provider?: string
    model?: string
    type?: string
    info?: {
      total_token_usage?: CodexTokenUsage
      last_token_usage?: CodexTokenUsage
    } | null
  }
}

const PROVIDER_DEFAULT_MODELS: Record<string, string> = {
  openai: "gpt-5.4",
  anthropic: "claude-sonnet-4-6",
}

function inferDefaultModel(provider: string): string | null {
  return PROVIDER_DEFAULT_MODELS[provider] ?? null
}

async function collectCodexTargets(targetPath: string): Promise<string[]> {
  const targetStat = await stat(targetPath)

  if (targetStat.isFile()) {
    return [targetPath]
  }

  const entries = await readdir(targetPath, { withFileTypes: true })
  const children = await Promise.all(
    entries.map(async (entry) => {
      const childPath = `${targetPath}/${entry.name}`
      if (entry.isDirectory()) {
        return collectCodexTargets(childPath)
      }
      return childPath.endsWith(".jsonl") || childPath.endsWith(".sqlite") || childPath.endsWith(".db")
        ? [childPath]
        : []
    }),
  )

  return children.flat()
}

function toTimestampMs(value: number): number {
  return value < 1_000_000_000_000 ? value * 1000 : value
}

function localDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

function toDay(value?: string | number): string {
  if (value === undefined || value === null) return localDate(new Date())
  const date = typeof value === "number" ? new Date(toTimestampMs(value)) : new Date(value)
  return Number.isNaN(date.getTime()) ? localDate(new Date()) : localDate(date)
}

function hashSessionId(sessionId: string): string {
  return createHash("sha256").update(sessionId).digest("hex")
}

function parseJsonlLine(line: string): CodexSessionLine | null {
  try {
    return JSON.parse(line) as CodexSessionLine
  } catch {
    return null
  }
}

async function readCodexJsonl(filePath: string): Promise<UsageSlice[]> {
  const content = await readFile(filePath, "utf8")

  let sessionMeta: CodexSessionLine | null = null
  let turnContextModel: string | null = null
  let lastTotal: CodexTokenUsage | null = null

  for (const line of content.split("\n")) {
    if (!line.trim()) continue
    const parsed = parseJsonlLine(line)
    if (!parsed) continue
    if (parsed.type === "session_meta") {
      sessionMeta = parsed
      continue
    }
    if (parsed.type === "turn_context" && !turnContextModel) {
      const m = (parsed.payload as Record<string, unknown> | undefined)?.model
      if (typeof m === "string" && m.length > 0) turnContextModel = m
      continue
    }
    if (
      parsed.type === "event_msg" &&
      parsed.payload?.type === "token_count" &&
      parsed.payload.info?.total_token_usage
    ) {
      lastTotal = parsed.payload.info.total_token_usage
    }
  }

  const provider = sessionMeta?.payload?.model_provider
  const model =
    sessionMeta?.payload?.model ?? turnContextModel ?? (provider ? inferDefaultModel(provider) : null)
  if (!sessionMeta || !provider || !model) return []

  const normalized = normalizeModelKey(provider, model)
  const inputRaw = lastTotal?.input_tokens ?? 0
  const cached = lastTotal?.cached_input_tokens ?? 0
  const output = lastTotal?.output_tokens ?? 0
  const reasoning = lastTotal?.reasoning_output_tokens ?? 0
  const newInput = Math.max(0, inputRaw - cached)
  const totalOutput = output + reasoning

  return [
    {
      source: "codex",
      provider: normalized.provider,
      model: normalized.model,
      day: toDay(sessionMeta.timestamp),
      startedAt: sessionMeta.timestamp ?? null,
      inputTokens: lastTotal ? newInput : null,
      outputTokens: lastTotal ? totalOutput : null,
      cacheReadTokens: lastTotal ? cached : null,
      cacheWriteTokens: null,
      exactCostUsd: null,
      sourceSessionHash: hashSessionId(sessionMeta.payload?.id ?? filePath),
    },
  ]
}

function readCodexSqlite(filePath: string): UsageSlice[] {
  const rows: UsageSlice[] = []
  const db = new Database(filePath, { readonly: true })

  try {
    try {
      for (const row of db.query("select id, model_provider, model, created_at, tokens_used from threads").all() as Array<
        Record<string, string | number | null>
      >) {
        const id = row.id
        const provider = row.model_provider
        const rawModel = row.model
        const createdAt = row.created_at
        if (typeof provider !== "string") continue
        const model = typeof rawModel === "string" && rawModel.length > 0 ? rawModel : inferDefaultModel(provider)
        if (!model) continue
        const normalized = normalizeModelKey(provider, model)
        rows.push({
          source: "codex",
          provider: normalized.provider,
          model: normalized.model,
          day: toDay(createdAt ?? undefined),
          startedAt: typeof createdAt === "number" ? new Date(toTimestampMs(createdAt)).toISOString() : null,
          inputTokens: null,
          outputTokens: null,
          cacheReadTokens: null,
          cacheWriteTokens: null,
          exactCostUsd: null,
          sourceSessionHash: hashSessionId(typeof id === "string" ? id : `${filePath}:${provider}:${model}`),
        })
      }
    } catch {
      return rows
    }
  } finally {
    db.close()
  }

  return rows
}

export async function readCodexUsage(targetPath: string): Promise<UsageSlice[]> {
  const targets = await collectCodexTargets(targetPath)
  const rows: UsageSlice[] = []

  for (const target of targets) {
    if (target.endsWith(".jsonl")) {
      rows.push(...(await readCodexJsonl(target)))
      continue
    }

    if (target.endsWith(".sqlite") || target.endsWith(".db")) {
      rows.push(...readCodexSqlite(target))
    }
  }

  return rows
}
