import { access, appendFile, mkdir, readdir } from "node:fs/promises"
import { constants as fsConstants } from "node:fs"
import { basename, dirname, join } from "node:path"
import {
  buildSyncBatch,
  localDate,
  openCatalogArchive,
  acceptCatalog,
  createDatedPricing,
  derivePricing,
  gzipSha256,
  listArchiveFiles,
  normalizeModelKey,
  readArchiveGzip,
  writeArchiveGzip,
  type PricingSnapshot,
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

const REQUEST_TIMEOUT_MS = 30_000

function catalogBase(): { base: string; secret: string } | null {
  const url = process.env.SYNC_URL
  const secret = process.env.SYNC_SECRET
  if (!url || !secret) {
    console.warn("  warning: SYNC_URL and SYNC_SECRET unset; catalog archive restore and upload skipped")
    return null
  }
  if (!url.endsWith("/api/sync")) {
    console.warn("  warning: SYNC_URL does not end in /api/sync; catalog archive restore and upload skipped")
    return null
  }
  return { base: `${url.slice(0, -"/api/sync".length)}/api/catalog`, secret }
}

async function catalogRequest(target: string, secret: string, init: RequestInit = {}): Promise<Response> {
  const response = await fetch(target, {
    ...init,
    headers: { ...init.headers, authorization: `Bearer ${secret}` },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`${init.method ?? "GET"} ${target}: ${response.status} ${response.statusText}`)
  return response
}

const warnFailure = (step: string, error: unknown) =>
  console.warn(`  warning: catalog archive ${step} failed (${error instanceof Error ? error.message : String(error)}); continuing`)

async function listRemote(remote: { base: string; secret: string }): Promise<Map<string, string>> {
  const list = (await (await catalogRequest(remote.base, remote.secret)).json()) as { date: string; sha256: string }[]
  return new Map(list.map(file => [file.date, file.sha256]))
}

/** Fetches every archive date the server has and this machine lacks or cannot read. */
async function restoreArchive(dir: string, remote: { base: string; secret: string }) {
  try {
    const have = new Set(listArchiveFiles(dir).map(file => file.date))
    let restored = 0
    for (const [date, sha256] of await listRemote(remote)) {
      if (have.has(date)) continue
      const response = await catalogRequest(`${remote.base}/${date}`, remote.secret)
      const gz = Buffer.from(await response.arrayBuffer())
      try {
        if (gzipSha256(gz) !== sha256) throw new Error("sha256 differs from the server's list")
      } catch (error) {
        console.warn(`  warning: catalog archive ${date} not restored (${error instanceof Error ? error.message : String(error)})`)
        continue
      }
      writeArchiveGzip(dir, date, gz)
      restored++
    }
    console.log(`  catalog archive: restored ${restored} from the server`)
  } catch (error) {
    warnFailure("restore", error)
  }
}

/** Uploads every local file the server lacks or holds with a different sha256. */
async function uploadArchive(dir: string, remote: { base: string; secret: string }) {
  try {
    const onServer = await listRemote(remote)
    let uploaded = 0
    for (const file of listArchiveFiles(dir)) {
      if (onServer.get(file.date) === file.sha256) continue
      await catalogRequest(`${remote.base}/${file.date}`, remote.secret, {
        method: "PUT",
        headers: { "content-type": "application/gzip", "x-catalog-sha256": file.sha256 },
        body: new Uint8Array(readArchiveGzip(dir, file.date)),
      })
      uploaded++
    }
    console.log(`  catalog archive: uploaded ${uploaded} to the server`)
  } catch (error) {
    warnFailure("upload", error)
  }
}

function flattenRates(snapshot: PricingSnapshot | undefined): Map<string, number | null> {
  const flat = new Map<string, number | null>()
  if (!snapshot) return flat
  const fields = ["inputCost", "outputCost", "cacheReadCost", "cacheWriteCost"] as const
  for (const field of fields) flat.set(field, snapshot[field] ?? null)
  for (const tier of snapshot.tiers ?? []) {
    for (const field of fields) flat.set(`tier>${tier.promptTokensAbove}.${field}`, tier[field] ?? null)
  }
  return flat
}

/** Logs every base-rate or tier change between two catalogs for the models this batch used. */
async function logRateChanges(
  keys: Set<string>,
  prev: { date: string; rows: Parameters<typeof derivePricing>[0] },
  next: { date: string; rows: Parameters<typeof derivePricing>[0] },
  logPath: string
) {
  const before = derivePricing(prev.rows)
  const after = derivePricing(next.rows)
  const lines: string[] = []
  for (const key of [...keys].sort()) {
    const old = flattenRates(before.get(key))
    const now = flattenRates(after.get(key))
    for (const field of new Set([...old.keys(), ...now.keys()])) {
      const a = old.get(field)
      const b = now.get(field)
      if (a === b) continue
      lines.push(`  rate change: ${key} ${field} ${a ?? "none"} -> ${b ?? "none"} (archive ${prev.date} -> ${next.date})`)
    }
  }
  if (lines.length > 0) {
    for (const line of lines) console.log(line)
    const stamp = new Date().toISOString()
    await mkdir(dirname(logPath), { recursive: true })
    await appendFile(logPath, lines.map(line => `${stamp}${line}\n`).join(""))
  }
  console.log(`  catalog archive: ${lines.length} rate changes`)
}

async function main() {
  console.log("\n▸ Reading local usage data...")
  const rows = await loadUsageRows()

  console.log("\n▸ Fetching pricing...")
  const catalogDir = defaultCatalogDir()
  // A failed or truncated models.dev fetch prices from the existing archive.
  // A dry run keeps today's fetch in memory and writes nothing.
  let memory: Parameters<typeof openCatalogArchive>[1]
  const remote = dryRun ? null : catalogBase()
  // Heal a lost or new archive folder before anything is written or priced.
  if (remote) await restoreArchive(catalogDir, remote)
  try {
    const payload = await fetchModelsDevJson()
    if (dryRun) {
      memory = { date: localDate(new Date()), catalog: acceptCatalog(catalogDir, payload) }
      console.log("  catalog archive: dry run, fetched catalog used in memory, nothing written")
    } else {
      const before = openCatalogArchive(catalogDir)
      const prevDate = before.dateFor("9999-12-31")
      const prevRows = prevDate === null ? [] : before.rows(prevDate)
      const archived = writeCatalogArchive(catalogDir, payload)
      console.log(`  catalog archive: ${archived.written ? "written" : "unchanged"} ${archived.file} (${catalogDir})`)
      if (remote) await uploadArchive(catalogDir, remote)
      if (archived.written && prevDate !== null) {
        const newDate = archived.file.slice(0, -".json.gz".length)
        const keys = new Set(
          rows.map(row => {
            const normalized = normalizeModelKey(row.provider, row.model)
            return `${normalized.provider}:${normalized.model}`
          })
        )
        try {
          await logRateChanges(
            keys,
            { date: prevDate, rows: prevRows },
            { date: newDate, rows: openCatalogArchive(catalogDir).rows(newDate) },
            join(dirname(catalogDir), "rate-changes.log")
          )
        } catch (error) {
          warnFailure("rate-change log", error)
        }
      }
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
