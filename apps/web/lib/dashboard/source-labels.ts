/**
 * Readable labels for the `usageRows.source` identifiers shown in the dashboard.
 *
 * The keys are the stable source ids stored in Postgres — never rename them
 * here. This map only controls the text the UI renders for a given id.
 */
const SOURCE_LABELS: Record<string, string> = {
  "claude-code": "Claude Code",
  codex: "Codex",
  opencode: "OpenCode",
  kimi: "Kimi",
  agy: "AGY",
  omp: "OMP",
  dsh: "DSH",
}

/**
 * Human-readable label for a source id. Unknown ids fall back to the raw id so
 * new pipeline sources stay visible instead of being hidden.
 */
export function sourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? source
}
