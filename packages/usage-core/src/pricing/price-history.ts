import type { PricingSnapshot } from "../types"

/**
 * A rate that differed from today's catalog for part of history. Entries are
 * applied to the archived catalog's raw rows before the lookup is derived, so
 * gateways that borrow a vendor's rate inherit the dated rate too.
 */
export type DatedRate = {
  /** Raw catalog key, `provider:model` as models.dev lists it. */
  key: string
  /** ISO timestamp, inclusive. */
  from?: string
  /** ISO timestamp, exclusive. */
  until?: string
  /** Merged over the archived entry; tiers are replaced only when given. */
  rates: Partial<PricingSnapshot>
  /** URL plus a short verbatim quote. */
  source: string
}

const DEEPSEEK_FLAT_PRICING =
  "https://api-docs.deepseek.com/quick_start/pricing archived 2026-08-10: '1M INPUT TOKENS (CACHE HIT) $0.0028 $0.003625 1M INPUT TOKENS (CACHE MISS) $0.14 $0.435 1M OUTPUT TOKENS $0.28 $0.87'; peak/off-peak pricing took effect 2026-08-16 16:00 UTC (https://api-docs.deepseek.com/updates)"

const GPT_56_JULY_30 =
  "https://openai.com/index/advancing-the-price-performance-frontier-with-gpt-5-6/: 'Starting July 30, API pricing is $2 per million input tokens and $12 per million output tokens for Terra, and $0.20 per million input tokens and $1.20 per million output tokens for Luna.' Prior rates from the OpenAI pricing page archived 2026-07-29."

export const PRICE_HISTORY: DatedRate[] = [
  {
    key: "anthropic:claude-sonnet-5-5",
    until: "2026-10-07T00:00:00Z",
    rates: { cacheReadCost: 0.2 },
    source:
      'Anthropic release notes, 2026-10-07: "We\'ve lowered the price of prompt cache reads on Claude Sonnet 5.5 from $0.20 USD to $0.10 USD per million tokens: 0.05x the base input price instead of 0.1x. Cache writes and all other prices are unchanged." Launch post (2026-09-28): https://www.anthropic.com/claude-sonnet-5-5',
  },
  {
    key: "deepseek:deepseek-v4-pro",
    until: "2026-08-16T16:00:00Z",
    rates: { inputCost: 0.435, outputCost: 0.87, cacheReadCost: 0.003625 },
    source: DEEPSEEK_FLAT_PRICING,
  },
  {
    key: "openai:gpt-5.6-sol",
    until: "2026-08-21T19:42:00Z",
    rates: {
      inputCost: 5,
      outputCost: 30,
      cacheReadCost: 0.5,
      cacheWriteCost: 6.25,
      tiers: [{ promptTokensAbove: 272000, inputCost: 10, outputCost: 45, cacheReadCost: 1, cacheWriteCost: 12.5 }],
    },
    source:
      "https://community.openai.com/t/20-price-reduction-for-gpt-5-6-sol-api-codex-credits-and-chatgpt-work/1391726 (2026-08-21T19:41:58Z, 'Starting today'): 'Sol now costs $4 per million input tokens and $20 per million output tokens… The price reductions also apply to Fast mode, long-context requests, and Batch and Flex processing.' Launch rates from the OpenAI pricing page archived 2026-07-09: 'gpt-5.6-sol $5.00 $0.50 $6.25 $30.00 $10.00 $1.00 $12.50 $45.00'",
  },
  {
    key: "openai:gpt-5.6-terra",
    until: "2026-07-30T00:00:00Z",
    rates: {
      inputCost: 2.5,
      outputCost: 15,
      cacheReadCost: 0.25,
      cacheWriteCost: 3.125,
      tiers: [{ promptTokensAbove: 272000, inputCost: 5, outputCost: 22.5, cacheReadCost: 0.5, cacheWriteCost: 6.25 }],
    },
    source: GPT_56_JULY_30,
  },
  {
    key: "openai:gpt-5.6-luna",
    until: "2026-07-30T00:00:00Z",
    rates: {
      inputCost: 1,
      outputCost: 6,
      cacheReadCost: 0.1,
      cacheWriteCost: 1.25,
      tiers: [{ promptTokensAbove: 272000, inputCost: 2, outputCost: 9, cacheReadCost: 0.2, cacheWriteCost: 2.5 }],
    },
    source: GPT_56_JULY_30,
  },
  {
    key: "google:gemini-3.6-flash",
    until: "2026-08-13T00:00:00Z",
    rates: { inputCost: 1.5, outputCost: 7.5, cacheReadCost: 0.15 },
    source:
      "ai.google.dev/gemini-api/docs/pricing archived 2026-07-22 and 2026-08-12: '$1.50 … Output price (including thinking tokens) $7.50 … Context caching price $0.15'; archived 2026-08-13 18:11 UTC: '$0.75 through December 31, 2026. $1.50 starting January 1, 2027.'",
  },
  {
    key: "deepseek:deepseek-v4-flash",
    until: "2026-08-16T16:00:00Z",
    rates: { inputCost: 0.14, outputCost: 0.28, cacheReadCost: 0.0028 },
    source: DEEPSEEK_FLAT_PRICING,
  },
  {
    key: "alibaba:deepseek-v4-flash-0731",
    until: "2026-08-16T16:00:00Z",
    rates: { inputCost: 0.2, outputCost: 0.4, cacheReadCost: 0.02 },
    source:
      "Alibaba Cloud notice 'DeepSeek-V4-Flash-0731 Price Increase Notice' (https://www.alibabacloud.com/en/notice/detail?id=2097): from 2026-08-17 00:00 (UTC+8) peak/off-peak pricing replaced the flat 0.2 input / 0.4 output; Model Studio docs: the flash-0731 cached_token price is '10% of the input_token unit price'.",
  },
]

