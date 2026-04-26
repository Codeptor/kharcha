export type Currency = "USD" | "INR"

export const CURRENCY_RATES: Record<Currency, number> = {
  USD: 1,
  INR: 84.5,
}

export const CURRENCY_SYMBOL: Record<Currency, string> = {
  USD: "$",
  INR: "₹",
}

export function convert(usd: number, currency: Currency): number {
  return usd * CURRENCY_RATES[currency]
}

export function formatCompact(usd: number, currency: Currency): string {
  const value = convert(usd, currency)
  const symbol = CURRENCY_SYMBOL[currency]
  if (value >= 1_000_000) return `${symbol}${(value / 1_000_000).toFixed(1)}m`
  if (value >= 1_000) return `${symbol}${(value / 1_000).toFixed(1)}k`
  return `${symbol}${value.toFixed(currency === "INR" ? 0 : 2)}`
}

export function formatFull(usd: number, currency: Currency): string {
  const value = convert(usd, currency)
  const symbol = CURRENCY_SYMBOL[currency]
  if (currency === "INR") {
    return `${symbol}${Math.round(value).toLocaleString("en-IN")}`
  }
  return `${symbol}${value.toFixed(2)}`
}
