import { bigint, integer, numeric, pgTable, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core"

export const usageRows = pgTable(
  "usage_rows",
  {
    dedupeKey: varchar("dedupe_key", { length: 64 }).primaryKey(),
    source: text("source").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    day: text("day").notNull(),
    costUsd: numeric("cost_usd", { precision: 12, scale: 4 }).notNull(),
    pricingMode: text("pricing_mode").notNull(),
    pricingSnapshotKey: text("pricing_snapshot_key"),
    inputTokens: bigint("input_tokens", { mode: "number" }),
    outputTokens: bigint("output_tokens", { mode: "number" }),
    cacheReadTokens: bigint("cache_read_tokens", { mode: "number" }),
    cacheWriteTokens: bigint("cache_write_tokens", { mode: "number" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    usageRowsDedupeIdx: uniqueIndex("usage_rows_dedupe_idx").on(table.dedupeKey),
  }),
)

export const dailyRollups = pgTable(
  "daily_rollups",
  {
    day: text("day").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    costUsd: numeric("cost_usd", { precision: 12, scale: 4 }).notNull(),
  },
  (table) => ({
    dailyRollupsDayProviderModelIdx: uniqueIndex("daily_rollups_day_provider_model_idx").on(
      table.day,
      table.provider,
      table.model,
    ),
  }),
)

export const hourOfDayBuckets = pgTable(
  "hour_of_day_buckets",
  {
    dayOfWeek: integer("day_of_week").notNull(),
    hour: integer("hour").notNull(),
    costUsd: numeric("cost_usd", { precision: 12, scale: 4 }).notNull(),
  },
  (table) => ({
    hourOfDayUniqIdx: uniqueIndex("hour_of_day_uniq_idx").on(table.dayOfWeek, table.hour),
  }),
)

export const pricingSnapshots = pgTable("pricing_snapshots", {
  snapshotKey: text("snapshot_key").primaryKey(),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  inputCost: numeric("input_cost", { precision: 12, scale: 4 }),
  outputCost: numeric("output_cost", { precision: 12, scale: 4 }),
  cacheReadCost: numeric("cache_read_cost", { precision: 12, scale: 4 }),
  cacheWriteCost: numeric("cache_write_cost", { precision: 12, scale: 4 }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
})
