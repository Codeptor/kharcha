import { createHash } from "node:crypto"
import { createReadStream } from "node:fs"
import { readdir, readFile, stat } from "node:fs/promises"
import { createInterface } from "node:readline"
import { Database } from "bun:sqlite"
import { normalizeModelKey } from "../model-aliases"
import type { UsageSlice } from "../types"

type OpenCodeRecord = {
  id?: string
  session_id?: string
  time_created?: number
  data?: string | Record<string, unknown>
  role?: string
  providerID?: string
  modelID?: string
  model?: {
    id?: string
    providerID?: string
  }
  error?: unknown
  cost?: number
  tokens?: {
    input?: number
    output?: number
    reasoning?: number
    total?: number
    cache?: {
      read?: number
      write?: number
    }
  }
  time?: {
    created?: number
  }
}

async function collectOpenCodeTargets(targetPath: string): Promise<string[]> {
  const targetStat = await stat(targetPath)

  if (targetStat.isFile()) {
    return [targetPath]
  }

  const entries = await readdir(targetPath, { withFileTypes: true })
  const children = await Promise.all(
    entries.map(async (entry) => {
      const childPath = `${targetPath}/${entry.name}`
      if (entry.isDirectory()) {
        return collectOpenCodeTargets(childPath)
      }
      return childPath.endsWith(".json") ||
        childPath.endsWith(".jsonl") ||
        childPath.endsWith(".sqlite") ||
        childPath.endsWith(".db")
        ? [childPath]
        : []
    })
  )

  return children.flat()
}

function localDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

function toDay(value?: string | number): string {
  if (value === undefined || value === null) return localDate(new Date())
  const date = typeof value === "number" ? new Date(value) : new Date(value)
  return Number.isNaN(date.getTime()) ? localDate(new Date()) : localDate(date)
}

function hashSessionId(sessionId: string): string {
  return createHash("sha256").update(sessionId).digest("hex")
}

function parseRecord(
  input: string | Record<string, unknown>
): OpenCodeRecord | null {
  if (typeof input === "string") {
    try {
      return JSON.parse(input) as OpenCodeRecord
    } catch {
      return null
    }
  }

  return input as OpenCodeRecord
}

function readColumnValue(
  row: Record<string, unknown>,
  key: string
): string | number | null | undefined {
  const value = row[key]
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    value === null
  ) {
    return value as string | number | null
  }

  return undefined
}

function outputTokens(
  tokens: OpenCodeRecord["tokens"] | undefined
): number | null {
  if (tokens?.output === undefined && tokens?.reasoning === undefined)
    return null
  return (tokens.output ?? 0) + (tokens.reasoning ?? 0)
}

async function readOpenCodeJson(targetPath: string): Promise<UsageSlice[]> {
  const content = await readFile(targetPath, "utf8")
  const parsed = JSON.parse(content) as OpenCodeRecord
  const record = parseRecord(parsed.data ?? parsed)
  if (!record || record.role !== "assistant" || record.error) return []

  const provider = record.providerID ?? "opencode"
  const model = record.modelID ?? "unknown"
  const normalized = normalizeModelKey(provider, model)
  const createdAt = record.time?.created ?? parsed.time_created ?? undefined
  const tokens = record.tokens ?? {}

  return [
    {
      source: "opencode",
      provider: normalized.provider,
      model: normalized.model,
      day: toDay(createdAt ?? undefined),
      startedAt: createdAt ? new Date(createdAt).toISOString() : null,
      inputTokens: tokens.input ?? null,
      outputTokens: outputTokens(tokens),
      cacheReadTokens: tokens.cache?.read ?? null,
      cacheWriteTokens: tokens.cache?.write ?? null,
      exactCostUsd:
        typeof record.cost === "number" && record.cost > 0 ? record.cost : null,
      sourceSessionHash: hashSessionId(
        parsed.session_id ?? parsed.id ?? targetPath
      ),
    },
  ]
}

type SqliteRow = Record<string, unknown>

function numberColumn(row: SqliteRow, key: string): number | null {
  const value = row[key]
  return typeof value === "number" ? value : null
}

