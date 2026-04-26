import { inArray, sql } from "drizzle-orm"

import { db } from "./client"
import { dailyRollups, hourOfDayBuckets, pricingSnapshots, usageRows } from "./schema"

type PricingMode = "exact" | "estimated" | "unpriced"

type RollupInput = {
  day: string
  provider: string
  model: string
  costUsd: number
}

type RollupOutput = {
  day: string
  provider: string
  model: string
  costUsd: number
}

type SyncPricingSnapshot = {
  snapshotKey: string
  provider: string
  model: string
  inputCost: number | null
  outputCost: number | null
  cacheReadCost: number | null
  cacheWriteCost: number | null
}

type SyncBatchRow = {
  dedupeKey: string
  source: string
  provider: string
  model: string
  day: string
  costUsd: number
  pricingMode: PricingMode
  pricingSnapshotKey: string | null
  inputTokens: number | null
  outputTokens: number | null
  cacheReadTokens: number | null
  cacheWriteTokens: number | null
}

type SyncHourBucket = {
  dayOfWeek: number
  hour: number
  costUsd: number
}

type SyncBatch = {
  generatedAt: string
  pricingSnapshots: SyncPricingSnapshot[]
  rows: SyncBatchRow[]
  hourBuckets: SyncHourBucket[]
}

