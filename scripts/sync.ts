import { access, readdir } from "node:fs/promises"
import { constants as fsConstants } from "node:fs"
import { basename, dirname, join } from "node:path"
import {
  buildSyncBatch,
  localDate,
  openCatalogArchive,
  acceptCatalog,
  createDatedPricing,
  defaultCatalogDir,
  fetchModelsDevJson,
  readClaudeCodeUsage,
  readAgyUsage,
  readCodexRollouts,
  readKimiUsage,
  readOpenCodeUsage,
  readOmpUsage,
  readDshUsage,
  writeCatalogArchive,
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
  const catalogDir = defaultCatalogDir()
  // A failed or truncated models.dev fetch prices from the existing archive.
  // A dry run keeps today's fetch in memory and writes nothing.
  let memory: Parameters<typeof openCatalogArchive>[1]
  try {
    const payload = await fetchModelsDevJson()
    if (dryRun) {
      memory = { date: localDate(new Date()), catalog: acceptCatalog(catalogDir, payload) }
      console.log("  catalog archive: dry run, fetched catalog used in memory, nothing written")
    } else {
      const archived = writeCatalogArchive(catalogDir, payload)
      console.log(`  catalog archive: ${archived.written ? "written" : "unchanged"} ${archived.file} (${catalogDir})`)
    }
  } catch (error) {
    console.warn(`  warning: ${error instanceof Error ? error.message : String(error)}; pricing from the existing archive`)
  }
  const archive = openCatalogArchive(catalogDir, memory)
  if (archive.dateFor(localDate(new Date())) === null) throw new Error(`no usable catalog archive in ${catalogDir}`)
  const pricingStart = performance.now()
  const dated = createDatedPricing({ archive })

  console.log("\n▸ Building sync batch...")
  const batch = await buildSyncBatch(rows, dated.resolve)
  console.log(`  ${dated.lookupCount()} dated lookups built, pricing took ${Math.round(performance.now() - pricingStart)} ms`)

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
