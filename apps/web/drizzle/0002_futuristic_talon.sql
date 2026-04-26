ALTER TABLE "usage_rows" ADD COLUMN "input_tokens" bigint;--> statement-breakpoint
ALTER TABLE "usage_rows" ADD COLUMN "output_tokens" bigint;--> statement-breakpoint
ALTER TABLE "usage_rows" ADD COLUMN "cache_read_tokens" bigint;--> statement-breakpoint
ALTER TABLE "usage_rows" ADD COLUMN "cache_write_tokens" bigint;