function textColumn(row: SqliteRow, key: string): string | null {
  const value = row[key]
  return typeof value === "string" ? value : null
}

// Mirrors the truthiness JSON.parse(data).error would have: json_type is
// null for a missing key and json_extract yields 1/0 for true/false.
function hasError(row: SqliteRow): boolean {
  switch (row.error_type) {
    case "object":
    case "array":
    case "true":
      return true
    case "text":
      return row.error_value !== ""
    case "integer":
    case "real":
      return row.error_value !== 0
    default:
      return false
  }
}

function sumOutputTokens(
  output: number | null,
  reasoning: number | null
): number | null {
  if (output === null && reasoning === null) return null
  return (output ?? 0) + (reasoning ?? 0)
}

function sessionKey(row: SqliteRow, targetPath: string): string {
  return textColumn(row, "session_id") ?? textColumn(row, "id") ?? targetPath
}

function sqliteSlice(
  row: SqliteRow,
  provider: string,
  model: string,
  sessionId: string
): UsageSlice {
  const normalized = normalizeModelKey(provider, model)
  const timeCreated = readColumnValue(row, "time_created")
  const cost = numberColumn(row, "cost")

  return {
    source: "opencode",
    provider: normalized.provider,
    model: normalized.model,
    day: toDay(timeCreated ?? readColumnValue(row, "created_at") ?? undefined),
    startedAt:
      typeof timeCreated === "number"
        ? new Date(timeCreated).toISOString()
        : null,
    inputTokens: numberColumn(row, "input_tokens"),
    outputTokens: sumOutputTokens(
      numberColumn(row, "output_tokens"),
      numberColumn(row, "reasoning_tokens")
    ),
    cacheReadTokens: numberColumn(row, "cache_read_tokens"),
    cacheWriteTokens: numberColumn(row, "cache_write_tokens"),
    exactCostUsd: cost !== null && cost > 0 ? cost : null,
    sourceSessionHash: hashSessionId(sessionId),
  }
}

// Only scalars leave SQLite; the data blob (up to 10 MB a row) is parsed
// once per row by the JSON functions and never copied into JS. cost keeps
// its numeric check because json_extract turns true into 1.
const usageColumns = `
  id,
  session_id,
  time_created,
  json_extract(data, '$.providerID') as provider_id,
  json_extract(data, '$.modelID') as model_id,
  json_extract(data, '$.model.providerID') as model_provider_id,
  json_extract(data, '$.model.id') as model_model_id,
  iif(
    json_type(data, '$.cost') in ('integer', 'real'),
    json_extract(data, '$.cost'),
    null
  ) as cost,
  json_extract(data, '$.tokens.input') as input_tokens,
  json_extract(data, '$.tokens.output') as output_tokens,
  json_extract(data, '$.tokens.reasoning') as reasoning_tokens,
  json_extract(data, '$.tokens.cache.read') as cache_read_tokens,
  json_extract(data, '$.tokens.cache.write') as cache_write_tokens,
  json_extract(data, '$.time.created') as created_at,
  json_type(data, '$.error') as error_type,
  json_extract(data, '$.error') as error_value
`

// json_extract and json_type raise on malformed JSON and SQLite does not
// define the order AND terms run in, so iif() (a CASE) makes json_valid gate
// the checks that read the document.
const messageQuery = `
  select ${usageColumns}
  from message
  where iif(json_valid(data), json_extract(data, '$.role') = 'assistant', 0)
    and time_created >= ?
`

function sessionMessageQuery(excludeLegacySessions: boolean): string {
  return `
    select ${usageColumns}
    from session_message
    where type = 'assistant'
      and iif(json_valid(data), json_type(data) = 'object', 0)
      and time_created >= ?
      ${
        excludeLegacySessions
          ? `and not exists (
              select 1 from message where message.session_id = session_message.session_id
            )`
          : ""
      }
  `
}

