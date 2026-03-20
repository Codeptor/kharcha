import { access } from "node:fs/promises"
import { constants as fsConstants } from "node:fs"
import { join } from "node:path"
import {
  buildSyncBatch,
  fetchModelsDevCatalog,
  readClaudeCodeUsage,
  readCodexUsage,
  readKimiUsage,
  readOpenCodeUsage,
  toPricingSnapshot,
} from "../packages/usage-core/src/index.ts"

const dryRun = process.argv.includes("--dry-run")

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath, fsConstants.F_OK)
    return true
  } catch {
    return false
  }
}

async function loadPricingLookup() {
  console.log("  fetching pricing catalog from models.dev...")
  const catalog = await fetchModelsDevCatalog()
  const lookup = new Map<string, ReturnType<typeof toPricingSnapshot>>()

  for (const row of catalog) {
    lookup.set(`${row.providerId}:${row.modelId}`, toPricingSnapshot(row))
  }

  console.log(`  ${catalog.length} models loaded`)
  return lookup
}

async function loadUsageRows() {
  const home = process.env.HOME ?? ""
  const targets = [
    {
      name: "Claude Code",
      path: process.env.CLAUDE_CODE_PATH ?? join(home, ".claude/projects"),
      reader: readClaudeCodeUsage,
    },
    {
      name: "Codex",
      path: process.env.CODEX_PATH ?? join(home, ".codex"),
      reader: readCodexUsage,
    },
    {
      name: "OpenCode",
      path: process.env.OPENCODE_PATH ?? join(home, ".local/share/opencode/opencode.db"),
      reader: readOpenCodeUsage,
    },
    {
      name: "Kimi Coding",
      path: process.env.KIMI_PATH ?? join(home, ".kimi/sessions"),
      reader: readKimiUsage,
    },
  ] as const

  const rows = []
  for (const target of targets) {
    if (!(await pathExists(target.path))) {
      console.log(`  ${target.name}: skipped (${target.path} not found)`)
      continue
    }
    const result = await target.reader(target.path)
    console.log(`  ${target.name}: ${result.length} rows`)
    rows.push(...result)
  }

  return rows
}

function formatCost(value: number) {
  return `$${value.toFixed(2)}`
}

async function main() {
  console.log("\n▸ Reading local usage data...")
  const rows = await loadUsageRows()

  console.log("\n▸ Fetching pricing...")
  const pricingLookup = await loadPricingLookup()

  console.log("\n▸ Building sync batch...")
  const batch = await buildSyncBatch(rows, pricingLookup)

  const totalCost = batch.rows.reduce((s, r) => s + r.costUsd, 0)
  const sources = [...new Set(batch.rows.map((r) => r.source))]
  const days = [...new Set(batch.rows.map((r) => r.day))].sort()

  console.log(
    `  ${batch.rows.length} rows, ${sources.length} sources, ${days.length} days, ${formatCost(totalCost)} total`,
  )

  if (dryRun) {
    console.log("\n▸ Dry run — printing batch JSON\n")
    console.log(JSON.stringify(batch, null, 2))
    return
  }

  const url = process.env.SYNC_URL
  const secret = process.env.SYNC_SECRET
  if (!url || !secret) {
    throw new Error("SYNC_URL and SYNC_SECRET are required")
  }

  console.log(`\n▸ Syncing to ${url}...`)
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${secret}`,
    },
    body: JSON.stringify(batch),
  })

  if (!response.ok) {
    throw new Error(`sync failed: ${response.status} ${response.statusText}`)
  }

  const result = (await response.json()) as Record<string, unknown>
  console.log(
    `  done — ${result.usageRowsInserted} rows, ${result.dailyRollupsInserted} rollups, ${(result.affectedDays as string[])?.length ?? 0} days affected\n`,
  )
}

await main()
