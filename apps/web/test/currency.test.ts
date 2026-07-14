import { describe, expect, it } from "bun:test"

import {
  CURRENCY_RATES,
  convert,
  formatCompact,
  formatFull,
  type CurrencyRates,
} from "../lib/dashboard/currency"

describe("currency formatting", () => {
  const rates: CurrencyRates = { USD: 1, INR: 100 }

  it("converts USD values with the supplied INR rate", () => {
    expect(convert(2.5, "INR", rates)).toBe(250)
    expect(convert(2.5, "USD", rates)).toBe(2.5)
  })

  it("formats INR with Indian grouping and compact suffixes", () => {
    expect(formatFull(1234.56, "INR", rates)).toBe("₹1,23,456")
    expect(formatCompact(1234.56, "INR", rates)).toBe("₹123.5k")
  })

  it("keeps the default INR fallback near the current market rate", () => {
    expect(CURRENCY_RATES.INR).toBeGreaterThan(90)
    expect(CURRENCY_RATES.INR).toBeLessThan(100)
  })
})
