import { describe, expect, it } from "bun:test"
import { normalizeModelKey } from "../src/model-aliases"

describe("usage-core smoke test", () => {
  it("exports normalizeModelKey", () => {
    expect(typeof normalizeModelKey).toBe("function")
  })
})
