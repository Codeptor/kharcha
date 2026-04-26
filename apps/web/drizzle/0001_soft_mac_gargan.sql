CREATE TABLE "hour_of_day_buckets" (
	"day_of_week" integer NOT NULL,
	"hour" integer NOT NULL,
	"cost_usd" numeric(12, 4) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "hour_of_day_uniq_idx" ON "hour_of_day_buckets" USING btree ("day_of_week","hour");