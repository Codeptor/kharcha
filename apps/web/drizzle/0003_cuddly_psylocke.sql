ALTER TABLE "daily_rollups" ALTER COLUMN "cost_usd" SET DATA TYPE numeric(18, 8);--> statement-breakpoint
ALTER TABLE "hour_of_day_buckets" ALTER COLUMN "cost_usd" SET DATA TYPE numeric(18, 8);--> statement-breakpoint
ALTER TABLE "pricing_snapshots" ALTER COLUMN "input_cost" SET DATA TYPE numeric(18, 8);--> statement-breakpoint
ALTER TABLE "pricing_snapshots" ALTER COLUMN "output_cost" SET DATA TYPE numeric(18, 8);--> statement-breakpoint
ALTER TABLE "pricing_snapshots" ALTER COLUMN "cache_read_cost" SET DATA TYPE numeric(18, 8);--> statement-breakpoint
ALTER TABLE "pricing_snapshots" ALTER COLUMN "cache_write_cost" SET DATA TYPE numeric(18, 8);--> statement-breakpoint
ALTER TABLE "usage_rows" ALTER COLUMN "cost_usd" SET DATA TYPE numeric(18, 8);