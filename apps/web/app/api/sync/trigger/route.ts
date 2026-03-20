import { NextRequest, NextResponse } from "next/server"
import { execFile } from "node:child_process"
import { env } from "@/lib/env"

export const runtime = "nodejs"
export const maxDuration = 120

function isAuthorized(request: NextRequest): boolean {
  const authorization = request.headers.get("authorization")
  return authorization === `Bearer ${env.SYNC_SECRET}`
}

function runSync(): Promise<string> {
  const cwd = process.cwd().replace(/\/apps\/web$/, "")
  return new Promise((resolve, reject) => {
    execFile(
      "bun",
      ["run", "scripts/sync.ts"],
      { cwd, timeout: 90_000 },
      (error, stdout, stderr) => {
        if (error) reject(new Error(stderr || error.message))
        else resolve(stdout + stderr)
      },
    )
  })
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }

  try {
    const output = await runSync()
    return NextResponse.json({ ok: true, output })
  } catch (error) {
    const message = error instanceof Error ? error.message : "sync failed"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
