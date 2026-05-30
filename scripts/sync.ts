import { access, readdir } from "node:fs/promises"
import { constants as fsConstants } from "node:fs"
import { basename, dirname, join } from "node:path"
import {
  buildSyncBatch,
  fetchModelsDevCatalog,
  readClaudeCodeUsage,
  readClaudeStatsCache,
  readCodexUsage,
  readKimiUsage,
  readOpenCodeUsage,
  toPricingSnapshot,
  type UsageSlice,
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

// A native Windows Claude install is visible from WSL under /mnt/c/Users/<user>/.claude,
// separate from the WSL home install. Enumerate every Windows profile that has a Claude
// history (set CLAUDE_CODE_WINDOWS_HOME to pin a single .claude dir instead). Returns
// nothing off-WSL, where /mnt/c is absent — so the same script is a no-op on Linux/macOS.
async function resolveWindowsClaudeDirs(): Promise<string[]> {
  const override = process.env.CLAUDE_CODE_WINDOWS_HOME
  if (override) return [override]

  const usersRoot = "/mnt/c/Users"
  if (!(await pathExists(usersRoot))) return []

  const entries = await readdir(usersRoot, { withFileTypes: true })
  const dirs: string[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const claudeDir = join(usersRoot, entry.name, ".claude")
    if (await pathExists(join(claudeDir, "projects"))) dirs.push(claudeDir)
  }
  return dirs
}

async function loadPricingLookup() {
  console.log("  fetching pricing catalog from models.dev...")
  const catalog = await fetchModelsDevCatalog()
  const lookup = new Map<string, ReturnType<typeof toPricingSnapshot>>()

  for (const row of catalog) {
    lookup.set(`${row.providerId}:${row.modelId}`, toPricingSnapshot(row))
  }

  // NVIDIA NIM is free-tier hosted; models.dev lists most NIM models at $0/$0.
  // For tracking "what would these tokens cost retail", swap $0 NIM entries
  // with the most expensive equivalent priced under another provider, matched
  // by trailing model-name segment.
  const lastSegment = (id: string) => id.split("/").pop() ?? id
  const nimZeroKeys: string[] = []
  for (const [key, snap] of lookup) {
    if (!key.startsWith("nvidia:")) continue
    const allZero =
      (snap.inputCost ?? 0) === 0 && (snap.outputCost ?? 0) === 0
    if (allZero) nimZeroKeys.push(key)
  }
  // Prefer "native" first-party providers, then well-known cheap hosts,
  // and only fall back to anything else. Within the chosen tier, pick the
  // cheapest non-zero entry so the shadow cost reflects realistic retail.
  const PROVIDER_TIERS = [
    new Set([
      "anthropic",
      "openai",
      "moonshotai",
      "deepseek",
      "groq",
      "google",
      "mistral",
      "cohere",
      "minimax",
    ]),
    new Set([
      "amazon-bedrock",
      "azure",
      "azure-cognitive-services",
      "vertex",
      "deepinfra",
      "fireworks",
      "together",
    ]),
  ]
  const providerTier = (id: string) => {
    for (let i = 0; i < PROVIDER_TIERS.length; i++) {
      if (PROVIDER_TIERS[i]!.has(id)) return i
    }
    return PROVIDER_TIERS.length
  }
  let shadowed = 0
  for (const key of nimZeroKeys) {
    const modelId = key.slice("nvidia:".length)
    const tail = lastSegment(modelId)
    let best: ReturnType<typeof toPricingSnapshot> | null = null
    let bestTier = Number.POSITIVE_INFINITY
    let bestRate = Number.POSITIVE_INFINITY
    for (const [otherKey, otherSnap] of lookup) {
      if (otherKey === key) continue
      const colon = otherKey.indexOf(":")
      const providerId = otherKey.slice(0, colon)
      const otherModel = otherKey.slice(colon + 1)
      if (lastSegment(otherModel) !== tail) continue
      const rate =
        (otherSnap.inputCost ?? 0) + (otherSnap.outputCost ?? 0)
      if (rate <= 0) continue
      const tier = providerTier(providerId)
      if (
        tier < bestTier ||
        (tier === bestTier && rate < bestRate)
      ) {
        bestTier = tier
        bestRate = rate
        best = otherSnap
      }
    }
    if (best) {
      lookup.set(key, best)
      shadowed += 1
    }
  }
  if (shadowed > 0) console.log(`  shadow-priced ${shadowed} NVIDIA NIM models from retail equivalents`)

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

  const statsCachePath = process.env.CLAUDE_STATS_CACHE_PATH ?? join(home, ".claude/stats-cache.json")
  if (await pathExists(statsCachePath)) {
    const backfill = await readClaudeStatsCache(statsCachePath, rows)
    console.log(`  Claude stats cache: ${backfill.length} backfill rows`)
    rows.push(...backfill)
  }

  // Native Windows Claude installs (when syncing from WSL). Session IDs are globally
  // unique, so Windows JSONL rows never collide with WSL ones; the stats-cache backfill
  // is namespaced per Windows user and diffed against that machine's JSONL only.
  for (const claudeDir of await resolveWindowsClaudeDirs()) {
    const user = basename(dirname(claudeDir))
    const projectsPath = join(claudeDir, "projects")
    let winRows: UsageSlice[] = []
    if (await pathExists(projectsPath)) {
      winRows = await readClaudeCodeUsage(projectsPath)
      console.log(`  Claude Code (Windows · ${user}): ${winRows.length} rows`)
      rows.push(...winRows)
    }

    const winCachePath = join(claudeDir, "stats-cache.json")
    if (await pathExists(winCachePath)) {
      const backfill = await readClaudeStatsCache(winCachePath, winRows, `windows-${user}`)
      console.log(`  Claude stats cache (Windows · ${user}): ${backfill.length} backfill rows`)
      rows.push(...backfill)
    }
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
