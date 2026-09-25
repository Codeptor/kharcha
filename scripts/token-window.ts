import { mkdir, rename, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { formatTokenCount, runTokenWindow } from "../packages/usage-core/src/index.ts"

// Snapshot of local agent token usage over a trailing window, for the caelestia
// bar widget (`ClaudeTokens.qml`). Reads every local store the sync pipeline
// knows about, so DeepSeek and Google usage shows up beside Claude's. Writes
// atomically so the widget never reads a partial file. See AGENTS.md.
function argValue(name: string): string | null {
  const prefix = `--${name}=`
  const hit = process.argv.find(argument => argument.startsWith(prefix))
  return hit ? hit.slice(prefix.length) : null
}

const home = process.env.HOME ?? ""
const cacheHome = process.env.XDG_CACHE_HOME ?? join(home, ".cache")
const days = Number(argValue("days") ?? 7)
const root = argValue("root") ?? process.env.CLAUDE_CODE_PATH ?? join(home, ".claude/projects")
const out = argValue("out") ?? process.env.CLAUDE_TOKENS_OUT ?? join(cacheHome, "claude-usage/tokens.json")
const pricingPath = argValue("pricing") ?? process.env.KHARCHA_PRICING_PATH ?? join(cacheHome, "kharcha/pricing.json")
const cachePath = process.argv.includes("--no-cache")
  ? null
  : (argValue("cache") ?? process.env.CLAUDE_TOKENS_CACHE_PATH ?? join(cacheHome, "kharcha/claude-tokens-cache.json"))
const claudeOnly = process.argv.includes("--claude-only")

// Only sources that exist are read at all; the rest are skipped by the window.
const sources = claudeOnly
  ? {}
  : {
      omp: process.env.OMP_SESSIONS_PATH ?? join(home, ".omp/agent/sessions"),
      dsh: process.env.DSH_SESSIONS_PATH ?? join(home, ".dsh/sessions"),
      agy: process.env.AGY_USAGE_PATH ?? join(home, ".gemini/antigravity-cli/kharcha-usage.jsonl"),
      kimi: process.env.KIMI_PATH ?? join(home, ".kimi/sessions"),
      codex: process.env.CODEX_PATH ?? join(home, ".codex"),
      codexCachePath: process.env.CODEX_CACHE_PATH ?? join(cacheHome, "kharcha/codex-rollouts.json"),
      opencode: process.env.OPENCODE_PATH ?? join(home, ".local/share/opencode/opencode.db"),
    }

if (!Number.isInteger(days) || days < 1) throw new Error(`--days must be a positive integer, got ${days}`)

const window = await runTokenWindow({ root, windowDays: days, cachePath, pricingPath, sources })

await mkdir(dirname(out), { recursive: true })
await writeFile(`${out}.tmp`, JSON.stringify(window, null, 2))
await rename(`${out}.tmp`, out)

if (!process.argv.includes("--quiet")) {
  const { totals, scan } = window
  const cost = totals.costUsd === null ? "unpriced" : `$${totals.costUsd.toFixed(2)}`
  const unpriced = totals.unpricedModels.length > 0 ? ` (${totals.unpricedModels.length} unpriced)` : ""
  const sources = window.sources.map(entry => `${entry.id} ${formatTokenCount(entry.totalTokens)}`).join(" · ")
  console.log(
    `${window.windowDays}d ${window.windowStart}..${window.windowEnd} · ${formatTokenCount(totals.totalTokens)} tok · ` +
      `in ${formatTokenCount(totals.inputTokens)} out ${formatTokenCount(totals.outputTokens)} ` +
      `cache-r ${formatTokenCount(totals.cacheReadTokens)} cache-w ${formatTokenCount(totals.cacheWriteTokens)} · ` +
      `${cost}${unpriced} · ${window.models.length} models`
  )
  console.log(`  sources: ${sources}`)
  console.log(
    `  claude-code ${scan.filesRead} files read of ${scan.files} ${scan.cold ? "(cold)" : "(incremental)"} ` +
      `${(scan.bytesRead / 1048576).toFixed(1)}MB · ` +
      scan.sources.map(entry => `${entry.id} ${entry.rows} rows ${entry.durationMs}ms${entry.error ? ` ERROR ${entry.error}` : ""}`).join(" · ") +
      ` · total ${scan.durationMs}ms`
  )
}

if (process.argv.includes("--json")) console.log(JSON.stringify(window, null, 2))