function readOpenCodeSqlite(targetPath: string, sinceEpochMs: number): UsageSlice[] {
  const rows: UsageSlice[] = []
  const db = new Database(targetPath, { readonly: true })

  try {
    const tables = new Set(
      (
        db
          .query("select name from sqlite_master where type = 'table'")
          .all() as Array<Record<string, unknown>>
      )
        .map((row) => row.name)
        .filter((name): name is string => typeof name === "string")
    )

    if (tables.has("message")) {
      for (const row of db.query<SqliteRow, [number]>(messageQuery).iterate(sinceEpochMs)) {
        if (hasError(row)) continue

        rows.push(
          sqliteSlice(
            row,
            textColumn(row, "provider_id") ?? "opencode",
            textColumn(row, "model_id") ?? "unknown",
            sessionKey(row, targetPath)
          )
        )
      }
    }

    if (tables.has("session_message")) {
      const query = sessionMessageQuery(tables.has("message"))

      for (const row of db.query<SqliteRow, [number]>(query).iterate(sinceEpochMs)) {
        if (hasError(row)) continue

        rows.push(
          sqliteSlice(
            row,
            textColumn(row, "model_provider_id") ??
              textColumn(row, "provider_id") ??
              "opencode",
            textColumn(row, "model_model_id") ??
              textColumn(row, "model_id") ??
              "unknown",
            `opencode2:${sessionKey(row, targetPath)}`
          )
        )
      }
    }
  } finally {
    db.close()
  }

  return rows
}

async function readOpenCodeJsonl(targetPath: string): Promise<UsageSlice[]> {
  const rows: UsageSlice[] = []
  const rl = createInterface({
    input: createReadStream(targetPath, { encoding: "utf8" }),
    crlfDelay: Infinity,
  })

  for await (const line of rl) {
    if (!line.trim()) continue
    try {
      const parsed = JSON.parse(line) as OpenCodeRecord
      const record = parseRecord(parsed.data ?? parsed)
      if (!record || record.role !== "assistant" || record.error) continue

      const provider = record.providerID ?? "opencode"
      const model = record.modelID ?? "unknown"
      const normalized = normalizeModelKey(provider, model)
      const tokens = record.tokens ?? {}

      rows.push({
        source: "opencode",
        provider: normalized.provider,
        model: normalized.model,
        day: toDay(parsed.time_created ?? record.time?.created ?? undefined),
        startedAt: parsed.time_created
          ? new Date(parsed.time_created).toISOString()
          : null,
        inputTokens: tokens.input ?? null,
        outputTokens: outputTokens(tokens),
        cacheReadTokens: tokens.cache?.read ?? null,
        cacheWriteTokens: tokens.cache?.write ?? null,
        exactCostUsd:
          typeof record.cost === "number" && record.cost > 0
            ? record.cost
            : null,
        sourceSessionHash: hashSessionId(
          parsed.session_id ?? parsed.id ?? targetPath
        ),
      })
    } catch {
      continue
    }
  }

  return rows
}

/**
 * Reads OpenCode usage. `sinceEpochMs` filters on the plain `time_created`
 * column before any JSON extraction, which is what makes a windowed read of a
 * multi-gigabyte database cheap.
 */
export async function readOpenCodeUsage(
  targetPath: string,
  options: { sinceEpochMs?: number } = {}
): Promise<UsageSlice[]> {
  const sinceEpochMs = options.sinceEpochMs ?? 0
  const targets = await collectOpenCodeTargets(targetPath)
  const rows: UsageSlice[] = []

  for (const target of targets) {
    if (target.endsWith(".json")) {
      rows.push(...(await readOpenCodeJson(target)))
      continue
    }

    if (target.endsWith(".jsonl")) {
      rows.push(...(await readOpenCodeJsonl(target)))
      continue
    }

    if (target.endsWith(".sqlite") || target.endsWith(".db")) {
      rows.push(...readOpenCodeSqlite(target, sinceEpochMs))
    }
  }

  // A turn that reported no counters and no cost is not usage: OpenCode logs
  // assistant messages for steps that never reached the model, and persisting
  // them as zero rows only shows up downstream as unpriced noise.
  return rows.filter(
    row =>
      (row.inputTokens ?? 0) +
        (row.outputTokens ?? 0) +
        (row.cacheReadTokens ?? 0) +
        (row.cacheWriteTokens ?? 0) +
        (row.aggregateTokens ?? 0) >
        0 || (row.exactCostUsd ?? 0) > 0
  )
}
