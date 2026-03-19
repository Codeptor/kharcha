CREATE TABLE "daily_rollups" (
	"day" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"cost_usd" numeric(12, 4) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pricing_snapshots" (
	"snapshot_key" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"input_cost" numeric(12, 4),
	"output_cost" numeric(12, 4),
	"cache_read_cost" numeric(12, 4),
	"cache_write_cost" numeric(12, 4),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_rows" (
	"dedupe_key" varchar(64) PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"day" text NOT NULL,
	"cost_usd" numeric(12, 4) NOT NULL,
	"pricing_mode" text NOT NULL,
	"pricing_snapshot_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "daily_rollups_day_provider_model_idx" ON "daily_rollups" USING btree ("day","provider","model");--> statement-breakpoint
CREATE UNIQUE INDEX "usage_rows_dedupe_idx" ON "usage_rows" USING btree ("dedupe_key");
