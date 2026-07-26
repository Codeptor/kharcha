import { createHash } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"
import { readdir, readFile, stat } from "node:fs/promises"
import { resolve } from "node:path"
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

type ParsedCodexRollout = {
  sessionId: string | null
  timestamp: string | undefined
  provider: string | null
  model: string | null
  usage: CodexTokenUsage | null
}

type CodexGoalTokenUsage = {
  tokensUsed: number
  updatedAtMs: number
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
      return childPath.endsWith(".jsonl") ||
        childPath.endsWith(".sqlite") ||
        childPath.endsWith(".db")
        ? [childPath]
        : []
    })
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
  const date =
    typeof value === "number" ? new Date(toTimestampMs(value)) : new Date(value)
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

function parseCodexRollout(content: string): ParsedCodexRollout | null {
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
    sessionMeta?.payload?.model ??
    turnContextModel ??
    (provider ? inferDefaultModel(provider) : null)
  if (!sessionMeta || !provider || !model) return null

  return {
    sessionId: sessionMeta.payload?.id ?? null,
    timestamp: sessionMeta.timestamp,
    provider,
    model,
    usage: lastTotal,
  }
}

function readCodexRolloutSync(filePath: string): ParsedCodexRollout | null {
  if (!existsSync(filePath)) return null
  try {
    return parseCodexRollout(readFileSync(filePath, "utf8"))
  } catch {
    return null
  }
}

function splitCodexUsage(
  usage: CodexTokenUsage | null,
  totalOverride: number | null = null
): Pick<
  UsageSlice,
  "inputTokens" | "outputTokens" | "cacheReadTokens" | "cacheWriteTokens"
> {
  if (!usage) {
    return {
      inputTokens: totalOverride,
      outputTokens: null,
      cacheReadTokens: null,
      cacheWriteTokens: null,
    }
  }

  const inputRaw = usage.input_tokens ?? 0
  const cached = usage.cached_input_tokens ?? 0
  const output = usage.output_tokens ?? 0
  const observedTotal = inputRaw + output

  if (
    totalOverride !== null &&
    observedTotal > 0 &&
    totalOverride !== observedTotal
  ) {
    const ratio = totalOverride / observedTotal
    const scaledInputRaw = Math.max(0, Math.round(inputRaw * ratio))
    const scaledCacheRead = Math.min(
      scaledInputRaw,
      Math.max(0, Math.round(cached * ratio))
    )
    return {
      inputTokens: Math.max(0, scaledInputRaw - scaledCacheRead),
      outputTokens: Math.max(0, totalOverride - scaledInputRaw),
      cacheReadTokens: scaledCacheRead,
      cacheWriteTokens: null,
    }
  }

  return {
    inputTokens: Math.max(0, inputRaw - cached),
    outputTokens: output,
    cacheReadTokens: cached,
    cacheWriteTokens: null,
  }
}

async function readCodexJsonl(filePath: string): Promise<UsageSlice[]> {
  const content = await readFile(filePath, "utf8")
  const parsed = parseCodexRollout(content)
  if (!parsed?.provider || !parsed.model) return []

  const normalized = normalizeModelKey(parsed.provider, parsed.model)
  const tokens = splitCodexUsage(parsed.usage)

  return [
    {
      source: "codex",
      provider: normalized.provider,
      model: normalized.model,
      day: toDay(parsed.timestamp),
      startedAt: parsed.timestamp ?? null,
      ...tokens,
      exactCostUsd: null,
      sourceSessionHash: hashSessionId(parsed.sessionId ?? filePath),
    },
  ]
}

function totalTokens(row: UsageSlice): number {
  return (
    (row.inputTokens ?? 0) +
    (row.outputTokens ?? 0) +
    (row.cacheReadTokens ?? 0) +
    (row.cacheWriteTokens ?? 0)
  )
}

function readCodexGoalTokenUsage(
  filePath: string,
  goalTokens: Map<string, CodexGoalTokenUsage>
): void {
  const db = new Database(filePath, { readonly: true })

  try {
    const rows = db
      .query("select thread_id, tokens_used, updated_at_ms from thread_goals")
      .all() as Array<Record<string, string | number | null>>

    for (const row of rows) {
      const threadId = row.thread_id
      const tokensUsed = row.tokens_used
      const updatedAtMs = row.updated_at_ms
      if (
        typeof threadId !== "string" ||
        typeof tokensUsed !== "number" ||
        tokensUsed < 0
      ) {
        continue
      }

      const updated = typeof updatedAtMs === "number" ? updatedAtMs : 0
      const existing = goalTokens.get(threadId)
      if (
        !existing ||
        updated > existing.updatedAtMs ||
        (updated === existing.updatedAtMs && tokensUsed > existing.tokensUsed)
      ) {
        goalTokens.set(threadId, { tokensUsed, updatedAtMs: updated })
      }
    }
  } catch {
    // This SQLite file does not contain the separate Codex goal ledger.
  } finally {
    db.close()
  }
}

