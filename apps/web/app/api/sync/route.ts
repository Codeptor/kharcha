import { NextRequest, NextResponse } from "next/server"

import { ingestSyncBatch } from "@/lib/db/ingest"
import { env } from "@/lib/env"

export const runtime = "nodejs"

function isAuthorized(request: NextRequest): boolean {
  const authorization = request.headers.get("authorization")
  return authorization === `Bearer ${env.SYNC_SECRET}`
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }

  try {
    const body = await request.json()
    const result = await ingestSyncBatch(body)
    return NextResponse.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid sync batch"
    const status = message === "Invalid sync batch" ? 400 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
