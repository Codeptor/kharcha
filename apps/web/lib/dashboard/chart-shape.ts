type InputRow = {
  day: string
  provider: string
  model: string
  costUsd: string
}

type ChartSegment = {
  key: string
  label: string
  costUsd: number
}

type ChartDay = {
  day: string
  total: number
  segments: ChartSegment[]
}

export function buildChartData(rows: InputRow[]) {
  const grouped = new Map<string, ChartDay>()

  for (const row of rows) {
    const costUsd = Number(row.costUsd)
    const day = grouped.get(row.day) ?? {
      day: row.day,
      total: 0,
      segments: [],
    }

    day.total += costUsd
    day.segments.push({
      key: `${row.provider}:${row.model}`,
      label: `${row.provider} / ${row.model}`,
      costUsd,
    })

    grouped.set(row.day, day)
  }

  const days = [...grouped.values()].sort((left, right) => left.day.localeCompare(right.day))
  const lifetimeTotalUsd = days.reduce((sum, day) => sum + day.total, 0)

  return { days, lifetimeTotalUsd }
}
