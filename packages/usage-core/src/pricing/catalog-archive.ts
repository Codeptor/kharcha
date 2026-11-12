import { createHash } from "node:crypto"
import { closeSync, fsyncSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, writeSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { gunzipSync, gzipSync } from "node:zlib"
import { parseModelsDevCatalog, type ModelsDevCatalogRow } from "./models-dev"

/**
 * The part of models.dev's api.json that parseModelsDevCatalog reads, with each
 * model's `cost` object kept whole so a later parser can re-read old days.
 */
export type RawCatalog = Record<string, { id?: string; models: Record<string, { id?: string; cost?: unknown }> }>

const FILE_PATTERN = /^(\d{4}-\d{2}-\d{2})\.json\.gz$/

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

/** Persistent data, not cache: the archive is the only record of past prices. */
export function defaultCatalogDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env.KHARCHA_CATALOG_DIR) return env.KHARCHA_CATALOG_DIR
  const dataHome = env.XDG_DATA_HOME || join(env.HOME || homedir(), ".local/share")
  return join(dataHome, "kharcha/catalog")
}

/** Drops everything but ids and costs. Entries parseModelsDevCatalog would skip are skipped here too. */
export function reduceCatalog(input: unknown): RawCatalog {
  const reduced: RawCatalog = {}
  if (!isObject(input)) return reduced
  for (const [providerKey, provider] of Object.entries(input)) {
    if (!isObject(provider) || !isObject(provider.models)) continue
    if (provider.id !== undefined && typeof provider.id !== "string") continue
    const models: RawCatalog[string]["models"] = {}
    for (const [modelKey, model] of Object.entries(provider.models)) {
      if (!isObject(model)) continue
      if (model.id !== undefined && typeof model.id !== "string") continue
      models[modelKey] = {
        ...(model.id !== undefined ? { id: model.id as string } : {}),
        ...(model.cost !== undefined ? { cost: model.cost } : {}),
      }
    }
    reduced[providerKey] = { ...(provider.id !== undefined ? { id: provider.id as string } : {}), models }
  }
  return reduced
}

export function archiveDates(dir: string): string[] {
  try {
    return readdirSync(dir)
      .map(name => FILE_PATTERN.exec(name)?.[1])
      .filter((date): date is string => date !== undefined)
      .sort()
  } catch {
    return []
  }
}

const sha256Hex = (text: string) => createHash("sha256").update(text).digest("hex")

