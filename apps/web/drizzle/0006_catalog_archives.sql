CREATE TABLE "catalog_archives" (
	"date" text PRIMARY KEY NOT NULL,
	"sha256" text NOT NULL,
	"payload" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
