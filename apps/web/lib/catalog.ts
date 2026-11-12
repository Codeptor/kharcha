import { createHash } from "node:crypto"
import { gunzipSync } from "node:zlib"

export type CatalogUpload =
  | { ok: true; sha256: string }
  | { ok: false; error: string }

export function isCatalogDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false
  const parsed = new Date(`${date}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date
}

/** Same check as the sync endpoint; an unset secret authorizes nobody. */
export function isAuthorizedRequest(request: Request, secret: string): boolean {
  return (
    secret !== "" && request.headers.get("authorization") === `Bearer ${secret}`
  )
}

/** An archive file is acceptable when it is gzip of a JSON object whose text hashes to the claimed sha256. */
export function validateCatalogUpload(
  date: string,
  body: Buffer,
  claimedSha256: string | null
): CatalogUpload {
  if (!isCatalogDate(date)) return { ok: false, error: "invalid date" }
  let text: string
  try {
    text = gunzipSync(body).toString("utf8")
  } catch {
    return { ok: false, error: "body is not gzip" }
  }
  try {
    const parsed: unknown = JSON.parse(text)
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
      throw new Error()
  } catch {
    return { ok: false, error: "body is not a JSON object" }
  }
  const sha256 = createHash("sha256").update(text).digest("hex")
  if (claimedSha256 !== sha256) return { ok: false, error: "sha256 mismatch" }
  return { ok: true, sha256 }
}