function writeFileAtomic(target: string, bytes: Buffer) {
  mkdirSync(dirname(target), { recursive: true })
  const tmp = `${target}.${process.pid}.tmp`
  const fd = openSync(tmp, "w")
  try {
    writeSync(fd, bytes)
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
  renameSync(tmp, target)
}

const readArchiveText = (dir: string, date: string) => gunzipSync(readFileSync(join(dir, `${date}.json.gz`))).toString("utf8")

const warned = new Set<string>()
function warnOnce(file: string, error: unknown) {
  if (warned.has(file)) return
  warned.add(file)
  console.warn(`  catalog archive: skipping unreadable ${file} (${error instanceof Error ? error.message : String(error)})`)
}

/** Parsed rows of an archive file, or null (warned once) when it cannot be read or parsed. */
function loadArchiveRows(dir: string, date: string): ModelsDevCatalogRow[] | null {
  try {
    return parseModelsDevCatalog(JSON.parse(readArchiveText(dir, date)))
  } catch (error) {
    warnOnce(join(dir, `${date}.json.gz`), error)
    return null
  }
}

export function localDate(now: Date): string {
  const month = String(now.getMonth() + 1).padStart(2, "0")
  return `${now.getFullYear()}-${month}-${String(now.getDate()).padStart(2, "0")}`
}

/** The catalog as a reduced payload, or an error when it looks truncated against what is already archived. */
export function acceptCatalog(dir: string, payload: unknown, minModels = 1000): RawCatalog {
  const reduced = reduceCatalog(payload)
  const count = Object.values(reduced).reduce((sum, provider) => sum + Object.keys(provider.models).length, 0)
  if (count < minModels) throw new Error(`models.dev catalog has only ${count} models (minimum ${minModels}); refusing to use it`)
  for (const date of archiveDates(dir).reverse()) {
    const rows = loadArchiveRows(dir, date)
    if (rows === null) continue
    if (count < rows.length * 0.7) {
      throw new Error(`models.dev catalog has ${count} models against ${rows.length} archived on ${date}; refusing to use it`)
    }
    break
  }
  return reduced
}

/**
 * Archives a fetched models.dev payload as YYYY-MM-DD.json.gz (local date),
 * only when it differs from the newest archived file. A second write on the
 * same day replaces that day's file. A truncated payload throws.
 */
export function writeCatalogArchive(
  dir: string,
  payload: unknown,
  now: Date = new Date(),
  minModels?: number
): { file: string; written: boolean } {
  const text = JSON.stringify(acceptCatalog(dir, payload, minModels))
  const newest = archiveDates(dir).at(-1)
  if (newest !== undefined) {
    let same = false
    try {
      same = readArchiveText(dir, newest) === text
    } catch {
      // An unreadable newest file counts as different; today's file replaces or precedes it.
    }
    if (same) return { file: `${newest}.json.gz`, written: false }
  }

  const file = `${localDate(now)}.json.gz`
  writeFileAtomic(join(dir, file), gzipSync(text))
  return { file, written: true }
}

/** Date and uncompressed-JSON sha256 of every readable archive file, oldest first. Unreadable files are skipped with one warning. */
export function listArchiveFiles(dir: string): { date: string; sha256: string }[] {
  const files: { date: string; sha256: string }[] = []
  for (const date of archiveDates(dir)) {
    try {
      const text = readArchiveText(dir, date)
      if (!isObject(JSON.parse(text))) throw new Error("not a JSON object")
      files.push({ date, sha256: sha256Hex(text) })
    } catch (error) {
      warnOnce(join(dir, `${date}.json.gz`), error)
    }
  }
  return files
}

/** sha256 of the uncompressed JSON text of gzip bytes, the same digest listArchiveFiles reports. Throws on invalid gzip. */
export const gzipSha256 = (gz: Buffer): string => sha256Hex(gunzipSync(gz).toString("utf8"))

export const readArchiveGzip = (dir: string, date: string): Buffer => readFileSync(join(dir, `${date}.json.gz`))

/** Stores gzip bytes fetched from elsewhere as `date`'s archive file, after checking they hold a JSON object. */
export function writeArchiveGzip(dir: string, date: string, gz: Buffer): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`invalid archive date ${date}`)
  if (!isObject(JSON.parse(gunzipSync(gz).toString("utf8")))) throw new Error(`archive ${date} is not a JSON object`)
  writeFileAtomic(join(dir, `${date}.json.gz`), gz)
}

export type CatalogArchive = {
  /** Date (YYYY-MM-DD) of the readable archive that prices `day`: the newest at or before it, else the oldest. Null when none is readable. */
  dateFor(day: string): string | null
  /** Archive dates after `date`, oldest first; one that cannot be read has no rows. */
  datesAfter(date: string): string[]
  /** Parsed catalog rows of an archive date; empty when it cannot be read. */
  rows(date: string): ModelsDevCatalogRow[]
  catalogFor(day: string): ModelsDevCatalogRow[]
}

/**
 * Offline, read-only view of the archive directory. Unreadable files are
 * skipped with one warning each. `memory` stands in for a catalog fetched
 * today without writing it (dry runs); it shadows a file of the same date.
 */
export function openCatalogArchive(dir: string, memory?: { date: string; catalog: RawCatalog }): CatalogArchive {
  const dates = [...new Set([...archiveDates(dir), ...(memory ? [memory.date] : [])])].sort()
  const parsed = new Map<string, ModelsDevCatalogRow[] | null>()
  const load = (date: string) => {
    let hit = parsed.get(date)
    if (hit === undefined) {
      hit = memory?.date === date ? parseModelsDevCatalog(memory.catalog) : loadArchiveRows(dir, date)
      parsed.set(date, hit)
    }
    return hit
  }
  const byDay = new Map<string, string | null>()
  const dateFor = (day: string) => {
    let hit = byDay.get(day)
    if (hit === undefined) {
      hit = dates.filter(date => date <= day).reverse().find(date => load(date) !== null)
      hit ??= dates.find(date => load(date) !== null) ?? null
      byDay.set(day, hit)
    }
    return hit
  }
  return {
    dateFor,
    datesAfter: date => dates.filter(other => other > date),
    rows: date => load(date) ?? [],
    catalogFor(day) {
      const date = dateFor(day)
      return date === null ? [] : load(date)!
    },
  }
}
