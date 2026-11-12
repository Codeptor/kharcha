import type { APIRoute } from "astro"
import { asc } from "drizzle-orm"

import { isAuthorizedRequest } from "@/lib/catalog"
import { db } from "@/lib/db/client"
import { catalogArchives } from "@/lib/db/schema"
import { env } from "@/lib/env"

export const prerender = false

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })

export const GET: APIRoute = async ({ request }) => {
  if (!isAuthorizedRequest(request, env.SYNC_SECRET))
    return json({ error: "unauthorized" }, 401)
  const rows = await db
    .select({ date: catalogArchives.date, sha256: catalogArchives.sha256 })
    .from(catalogArchives)
    .orderBy(asc(catalogArchives.date))
  return json(rows)
}
