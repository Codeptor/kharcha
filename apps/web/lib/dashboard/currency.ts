export type Currency = "USD" | "INR"

export type CurrencyRates = Record<Currency, number>

export const FALLBACK_USD_TO_INR = 95.720757

export const CURRENCY_RATES: CurrencyRates = {
  USD: 1,
  INR: FALLBACK_USD_TO_INR,
}

export const CURRENCY_SYMBOL: Record<Currency, string> = {
  USD: "$",
  INR: "₹",
}

export function convert(
  usd: number,
  currency: Currency,
  rates: CurrencyRates = CURRENCY_RATES
): number {
  return usd * rates[currency]
}

export function formatCompact(
  usd: number,
  currency: Currency,
  rates: CurrencyRates = CURRENCY_RATES
): string {
  const value = convert(usd, currency, rates)
  const symbol = CURRENCY_SYMBOL[currency]
  if (value >= 1_000_000) return `${symbol}${(value / 1_000_000).toFixed(1)}m`
  if (value >= 1_000) return `${symbol}${(value / 1_000).toFixed(1)}k`
  return `${symbol}${value.toFixed(currency === "INR" ? 0 : 2)}`
}

export function formatFull(
  usd: number,
  currency: Currency,
  rates: CurrencyRates = CURRENCY_RATES
): string {
  const value = convert(usd, currency, rates)
  const symbol = CURRENCY_SYMBOL[currency]
  if (currency === "INR") {
    return `${symbol}${Math.round(value).toLocaleString("en-IN")}`
  }
  return `${symbol}${value.toFixed(2)}`
}