/**
 * Time-of-day surcharge. For the rule's provider, every rate is multiplied by
 * `multiplier` when a request falls inside a window. From `from` on, logged
 * costs for that provider are ignored (harnesses compute them from off-peak
 * catalog rates), so every request is priced here.
 */
export type PeakRule = {
  /** Normalized provider of the slice. */
  provider: string
  /** ISO; the rule and the exact-cost override apply at or after this. */
  from: string
  multiplier: number
  /** Weekday 1=Mon..7=Sun and hours in UTC; endHour is exclusive. */
  windowsUtc: { weekdays: number[]; startHour: number; endHour: number }[]
  /** YYYY-MM-DD China local dates (UTC+8) on which the rule does not apply. */
  excludeDatesUtc8: string[]
  source: string
}

/** Inclusive YYYY-MM-DD ranges (UTC, so no timezone drift) expanded to explicit dates. */
function dateRange(from: string, to: string = from): string[] {
  const dates: string[] = []
  for (let t = Date.parse(from); t <= Date.parse(to); t += 86_400_000) dates.push(new Date(t).toISOString().slice(0, 10))
  return dates
}

// Chinese public holidays: State Council notices 国办发明电〔2025〕7号 (2026) and of 2026-11-05 (2027).
const CHINA_HOLIDAYS = [
  ...dateRange("2026-01-01", "2026-01-03"),
  ...dateRange("2026-02-15", "2026-02-23"),
  ...dateRange("2026-04-04", "2026-04-06"),
  ...dateRange("2026-05-01", "2026-05-05"),
  ...dateRange("2026-06-19", "2026-06-21"),
  ...dateRange("2026-09-25", "2026-09-27"),
  ...dateRange("2026-10-01", "2026-10-07"),
  ...dateRange("2027-01-01", "2027-01-03"),
  ...dateRange("2027-02-05", "2027-02-13"),
  ...dateRange("2027-04-03", "2027-04-05"),
  ...dateRange("2027-05-01", "2027-05-05"),
  ...dateRange("2027-06-09"),
  ...dateRange("2027-09-15"),
  ...dateRange("2027-10-01", "2027-10-07"),
]

export const PEAK_RULES: PeakRule[] = [
  {
    provider: "deepseek",
    from: "2026-08-16T16:00:00Z",
    multiplier: 2,
    windowsUtc: [
      { weekdays: [1, 2, 3, 4, 5], startHour: 1, endHour: 4 },
      { weekdays: [1, 2, 3, 4, 5], startHour: 6, endHour: 10 },
    ],
    excludeDatesUtc8: CHINA_HOLIDAYS,
    source:
      "https://api-docs.deepseek.com/quick_start/pricing: 'Off-peak rates are half of the peak rates. Peak hours are 01:00 - 04:00 and 06:00 - 10:00 UTC, Monday through Friday, excluding Chinese public holidays. All other hours are off-peak, including weekends and Chinese public holidays in full.' Effective 2026-08-16 16:00 UTC (https://api-docs.deepseek.com/updates). Holiday periods: State Council notices 国办发明电〔2025〕7号 (2026) and of 2026-11-05 (2027).",
  },
]
