type RollupInput = {
  day: string
  provider: string
  model: string
  costUsd: number
}

type RollupOutput = {
  day: string
  provider: string
  model: string
  costUsd: number
}

export function rollupRowsByDay(rows: RollupInput[]): RollupOutput[] {
  const grouped = new Map<string, RollupOutput>()

  for (const row of rows) {
    const key = `${row.day}:${row.provider}:${row.model}`
    const existing = grouped.get(key)

    if (existing) {
      existing.costUsd += row.costUsd
      continue
    }

    grouped.set(key, {
      day: row.day,
      provider: row.provider,
      model: row.model,
      costUsd: row.costUsd,
    })
  }

  return [...grouped.values()].sort((a, b) => {
    if (a.day !== b.day) return a.day.localeCompare(b.day)
    if (a.provider !== b.provider) return a.provider.localeCompare(b.provider)
    return a.model.localeCompare(b.model)
  })
}