type IngestResult = {
  generatedAt: string
  affectedDays: string[]
  pricingSnapshotsInserted: number
  usageRowsInserted: number
  dailyRollupsInserted: number
  hourBucketsInserted: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isString(value: unknown): value is string {
  return typeof value === "string"
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
}

function isNullableNumber(value: unknown): value is number | null {
  return value === null || isNumber(value)
}

function isPricingMode(value: unknown): value is PricingMode {
  return value === "exact" || value === "estimated" || value === "unpriced"
}

function toDbNumber(value: number): string {
  return value.toString()
}

function parsePricingSnapshot(value: unknown): SyncPricingSnapshot | null {
  if (!isRecord(value)) return null
  if (
    !isString(value.snapshotKey) ||
    !isString(value.provider) ||
    !isString(value.model) ||
    !isNullableNumber(value.inputCost) ||
    !isNullableNumber(value.outputCost) ||
    !isNullableNumber(value.cacheReadCost) ||
    !isNullableNumber(value.cacheWriteCost)
  ) {
    return null
  }

  return {
    snapshotKey: value.snapshotKey,
    provider: value.provider,
    model: value.model,
    inputCost: value.inputCost,
    outputCost: value.outputCost,
    cacheReadCost: value.cacheReadCost,
    cacheWriteCost: value.cacheWriteCost,
  }
}

function parseBatchRow(value: unknown): SyncBatchRow | null {
  if (!isRecord(value)) return null
  if (
    !isString(value.dedupeKey) ||
    !isString(value.source) ||
    !isString(value.provider) ||
    !isString(value.model) ||
    !isString(value.day) ||
    !isNumber(value.costUsd) ||
    !isPricingMode(value.pricingMode) ||
    !(isString(value.pricingSnapshotKey) || value.pricingSnapshotKey === null)
  ) {
    return null
  }

  const tok = (k: string): number | null => {
    const v = value[k]
    return v === undefined || v === null ? null : isNumber(v) ? v : null
  }

  return {
    dedupeKey: value.dedupeKey,
    source: value.source,
    provider: value.provider,
    model: value.model,
    day: value.day,
    costUsd: value.costUsd,
    pricingMode: value.pricingMode,
    pricingSnapshotKey: value.pricingSnapshotKey,
    inputTokens: tok("inputTokens"),
    outputTokens: tok("outputTokens"),
    cacheReadTokens: tok("cacheReadTokens"),
    cacheWriteTokens: tok("cacheWriteTokens"),
  }
}

function parseHourBucket(value: unknown): SyncHourBucket | null {
  if (!isRecord(value)) return null
  if (
    !isNumber(value.dayOfWeek) ||
    !isNumber(value.hour) ||
    !isNumber(value.costUsd)
  ) {
    return null
  }
  return {
    dayOfWeek: value.dayOfWeek,
    hour: value.hour,
    costUsd: value.costUsd,
  }
}

export function parseSyncBatch(value: unknown): SyncBatch {
  if (!isRecord(value) || !isString(value.generatedAt) || !Array.isArray(value.pricingSnapshots) || !Array.isArray(value.rows)) {
    throw new Error("Invalid sync batch")
  }

  const pricingSnapshots = value.pricingSnapshots.map(parsePricingSnapshot)
  const rows = value.rows.map(parseBatchRow)
  const hourBucketsRaw = Array.isArray(value.hourBuckets) ? value.hourBuckets : []
  const hourBuckets = hourBucketsRaw.map(parseHourBucket)

  if (
    pricingSnapshots.some((snapshot) => snapshot === null) ||
    rows.some((row) => row === null) ||
    hourBuckets.some((b) => b === null)
  ) {
    throw new Error("Invalid sync batch")
  }

  return {
    generatedAt: value.generatedAt,
    pricingSnapshots: pricingSnapshots as SyncPricingSnapshot[],
    rows: rows as SyncBatchRow[],
    hourBuckets: hourBuckets as SyncHourBucket[],
  }
}

export function getAffectedDays(rows: Array<{ day: string }>): string[] {
  return [...new Set(rows.map((row) => row.day))].sort((left, right) => left.localeCompare(right))
}

export function rollupRowsByDay(rows: RollupInput[]): RollupOutput[] {
  const grouped = new Map<string, RollupOutput>()

  for (const row of rows) {
    const key = `${row.day}:${row.provider}:${row.model}`
    const existing = grouped.get(key)

    if (existing) {
      existing.costUsd += row.costUsd
      continue
    }

    grouped.set(key, {
      day: row.day,
      provider: row.provider,
      model: row.model,
      costUsd: row.costUsd,
    })
  }

  return [...grouped.values()].sort((a, b) => {
    if (a.day !== b.day) return a.day.localeCompare(b.day)
    if (a.provider !== b.provider) return a.provider.localeCompare(b.provider)
    return a.model.localeCompare(b.model)
  })
}

export async function ingestSyncBatch(input: unknown): Promise<IngestResult> {
  const batch = parseSyncBatch(input)
  const affectedDays = getAffectedDays(batch.rows)

  if (affectedDays.length === 0) {
    return {
      generatedAt: batch.generatedAt,
      affectedDays,
      pricingSnapshotsInserted: 0,
      usageRowsInserted: 0,
      dailyRollupsInserted: 0,
      hourBucketsInserted: 0,
    }
  }

  return db.transaction(async (tx) => {
    if (batch.pricingSnapshots.length > 0) {
      await tx
        .insert(pricingSnapshots)
        .values(
          batch.pricingSnapshots.map((snapshot) => ({
            ...snapshot,
            inputCost: snapshot.inputCost === null ? null : toDbNumber(snapshot.inputCost),
            outputCost: snapshot.outputCost === null ? null : toDbNumber(snapshot.outputCost),
            cacheReadCost: snapshot.cacheReadCost === null ? null : toDbNumber(snapshot.cacheReadCost),
            cacheWriteCost: snapshot.cacheWriteCost === null ? null : toDbNumber(snapshot.cacheWriteCost),
          })),
        )
        .onConflictDoNothing()
    }

    if (batch.rows.length > 0) {
      await tx
        .insert(usageRows)
        .values(
          batch.rows.map((row) => ({
            ...row,
            costUsd: toDbNumber(row.costUsd),
          })),
        )
        .onConflictDoUpdate({
          target: usageRows.dedupeKey,
          set: {
            costUsd: sql`excluded.cost_usd`,
            pricingMode: sql`excluded.pricing_mode`,
            pricingSnapshotKey: sql`excluded.pricing_snapshot_key`,
            inputTokens: sql`excluded.input_tokens`,
            outputTokens: sql`excluded.output_tokens`,
            cacheReadTokens: sql`excluded.cache_read_tokens`,
            cacheWriteTokens: sql`excluded.cache_write_tokens`,
            createdAt: sql`now()`,
          },
        })
    }

    await tx.delete(dailyRollups).where(inArray(dailyRollups.day, affectedDays))

    const persistedRows = await tx
      .select({
        day: usageRows.day,
        provider: usageRows.provider,
        model: usageRows.model,
        costUsd: usageRows.costUsd,
      })
      .from(usageRows)
      .where(inArray(usageRows.day, affectedDays))

    const rebuiltRollups = rollupRowsByDay(
      persistedRows.map((row) => ({
        day: row.day,
        provider: row.provider,
        model: row.model,
        costUsd: Number(row.costUsd),
      })),
    )

    if (rebuiltRollups.length > 0) {
      await tx
        .insert(dailyRollups)
        .values(
          rebuiltRollups.map((row) => ({
            ...row,
            costUsd: toDbNumber(row.costUsd),
          })),
        )
        .onConflictDoNothing()
    }

    await tx.delete(hourOfDayBuckets)
    if (batch.hourBuckets.length > 0) {
      await tx.insert(hourOfDayBuckets).values(
        batch.hourBuckets.map((b) => ({
          dayOfWeek: b.dayOfWeek,
          hour: b.hour,
          costUsd: toDbNumber(b.costUsd),
        })),
      )
    }

    return {
      generatedAt: batch.generatedAt,
      affectedDays,
      pricingSnapshotsInserted: batch.pricingSnapshots.length,
      usageRowsInserted: batch.rows.length,
      dailyRollupsInserted: rebuiltRollups.length,
      hourBucketsInserted: batch.hourBuckets.length,
    }
  })
}