function readCodexGoalDescendants(
  db: Database,
  goalThreadIds: ReadonlySet<string>
): Set<string> {
  if (goalThreadIds.size === 0) return new Set()

  try {
    const children = new Map<string, string[]>()
    for (const row of db
      .query("select parent_thread_id, child_thread_id from thread_spawn_edges")
      .all() as Array<Record<string, string | number | null>>) {
      const parentId = row.parent_thread_id
      const childId = row.child_thread_id
      if (typeof parentId !== "string" || typeof childId !== "string") continue
      const list = children.get(parentId) ?? []
      list.push(childId)
      children.set(parentId, list)
    }

    const descendants = new Set<string>()
    const pending = [...goalThreadIds]
    while (pending.length > 0) {
      const parentId = pending.pop()
      if (!parentId) continue
      for (const childId of children.get(parentId) ?? []) {
        if (descendants.has(childId) || goalThreadIds.has(childId)) continue
        descendants.add(childId)
        pending.push(childId)
      }
    }

    return descendants
  } catch {
    return new Set()
  }
}

function readCodexSqlite(
  filePath: string,
  goalTokens: ReadonlyMap<string, CodexGoalTokenUsage>
): {
  rows: UsageSlice[]
  referencedRollouts: Set<string>
} {
  const rows: UsageSlice[] = []
  const referencedRollouts = new Set<string>()
  const db = new Database(filePath, { readonly: true })

  try {
    try {
      const columns = new Set(
        (
          db.query("pragma table_info(threads)").all() as Array<{
            name?: string
          }>
        )
          .map((column) => column.name)
          .filter((name): name is string => typeof name === "string")
      )

      const hasRolloutPath = columns.has("rollout_path")
      const hasCreatedAtMs = columns.has("created_at_ms")
      const createdAtExpr = hasCreatedAtMs
        ? "coalesce(nullif(created_at_ms, 0), created_at) as created_at"
        : "created_at"
      const query = `select id, ${hasRolloutPath ? "rollout_path" : "null as rollout_path"}, model_provider, model, ${createdAtExpr}, tokens_used from threads`
      const goalDescendants = readCodexGoalDescendants(
        db,
        new Set(goalTokens.keys())
      )

      for (const row of db.query(query).all() as Array<
        Record<string, string | number | null>
      >) {
        const id = row.id
        const rolloutPath = row.rollout_path
        const provider = row.model_provider
        const rawModel = row.model
        const createdAt = row.created_at
        const tokensUsed =
          typeof row.tokens_used === "number" ? row.tokens_used : 0
        const goalUsage =
          typeof id === "string" ? (goalTokens.get(id) ?? null) : null

        if (typeof rolloutPath === "string" && rolloutPath.length > 0)
          referencedRollouts.add(resolve(rolloutPath))

        // Codex's /goal tracing bug duplicates child token receipts. The parent
        // goal ledger is the only durable total for the entire spawned tree.
        if (typeof id === "string" && goalDescendants.has(id) && !goalUsage)
          continue

        const parsedRollout =
          typeof rolloutPath === "string" && rolloutPath.length > 0
            ? readCodexRolloutSync(rolloutPath)
            : null

        const effectiveProvider =
          typeof provider === "string" && provider.length > 0
            ? provider
            : parsedRollout?.provider
        if (!effectiveProvider) continue

        const model =
          typeof rawModel === "string" && rawModel.length > 0
            ? rawModel
            : (parsedRollout?.model ?? inferDefaultModel(effectiveProvider))
        if (!model) continue

        const normalized = normalizeModelKey(effectiveProvider, model)
        const tokens = splitCodexUsage(
          parsedRollout?.usage ?? null,
          goalUsage?.tokensUsed ?? (tokensUsed > 0 ? tokensUsed : null)
        )
        const startedAt =
          typeof createdAt === "number"
            ? new Date(toTimestampMs(createdAt)).toISOString()
            : (parsedRollout?.timestamp ?? null)

        rows.push({
          source: "codex",
          provider: normalized.provider,
          model: normalized.model,
          day: toDay(createdAt ?? parsedRollout?.timestamp ?? undefined),
          startedAt,
          ...tokens,
          exactCostUsd: null,
          sourceSessionHash: hashSessionId(
            typeof id === "string" ? id : `${filePath}:${provider}:${model}`
          ),
        })
      }
    } catch {
      return { rows, referencedRollouts }
    }
  } finally {
    db.close()
  }

  return { rows, referencedRollouts }
}

export async function readCodexUsage(
  targetPath: string
): Promise<UsageSlice[]> {
  const targets = await collectCodexTargets(targetPath)
  const sqliteRows = new Map<string, UsageSlice>()
  const jsonlRows: UsageSlice[] = []
  const referencedRollouts = new Set<string>()
  const goalTokens = new Map<string, CodexGoalTokenUsage>()
  const sqliteTargets = targets.filter(
    (t) => t.endsWith(".sqlite") || t.endsWith(".db")
  )

  for (const target of sqliteTargets) {
    readCodexGoalTokenUsage(target, goalTokens)
  }

  for (const target of sqliteTargets) {
    const result = readCodexSqlite(target, goalTokens)
    for (const rollout of result.referencedRollouts)
      referencedRollouts.add(rollout)
    for (const row of result.rows) {
      const existing = sqliteRows.get(row.sourceSessionHash)
      if (!existing || totalTokens(row) > totalTokens(existing)) {
        sqliteRows.set(row.sourceSessionHash, row)
      }
    }
  }

  for (const target of targets.filter((t) => t.endsWith(".jsonl"))) {
    if (referencedRollouts.has(resolve(target))) continue
    jsonlRows.push(...(await readCodexJsonl(target)))
  }

  return [...sqliteRows.values(), ...jsonlRows]
}
