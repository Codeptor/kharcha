"use client"

export function ProviderSparkline({
  values,
  width = 42,
  height = 14,
}: {
  values: number[]
  width?: number
  height?: number
}) {
  if (values.length === 0) return null
  const max = values.reduce((m, v) => Math.max(m, v), 0)
  const barW = width / values.length
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden
      className="flex-shrink-0"
    >
      {values.map((v, i) => {
        const h = max > 0 ? Math.max(1, (v / max) * height) : 0
        return (
          <rect
            key={i}
            x={i * barW}
            y={height - h}
            width={Math.max(0.5, barW - 0.5)}
            height={h}
            className="fill-stone-500 dark:fill-stone-500"
          />
        )
      })}
    </svg>
  )
}
