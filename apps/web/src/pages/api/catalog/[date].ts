import type { APIRoute } from "astro"
import { eq, sql } from "drizzle-orm"

import {
  isAuthorizedRequest,
  isCatalogDate,
  validateCatalogUpload,
} from "@/lib/catalog"
import { db } from "@/lib/db/client"
import { catalogArchives } from "@/lib/db/schema"
import { env } from "@/lib/env"

export const prerender = false

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })

export const GET: APIRoute = async ({ request, params }) => {
  if (!isAuthorizedRequest(request, env.SYNC_SECRET))
    return json({ error: "unauthorized" }, 401)
  const date = params.date ?? ""
  if (!isCatalogDate(date)) return json({ error: "invalid date" }, 400)
  const [row] = await db
    .select({ payload: catalogArchives.payload })
    .from(catalogArchives)
    .where(eq(catalogArchives.date, date))
  if (!row) return json({ error: "not found" }, 404)
  return new Response(Buffer.from(row.payload, "base64"), {
    headers: { "content-type": "application/gzip" },
  })
}

export const PUT: APIRoute = async ({ request, params }) => {
  if (!isAuthorizedRequest(request, env.SYNC_SECRET))
    return json({ error: "unauthorized" }, 401)
  const date = params.date ?? ""
  const body = Buffer.from(await request.arrayBuffer())
  const checked = validateCatalogUpload(
    date,
    body,
    request.headers.get("x-catalog-sha256")
  )
  if (!checked.ok) return json({ error: checked.error }, 400)
  const payload = body.toString("base64")
  await db
    .insert(catalogArchives)
    .values({ date, sha256: checked.sha256, payload })
    .onConflictDoUpdate({
      target: catalogArchives.date,
      set: { sha256: checked.sha256, payload, updatedAt: sql`now()` },
    })
  return json({ date, sha256: checked.sha256, written: true })
}
