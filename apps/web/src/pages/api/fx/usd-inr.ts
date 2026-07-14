import type { APIRoute } from "astro"

import { FALLBACK_USD_TO_INR } from "@/lib/dashboard/currency"

export const prerender = false

const SOURCE = "open.er-api.com"
const SOURCE_URL = "https://open.er-api.com/v6/latest/USD"

type FxResponse = {
  result?: string
  rates?: {
    INR?: unknown
  }
  time_last_update_utc?: string
}

function json(body: unknown, maxAgeSeconds: number): Response {
  return new Response(JSON.stringify(body), {
    headers: {
      "content-type": "application/json",
      "cache-control": `public, max-age=${maxAgeSeconds}, s-maxage=86400, stale-while-revalidate=86400`,
    },
  })
}

function isValidUsdInrRate(rate: unknown): rate is number {
  return (
    typeof rate === "number" && Number.isFinite(rate) && rate > 50 && rate < 150
  )
}

function fallbackResponse() {
  return json(
    {
      base: "USD",
      target: "INR",
      rate: FALLBACK_USD_TO_INR,
      asOf: "Tue, 14 Jul 2026 00:02:31 +0000",
      source: SOURCE,
      fallback: true,
    },
    300
  )
}

export const GET: APIRoute = async () => {
  try {
    const response = await fetch(SOURCE_URL, {
      headers: { accept: "application/json" },
    })
    if (!response.ok) return fallbackResponse()

    const data = (await response.json()) as FxResponse
    const rate = data.rates?.INR
    if (data.result !== "success" || !isValidUsdInrRate(rate)) {
      return fallbackResponse()
    }

    return json(
      {
        base: "USD",
        target: "INR",
        rate,
        asOf: data.time_last_update_utc ?? new Date().toISOString(),
        source: SOURCE,
        fallback: false,
      },
      3600
    )
  } catch {
    return fallbackResponse()
  }
}
