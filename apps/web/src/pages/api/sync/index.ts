import type { APIRoute } from "astro"

import { ingestSyncBatch } from "@/lib/db/ingest"
import { env } from "@/lib/env"

export const prerender = false

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

function isAuthorized(request: Request): boolean {
  const authorization = request.headers.get("authorization")
  return authorization === `Bearer ${env.SYNC_SECRET}`
}

export const POST: APIRoute = async ({ request }) => {
  if (!isAuthorized(request)) {
    return json({ error: "unauthorized" }, 401)
  }

  try {
    const body = await request.json()
    const result = await ingestSyncBatch(body)
    return json(result)
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "invalid sync batch"
    const status = message === "Invalid sync batch" ? 400 : 500
    return json({ error: message }, status)
  }
}
