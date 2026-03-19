CREATE TABLE IF NOT EXISTS "usage_rows" (
  "dedupe_key" varchar(64) PRIMARY KEY,
  "source" text NOT NULL,
  "provider" text NOT NULL,
  "model" text NOT NULL,
  "day" text NOT NULL,
  "cost_usd" numeric(12, 4) NOT NULL,
  "pricing_mode" text NOT NULL,
  "pricing_snapshot_key" text,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "usage_rows_dedupe_idx" ON "usage_rows" ("dedupe_key");

CREATE TABLE IF NOT EXISTS "pricing_snapshots" (
  "snapshot_key" text PRIMARY KEY,
  "provider" text NOT NULL,
  "model" text NOT NULL,
  "input_cost" numeric(12, 4),
  "output_cost" numeric(12, 4),
  "cache_read_cost" numeric(12, 4),
  "cache_write_cost" numeric(12, 4),
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "daily_rollups" (
  "day" text NOT NULL,
  "provider" text NOT NULL,
  "model" text NOT NULL,
  "cost_usd" numeric(12, 4) NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "daily_rollups_day_provider_model_idx" ON "daily_rollups" ("day", "provider", "model");
