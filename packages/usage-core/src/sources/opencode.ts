import { createHash } from "node:crypto"
import { readdir, readFile, stat } from "node:fs/promises"
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
  cost?: number
  tokens?: {
    input?: number
    output?: number
    total?: number
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
      return childPath.endsWith(".json") || childPath.endsWith(".jsonl") || childPath.endsWith(".sqlite") || childPath.endsWith(".db")
        ? [childPath]
        : []
    }),
  )

  return children.flat()
}

function toDay(value?: string | number): string {
  if (value === undefined || value === null) return new Date().toISOString().slice(0, 10)
  const date = typeof value === "number" ? new Date(value) : new Date(value)
  return Number.isNaN(date.getTime()) ? new Date().toISOString().slice(0, 10) : date.toISOString().slice(0, 10)
}

function hashSessionId(sessionId: string): string {
  return createHash("sha256").update(sessionId).digest("hex")
}

function parseRecord(input: string | Record<string, unknown>): OpenCodeRecord | null {
  if (typeof input === "string") {
    try {
      return JSON.parse(input) as OpenCodeRecord
    } catch {
      return null
    }
  }

  return input as OpenCodeRecord
}

async function readOpenCodeJson(targetPath: string): Promise<UsageSlice[]> {
  const content = await readFile(targetPath, "utf8")
  const parsed = JSON.parse(content) as OpenCodeRecord
  const record = parseRecord(parsed.data ?? parsed)
  if (!record || record.role !== "assistant") return []

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
      outputTokens: tokens.output ?? null,
      cacheReadTokens: null,
      cacheWriteTokens: null,
      exactCostUsd: typeof record.cost === "number" ? record.cost : null,
      sourceSessionHash: hashSessionId(parsed.session_id ?? parsed.id ?? targetPath),
    },
  ]
}

function readOpenCodeSqlite(targetPath: string): UsageSlice[] {
  const rows: UsageSlice[] = []
  const db = new Database(targetPath, { readonly: true })

  try {
    for (const row of db.query("select id, session_id, time_created, data from message").all() as Array<
      [string | null, string | null, number | null, string | null]
    >) {
      const [id, sessionId, timeCreated, data] = row
      const record = parseRecord(data ?? "")
      if (!record || record.role !== "assistant") continue

      const provider = record.providerID ?? "opencode"
      const model = record.modelID ?? "unknown"
      const normalized = normalizeModelKey(provider, model)
      const tokens = record.tokens ?? {}

      rows.push({
        source: "opencode",
        provider: normalized.provider,
        model: normalized.model,
        day: toDay(timeCreated ?? record.time?.created ?? undefined),
        startedAt: timeCreated ? new Date(timeCreated).toISOString() : null,
        inputTokens: tokens.input ?? null,
        outputTokens: tokens.output ?? null,
        cacheReadTokens: null,
        cacheWriteTokens: null,
        exactCostUsd: typeof record.cost === "number" ? record.cost : null,
        sourceSessionHash: hashSessionId(sessionId ?? id ?? targetPath),
      })
    }
  } finally {
    db.close()
  }

  return rows
}

async function readOpenCodeJsonl(targetPath: string): Promise<UsageSlice[]> {
  const content = await readFile(targetPath, "utf8")
  const rows: UsageSlice[] = []

  for (const line of content.split("\n")) {
    if (!line.trim()) continue
    try {
      const parsed = JSON.parse(line) as OpenCodeRecord
      const record = parseRecord(parsed.data ?? parsed)
      if (!record || record.role !== "assistant") continue

      const provider = record.providerID ?? "opencode"
      const model = record.modelID ?? "unknown"
      const normalized = normalizeModelKey(provider, model)
      const tokens = record.tokens ?? {}

      rows.push({
        source: "opencode",
        provider: normalized.provider,
        model: normalized.model,
        day: toDay(parsed.time_created ?? record.time?.created ?? undefined),
        startedAt: parsed.time_created ? new Date(parsed.time_created).toISOString() : null,
        inputTokens: tokens.input ?? null,
        outputTokens: tokens.output ?? null,
        cacheReadTokens: null,
        cacheWriteTokens: null,
        exactCostUsd: typeof record.cost === "number" ? record.cost : null,
        sourceSessionHash: hashSessionId(parsed.session_id ?? parsed.id ?? targetPath),
      })
    } catch {
      continue
    }
  }

  return rows
}

export async function readOpenCodeUsage(targetPath: string): Promise<UsageSlice[]> {
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
      rows.push(...readOpenCodeSqlite(target))
    }
  }

  return rows
}
