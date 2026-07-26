import { createHash } from "node:crypto"
import { resolve } from "node:path"
import { normalizeModelKey } from "../model-aliases"
import type { UsageSlice } from "../types"

type CcusageModel = {
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheCreationTokens?: number
  totalTokens?: number
}

type CcusageDay = {
  date?: string
  costUSD?: number
  models?: Record<string, CcusageModel>
}

type CcusageDailyReport = {
  daily?: CcusageDay[]
}

function hashId(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

export function parseCcusageCodexDaily(value: unknown): UsageSlice[] {
  const report = value as CcusageDailyReport
  if (!Array.isArray(report.daily)) return []

  const rows: UsageSlice[] = []
  for (const day of report.daily) {
    if (typeof day.date !== "string" || day.date.length === 0) continue
    for (const [rawModel, usage] of Object.entries(day.models ?? {})) {
      const normalized = normalizeModelKey("openai", rawModel)
      const input = finite(usage.inputTokens)
      const output = finite(usage.outputTokens)
      const cacheRead = finite(usage.cacheReadTokens)
      const cacheWrite = finite(usage.cacheCreationTokens)
      const total = finite(usage.totalTokens)
      if (
        input === null &&
        output === null &&
        cacheRead === null &&
        cacheWrite === null &&
        total === null
      ) {
        continue
      }
      rows.push({
        source: "codex",
        provider: normalized.provider,
        model: normalized.model,
        day: day.date,
        startedAt: `${day.date}T00:00:00.000Z`,
        inputTokens: input,
        outputTokens: output,
        cacheReadTokens: cacheRead,
        cacheWriteTokens: cacheWrite,
        aggregateTokens:
          total === null ||
          total ===
            (input ?? 0) + (output ?? 0) + (cacheRead ?? 0) + (cacheWrite ?? 0)
            ? null
            : total -
              ((input ?? 0) +
                (output ?? 0) +
                (cacheRead ?? 0) +
                (cacheWrite ?? 0)),
        exactCostUsd: null,
        preventEstimatedCost: true,
        sourceSessionHash: hashId(
          `ccusage:codex:tokens:${day.date}:${normalized.provider}:${normalized.model}`
        ),
      })
    }

    const cost = finite(day.costUSD)
    if (cost !== null) {
      rows.push({
        source: "codex",
        provider: "openai",
        model: "codex-daily-aggregate",
        day: day.date,
        startedAt: `${day.date}T00:00:00.000Z`,
        inputTokens: null,
        outputTokens: null,
        cacheReadTokens: null,
        cacheWriteTokens: null,
        aggregateTokens: null,
        exactCostUsd: cost,
        sourceSessionHash: hashId(`ccusage:codex:cost:${day.date}`),
      })
    }
  }
  return rows
}

export async function readCodexUsage(
  targetPath: string
): Promise<UsageSlice[]> {
  const executable = resolve(process.cwd(), "node_modules/.bin/ccusage")
  const command = Bun.spawn(
    [
      executable,
      "codex",
      "daily",
      "--json",
      "--timezone",
      Intl.DateTimeFormat().resolvedOptions().timeZone,
    ],
    {
      cwd: process.cwd(),
      env: { ...process.env, CODEX_HOME: targetPath },
      stdout: "pipe",
      stderr: "pipe",
    }
  )
  const [exitCode, stdout, stderr] = await Promise.all([
    command.exited,
    new Response(command.stdout).text(),
    new Response(command.stderr).text(),
  ])
  if (exitCode !== 0) {
    throw new Error(`ccusage Codex report failed: ${stderr.trim()}`)
  }
  return parseCcusageCodexDaily(JSON.parse(stdout))
}
