import type { APIRoute } from "astro"
import { execFile } from "node:child_process"

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
      }
    )
  })
}

export const POST: APIRoute = async ({ request }) => {
  if (!isAuthorized(request)) {
    return json({ error: "unauthorized" }, 401)
  }

  try {
    const output = await runSync()
    return json({ ok: true, output })
  } catch (error) {
    const message = error instanceof Error ? error.message : "sync failed"
    return json({ error: message }, 500)
  }
}
