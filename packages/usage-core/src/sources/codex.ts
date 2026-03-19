import { createHash } from "node:crypto"
import { readdir, readFile, stat } from "node:fs/promises"
import { Database } from "bun:sqlite"
import { normalizeModelKey } from "../model-aliases"
import type { UsageSlice } from "../types"

type CodexSessionLine = {
  timestamp?: string
  type?: string
  payload?: {
    id?: string
    model_provider?: string
    model?: string
  }
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

function toDay(value?: string | number): string {
  if (value === undefined || value === null) return new Date().toISOString().slice(0, 10)
  const date = typeof value === "number" ? new Date(value) : new Date(value)
  return Number.isNaN(date.getTime()) ? new Date().toISOString().slice(0, 10) : date.toISOString().slice(0, 10)
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
  const rows: UsageSlice[] = []

  for (const line of content.split("\n")) {
    if (!line.trim()) continue
    const parsed = parseJsonlLine(line)
    const provider = parsed?.payload?.model_provider
    const model = parsed?.payload?.model
    if (!parsed || parsed.type !== "session_meta" || !provider || !model) continue

    const normalized = normalizeModelKey(provider, model)
    rows.push({
      source: "codex",
      provider: normalized.provider,
      model: normalized.model,
      day: toDay(parsed.timestamp),
      startedAt: parsed.timestamp ?? null,
      inputTokens: null,
      outputTokens: null,
      cacheReadTokens: null,
      cacheWriteTokens: null,
      exactCostUsd: null,
      sourceSessionHash: hashSessionId(parsed.payload?.id ?? filePath),
    })
  }

  return rows
}

function readCodexSqlite(filePath: string): UsageSlice[] {
  const rows: UsageSlice[] = []
  const db = new Database(filePath, { readonly: true })

  try {
    for (const row of db.query("select id, model_provider, model, created_at, tokens_used from threads").all() as Array<
      [string | null, string | null, string | null, number | null, number | null]
    >) {
      const [id, provider, model, createdAt, tokensUsed] = row
      if (!provider || !model) continue
      const normalized = normalizeModelKey(provider, model)
      rows.push({
        source: "codex",
        provider: normalized.provider,
        model: normalized.model,
        day: toDay(createdAt ?? undefined),
        startedAt: createdAt ? new Date(createdAt).toISOString() : null,
        inputTokens: tokensUsed ?? null,
        outputTokens: null,
        cacheReadTokens: null,
        cacheWriteTokens: null,
        exactCostUsd: null,
        sourceSessionHash: hashSessionId(id ?? `${filePath}:${provider}:${model}`),
      })
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
