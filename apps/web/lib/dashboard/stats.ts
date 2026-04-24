import type { DashboardData } from "./chart-shape"

export type StreakInfo = {
  current: number
  longest: number
  activeDays: number
  totalDays: number
}

export type ModelStat = {
  key: string
  label: string
  provider: string
  costUsd: number
  activeDays: number
  avgPerActiveDay: number
  share: number
}

export function computeStreaks(days: DashboardData["days"]): StreakInfo {
  if (days.length === 0) {
    return { current: 0, longest: 0, activeDays: 0, totalDays: 0 }
  }

  const active = new Set(days.filter((d) => d.total > 0).map((d) => d.day))
  const first = new Date(`${days[0]!.day}T00:00:00Z`)
  const last = new Date(`${days[days.length - 1]!.day}T00:00:00Z`)

  let longest = 0
  let run = 0
  const cur = new Date(first)
  while (cur <= last) {
    const iso = cur.toISOString().slice(0, 10)
    if (active.has(iso)) {
      run += 1
      if (run > longest) longest = run
    } else {
      run = 0
    }
    cur.setUTCDate(cur.getUTCDate() + 1)
  }

  let current = 0
  const walk = new Date(last)
  while (walk >= first) {
    const iso = walk.toISOString().slice(0, 10)
    if (!active.has(iso)) break
    current += 1
    walk.setUTCDate(walk.getUTCDate() - 1)
  }

  const totalDays = Math.round((last.getTime() - first.getTime()) / 86_400_000) + 1

  return { current, longest, activeDays: active.size, totalDays }
}

export function computeModelStats(days: DashboardData["days"]): ModelStat[] {
  const map = new Map<string, ModelStat & { _daysUsed: Set<string> }>()
  let grandTotal = 0

  for (const day of days) {
    for (const seg of day.segments) {
      grandTotal += seg.costUsd
      const provider = seg.key.split(":")[0] ?? ""
      const entry = map.get(seg.key) ?? {
        key: seg.key,
        label: seg.label,
        provider,
        costUsd: 0,
        activeDays: 0,
        avgPerActiveDay: 0,
        share: 0,
        _daysUsed: new Set<string>(),
      }
      entry.costUsd += seg.costUsd
      if (seg.costUsd > 0) entry._daysUsed.add(day.day)
      map.set(seg.key, entry)
    }
  }

  const stats: ModelStat[] = []
  for (const entry of map.values()) {
    const activeDays = entry._daysUsed.size
    stats.push({
      key: entry.key,
      label: entry.label,
      provider: entry.provider,
      costUsd: entry.costUsd,
      activeDays,
      avgPerActiveDay: activeDays > 0 ? entry.costUsd / activeDays : 0,
      share: grandTotal > 0 ? entry.costUsd / grandTotal : 0,
    })
  }

  return stats.sort((a, b) => b.costUsd - a.costUsd)
}

export function providerSparkline(
  days: DashboardData["days"],
  provider: string,
  buckets = 30,
): number[] {
  if (days.length === 0) return new Array(buckets).fill(0)
  const slice = days.slice(-buckets)
  const result = new Array(buckets).fill(0)
  const offset = buckets - slice.length
  for (let i = 0; i < slice.length; i++) {
    const day = slice[i]!
    let sum = 0
    for (const seg of day.segments) {
      if (seg.key.startsWith(`${provider}:`)) sum += seg.costUsd
    }
    result[offset + i] = sum
  }
  return result
}
