import { defineConfig } from "drizzle-kit"

export default defineConfig({
  schema: "./apps/web/lib/db/schema.ts",
  out: "./apps/web/drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
})
