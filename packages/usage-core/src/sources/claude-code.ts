import { createHash } from "node:crypto"
import { createReadStream } from "node:fs"
import { readdir, stat } from "node:fs/promises"
import { createInterface } from "node:readline"
import { normalizeModelKey } from "../model-aliases"
import type { UsageSlice } from "../types"

type ClaudeSessionLine = {
  timestamp?: string
  sessionId?: string
  message?: {
    model?: string
    usage?: {
      input_tokens?: number
      output_tokens?: number
      cache_read_input_tokens?: number
      cache_creation_input_tokens?: number
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

function hashSessionId(sessionId: string): string {
  return createHash("sha256").update(sessionId).digest("hex")
}

function parseClaudeLine(line: string): ClaudeSessionLine | null {
  try {
    return JSON.parse(line) as ClaudeSessionLine
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

export async function readClaudeCodeUsage(targetPath: string): Promise<UsageSlice[]> {
  const files = await collectJsonlFiles(targetPath)
  const rows: UsageSlice[] = []

  for (const file of files) {
    for await (const line of streamFileLines(file)) {
      if (!line.trim()) continue
      const parsed = parseClaudeLine(line)
      const model = parsed?.message?.model
      if (!parsed || !model || model === "<synthetic>") continue

      const normalized = normalizeModelKey("anthropic", model)
      const usage = parsed.message?.usage
      rows.push({
        source: "claude-code",
        provider: normalized.provider,
        model: normalized.model,
        day: toDay(parsed.timestamp),
        startedAt: parsed.timestamp ?? null,
        inputTokens: usage?.input_tokens ?? null,
        outputTokens: usage?.output_tokens ?? null,
        cacheReadTokens: usage?.cache_read_input_tokens ?? null,
        cacheWriteTokens: usage?.cache_creation_input_tokens ?? null,
        exactCostUsd: null,
        sourceSessionHash: hashSessionId(parsed.sessionId ?? file),
      })
    }
  }

  return rows
}
