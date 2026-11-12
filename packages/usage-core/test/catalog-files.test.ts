import { describe, expect, it } from "bun:test"
import { createHash } from "node:crypto"
import { existsSync } from "node:fs"
import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { gunzipSync, gzipSync } from "node:zlib"
import { listArchiveFiles, readArchiveGzip, writeArchiveGzip } from "../src/pricing/catalog-archive"

const text = JSON.stringify({ acme: { models: { m: { cost: { input: 1, output: 2 } } } } })

describe("catalog archive files", () => {
  it("lists the sha of the uncompressed JSON and skips unreadable files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kharcha-files-"))
    await writeFile(join(dir, "2026-11-01.json.gz"), gzipSync(text))
    await writeFile(join(dir, "2026-11-02.json.gz"), "not gzip")
    expect(listArchiveFiles(dir)).toEqual([
      { date: "2026-11-01", sha256: createHash("sha256").update(text).digest("hex") },
    ])
    expect(gunzipSync(readArchiveGzip(dir, "2026-11-01")).toString()).toBe(text)
  })

  it("refuses invalid gzip and leaves nothing behind", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kharcha-files-"))
    expect(() => writeArchiveGzip(dir, "2026-11-03", Buffer.from("junk"))).toThrow()
    expect(() => writeArchiveGzip(dir, "2026-11-03", gzipSync("[1]"))).toThrow()
    expect(existsSync(join(dir, "2026-11-03.json.gz"))).toBe(false)
    writeArchiveGzip(dir, "2026-11-03", gzipSync(text))
    expect((await readFile(join(dir, "2026-11-03.json.gz"))).length).toBeGreaterThan(0)
  })
})
