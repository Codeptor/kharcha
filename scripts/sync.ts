import { access } from "node:fs/promises"
import { constants as fsConstants } from "node:fs"
import { join } from "node:path"
import {
  buildSyncBatch,
  fetchModelsDevCatalog,
  readClaudeCodeUsage,
  readCodexUsage,
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
  const catalog = await fetchModelsDevCatalog()
  const lookup = new Map<string, ReturnType<typeof toPricingSnapshot>>()

  for (const row of catalog) {
    lookup.set(`${row.providerId}:${row.modelId}`, toPricingSnapshot(row))
  }

  return lookup
}

async function loadUsageRows() {
  const home = process.env.HOME ?? ""
  const targets = [
    {
      path: process.env.CLAUDE_CODE_PATH ?? join(home, ".claude/projects"),
      reader: readClaudeCodeUsage,
    },
    {
      path: process.env.CODEX_PATH ?? join(home, ".codex"),
      reader: readCodexUsage,
    },
    {
      path: process.env.OPENCODE_PATH ?? join(home, ".local/share/opencode/opencode.db"),
      reader: readOpenCodeUsage,
    },
  ] as const

  const rows = []
  for (const target of targets) {
    if (!(await pathExists(target.path))) continue
    rows.push(...(await target.reader(target.path)))
  }

  return rows
}

async function main() {
  const rows = await loadUsageRows()
  const pricingLookup = await loadPricingLookup()
  const batch = await buildSyncBatch(rows, pricingLookup)

  if (dryRun) {
    console.log(JSON.stringify(batch, null, 2))
    return
  }

  const url = process.env.SYNC_URL
  const secret = process.env.SYNC_SECRET
  if (!url || !secret) {
    throw new Error("SYNC_URL and SYNC_SECRET are required")
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${secret}`,
    },
    body: JSON.stringify(batch),
  })

  if (!response.ok) {
    throw new Error(`sync request failed with ${response.status}`)
  }
}

await main()
