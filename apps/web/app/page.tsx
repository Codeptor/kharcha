import { Dashboard } from "@/components/dashboard"
import { getDashboardData } from "@/lib/dashboard/get-dashboard-data"
import { env } from "@/lib/env"
import type { Metadata, Viewport } from "next"

export const dynamic = "force-dynamic"

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
}

export const metadata: Metadata = {
  title: "kharcha",
  description: "kharcha — track your AI coding spend across Claude Code, Codex, OpenCode, and Kimi",
}

async function triggerSync() {
  "use server"
  const res = await fetch(`${env.SYNC_URL?.replace("/api/sync", "")}/api/sync/trigger`, {
    method: "POST",
    headers: { authorization: `Bearer ${env.SYNC_SECRET}` },
  }).catch(() => null)
  if (!res?.ok) {
    const body = await res?.json().catch(() => ({}))
    throw new Error((body as Record<string, string>)?.error ?? "sync failed")
  }
}

export default async function Page() {
  const data = await getDashboardData()
  return <Dashboard data={data} syncAction={triggerSync} />
}
