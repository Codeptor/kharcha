import { describe, expect, it } from "bun:test"
import { createHash } from "node:crypto"
import { gzipSync } from "node:zlib"
import { validateCatalogUpload } from "@/lib/catalog"

const text = JSON.stringify({
  anthropic: { models: { a: { cost: { input: 1 } } } },
})
const sha = createHash("sha256").update(text).digest("hex")
const gz = gzipSync(text)

describe("validateCatalogUpload", () => {
  it("accepts a valid file", () => {
    expect(validateCatalogUpload("2026-11-12", gz, sha)).toEqual({
      ok: true,
      sha256: sha,
    })
  })

  it("rejects a malformed date", () => {
    expect(validateCatalogUpload("2026-13-40", gz, sha).ok).toBe(false)
    expect(validateCatalogUpload("../etc", gz, sha).ok).toBe(false)
  })

  it("rejects a body that is not gzip", () => {
    expect(validateCatalogUpload("2026-11-12", Buffer.from(text), sha).ok).toBe(
      false
    )
  })

  it("rejects gzip that is not a JSON object", () => {
    expect(validateCatalogUpload("2026-11-12", gzipSync("[1]"), sha).ok).toBe(
      false
    )
  })

  it("rejects a sha mismatch or a missing header", () => {
    expect(validateCatalogUpload("2026-11-12", gz, "0".repeat(64)).ok).toBe(
      false
    )
    expect(validateCatalogUpload("2026-11-12", gz, null).ok).toBe(false)
  })
})
