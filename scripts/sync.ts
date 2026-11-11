import { access, mkdir, readdir, rename, writeFile } from "node:fs/promises"
import { constants as fsConstants } from "node:fs"
import { basename, dirname, join } from "node:path"
import {
  buildSyncBatch,
  CUSTOM_PRICING,
  fetchModelsDevCatalog,
  readClaudeCodeUsage,
  readAgyUsage,
  readCodexRollouts,
  readKimiUsage,
  readOpenCodeUsage,
  readOmpUsage,
  readDshUsage,
  toPricingSnapshot,
  type SyncPricingLookup,
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

type PricingEntry = ReturnType<typeof toPricingSnapshot>

// First-party vendors price their own models; hosts resell them. A borrowed
// retail rate comes from the best tier, then the cheapest non-zero entry in it.
const PROVIDER_TIERS = [
  new Set([
    "anthropic",
    "openai",
    "google",
    "deepseek",
    "moonshotai",
    "minimax",
    "mistral",
    "cohere",
    "zai",
    "alibaba",
    "xiaomi",
    "xai",
    "meta",
  ]),
  new Set([
    "groq",
    "amazon-bedrock",
    "azure",
    "azure-cognitive-services",
    "vertex",
    "deepinfra",
    "fireworks",
    "together",
  ]),
]

function providerTier(id: string) {
  const tier = PROVIDER_TIERS.findIndex((set) => set.has(id))
  return tier === -1 ? PROVIDER_TIERS.length : tier
}

const splitKey = (key: string) => {
  const colon = key.indexOf(":")
  return { providerId: key.slice(0, colon), modelId: key.slice(colon + 1) }
}
const lastSegment = (id: string) => (id.split("/").pop() ?? id).toLowerCase()
const hasRate = (snap: PricingEntry) =>
  (snap.inputCost ?? 0) > 0 || (snap.outputCost ?? 0) > 0

// Retail rate of the same model (matched by trailing segment, any case) under
// the best provider that publishes one. The snapshot is returned as is.
function borrowRetail(
  lookup: Map<string, PricingEntry>,
  key: string
): PricingEntry | null {
  const tail = lastSegment(splitKey(key).modelId)
  let best: PricingEntry | null = null
  let bestTier = Number.POSITIVE_INFINITY
  let bestRate = Number.POSITIVE_INFINITY
  for (const [otherKey, snap] of lookup) {
    if (otherKey === key || !hasRate(snap)) continue
    const other = splitKey(otherKey)
    if (lastSegment(other.modelId) !== tail) continue
    const rate = (snap.inputCost ?? 0) + (snap.outputCost ?? 0)
    const tier = providerTier(other.providerId)
    if (tier < bestTier || (tier === bestTier && rate < bestRate)) {
      bestTier = tier
      bestRate = rate
      best = snap
    }
  }
  return best
}

async function loadPricingLookup(neededKeys: Set<string>) {
  console.log("  fetching pricing catalog from models.dev...")
  const catalog = await fetchModelsDevCatalog()
  const lookup = new Map<string, PricingEntry>()

  for (const row of catalog) {
    lookup.set(`${row.providerId}:${row.modelId}`, toPricingSnapshot(row))
  }

  // NVIDIA NIM is free-tier hosted; models.dev lists most NIM models at $0/$0.
  // Swap those entries for the retail equivalent so the tokens carry a shadow cost.
  let nimBorrowed = 0
  for (const [key, snap] of [...lookup]) {
    if (!key.startsWith("nvidia:") || hasRate(snap)) continue
    const retail = borrowRetail(lookup, key)
    if (!retail) continue
    lookup.set(key, retail)
    nimBorrowed += 1
  }
  if (nimBorrowed > 0) console.log(`  NIM: ${nimBorrowed} models borrow retail rates`)

  // Override with pricing for models models.dev does not list.
  for (const [key, snapshot] of Object.entries(CUSTOM_PRICING)) {
    lookup.set(key, snapshot)
  }

  // QwenCloud (Alibaba Model Studio) sells at Alibaba's own pay-as-you-go
  // prices, so it mirrors the `alibaba` catalog; models.dev lists the Token
  // Plan itself at $0. Gaps fall through to the gateway rule below.
  for (const [key, snapshot] of [...lookup]) {
    if (!key.startsWith("alibaba:")) continue
    lookup.set(`qwencloud:${key.slice("alibaba:".length)}`, snapshot)
  }

  // A needed key with no exact entry takes the entry of the same provider whose
  // model id differs only in case.
  const byFoldedKey = new Map<string, PricingEntry>()
  for (const [key, snap] of lookup) byFoldedKey.set(key.toLowerCase(), snap)
  for (const key of neededKeys) {
    if (lookup.has(key)) continue
    const folded = byFoldedKey.get(key.toLowerCase())
    if (folded) lookup.set(key, folded)
  }

  // Gateways resell other vendors' models without publishing rates of their
  // own. Borrow the retail rate of the same model; a model whose id says free
  // with no catalog entry is genuinely $0.
  const GATEWAYS = new Set(["nvidia", "tokenrouter", "opencode", "openrouter", "qwencloud"])
  const isFree = (modelId: string) => /(^|[-_/])free($|[-_/])|free$/i.test(modelId)
  let gatewayBorrowed = 0
  let freeModels = 0
  for (const key of neededKeys) {
    const { providerId, modelId } = splitKey(key)
    if (!GATEWAYS.has(providerId)) continue
    const existing = lookup.get(key)
    if (existing && hasRate(existing)) continue
    if (isFree(modelId)) {
      if (existing) continue
      lookup.set(key, { inputCost: 0, outputCost: 0, cacheReadCost: 0, cacheWriteCost: 0 })
      freeModels += 1
      continue
    }
    const retail = borrowRetail(lookup, key)
    if (!retail) continue
    lookup.set(key, retail)
    gatewayBorrowed += 1
  }
  if (gatewayBorrowed > 0) console.log(`  gateways: ${gatewayBorrowed} models borrow retail rates`)
  if (freeModels > 0) console.log(`  gateways: ${freeModels} free models at $0`)

  console.log(`  ${catalog.length} models loaded`)
  return lookup
}

// Offline consumers (the caelestia token widget) price against the same
// catalog this batch uses, so a rate never has two sources of truth.
async function writePricingSnapshot(lookup: SyncPricingLookup): Promise<void> {
  const path =
    process.env.KHARCHA_PRICING_PATH ??
    join(process.env.XDG_CACHE_HOME ?? join(process.env.HOME ?? "", ".cache"), "kharcha/pricing.json")
  await mkdir(dirname(path), { recursive: true })
  await writeFile(`${path}.tmp`, JSON.stringify({ fetchedAt: new Date().toISOString(), catalog: Object.fromEntries(lookup) }))
  await rename(`${path}.tmp`, path)
  console.log(`  pricing snapshot written to ${path}`)
}

// A reader returns its rows, or rows plus a detail suffix for the log line.
type SourceRead = UsageSlice[] | { rows: UsageSlice[]; detail: string }

type SourceTarget = {
  name: string
  path: string
  reader: (path: string) => Promise<SourceRead>
}

async function loadUsageRows() {
  const home = process.env.HOME ?? ""
  // Codex rollouts are append-only and add up to tens of GB; the cache keeps
  // the per-file outcome so an hourly sync only re-reads files that grew.
  const codexCachePath =
    process.env.CODEX_CACHE_PATH ??
    join(
      process.env.XDG_CACHE_HOME ?? join(home, ".cache"),
      "kharcha/codex-rollouts.json"
    )
  const targets: SourceTarget[] = [
    {
      name: "Claude Code",
      path: process.env.CLAUDE_CODE_PATH ?? join(home, ".claude/projects"),
      reader: readClaudeCodeUsage,
    },
    {
      name: "Codex",
      path: process.env.CODEX_PATH ?? join(home, ".codex"),
      reader: async (path) => {
        const { rows, filesRead, filesCached } = await readCodexRollouts(path, {
          cachePath: codexCachePath,
        })
        return {
          rows,
          detail: `(${filesRead} files read, ${filesCached} cached)`,
        }
      },
    },
    {
      name: "OpenCode",
      path:
        process.env.OPENCODE_PATH ??
        join(home, ".local/share/opencode/opencode.db"),
      reader: readOpenCodeUsage,
    },
    {
      name: "Kimi Coding",
      path: process.env.KIMI_PATH ?? join(home, ".kimi/sessions"),
      reader: readKimiUsage,
    },
    {
      name: "AGY",
      path:
        process.env.AGY_USAGE_PATH ??
        join(home, ".gemini/antigravity-cli/kharcha-usage.jsonl"),
      reader: readAgyUsage,
    },
    {
      name: "omp",
      path:
        process.env.OMP_SESSIONS_PATH ?? join(home, ".omp/agent/sessions"),
      reader: readOmpUsage,
    },
    {
      name: "DSH",
      path: process.env.DSH_SESSIONS_PATH ?? join(home, ".dsh/sessions"),
      reader: readDshUsage,
    },
  ]

  const rows: UsageSlice[] = []
  for (const target of targets) {
    if (!(await pathExists(target.path))) {
      console.log(`  ${target.name}: skipped (${target.path} not found)`)
      continue
    }
    const result = await target.reader(target.path)
    const sourceRows = Array.isArray(result) ? result : result.rows
    const detail = Array.isArray(result) ? "" : ` ${result.detail}`
    console.log(`  ${target.name}: ${sourceRows.length} rows${detail}`)
    rows.push(...sourceRows)
  }

  // Native Windows Claude installs (when syncing from WSL). Session IDs are globally
  // unique, so Windows JSONL rows never collide with WSL ones.
  for (const claudeDir of await resolveWindowsClaudeDirs()) {
    const projectsPath = join(claudeDir, "projects")
    if (!(await pathExists(projectsPath))) continue
    const user = basename(dirname(claudeDir))
    const winRows = await readClaudeCodeUsage(projectsPath)
    console.log(`  Claude Code (Windows · ${user}): ${winRows.length} rows`)
    rows.push(...winRows)
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
  const neededKeys = new Set(rows.map(row => `${row.provider}:${row.model}`))
  const pricingLookup = await loadPricingLookup(neededKeys)
  await writePricingSnapshot(pricingLookup)

  console.log("\n▸ Building sync batch...")
  const batch = await buildSyncBatch(rows, pricingLookup)

  const totalCost = batch.rows.reduce((s, r) => s + r.costUsd, 0)
  const sources = [...new Set(batch.rows.map((r) => r.source))]
  const days = [...new Set(batch.rows.map((r) => r.day))].sort()

  console.log(
    `  ${batch.rows.length} rows, ${sources.length} sources, ${days.length} days, ${formatCost(totalCost)} total`
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

  // A Vercel function rejects request bodies over 4.5 MB, which a full-history
  // batch crosses now that the readers report every session. Send it in chunks:
  // the ingest upserts rows and rebuilds each day's rollups from what is
  // persisted, so chunk boundaries do not change the result. Pricing snapshots
  // ride along with the first chunk and the hour buckets with the last, once
  // every row is in.
  const chunkSize = 1500
  const chunks: (typeof batch.rows)[] = []
  for (let offset = 0; offset < batch.rows.length; offset += chunkSize) chunks.push(batch.rows.slice(offset, offset + chunkSize))

  let usageRowsInserted = 0
  let dailyRollupsInserted = 0
  const affectedDays = new Set<string>()

  for (const [index, rows] of chunks.entries()) {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify({
        generatedAt: batch.generatedAt,
        rows,
        pricingSnapshots: index === 0 ? batch.pricingSnapshots : [],
        hourBuckets: index === chunks.length - 1 ? batch.hourBuckets : [],
      }),
    })

    if (!response.ok) {
      throw new Error(`sync failed: ${response.status} ${response.statusText} (chunk ${index + 1}/${chunks.length})`)
    }

    const result = (await response.json()) as Record<string, unknown>
    usageRowsInserted += Number(result.usageRowsInserted ?? 0)
    dailyRollupsInserted += Number(result.dailyRollupsInserted ?? 0)
    for (const day of (result.affectedDays as string[]) ?? []) affectedDays.add(day)
  }

  console.log(
    `  done — ${usageRowsInserted} rows, ${dailyRollupsInserted} rollups, ${affectedDays.size} days affected\n`
  )
}

await main()
