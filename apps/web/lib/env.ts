export const env = {
  DATABASE_URL: process.env.DATABASE_URL ?? "",
  SYNC_SECRET: process.env.SYNC_SECRET ?? "",
  SYNC_URL: process.env.SYNC_URL ?? "http://127.0.0.1:3000/api/sync",
  PUBLIC_SITE_TITLE: process.env.PUBLIC_SITE_TITLE ?? "Your Name",
}
