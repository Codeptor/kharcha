# Kharcha

## Commands

```bash
bun install
bun run dev
bun run test
bun run lint
bun run typecheck
bun run build
bun run sync
bun run tokens
bun run agy:install
```

## Architecture

- `packages/usage-core` reads local provider history, normalizes model IDs, and
  creates idempotent sync batches.
- `scripts/sync.ts` reads every configured source, fetches the live models.dev
  catalog, applies explicit official-price overrides, and posts to the web app.
- The Codex reader caches each rollout's outcome (keys, anchors, emitted turns)
  in `$XDG_CACHE_HOME/kharcha/codex-rollouts.json` (override with
  `CODEX_CACHE_PATH`) so an hourly sync only re-reads files that grew. Delete
  the file to force a cold read.
- `apps/web` stores deduplicated usage rows and frozen pricing snapshots in
  Postgres, then serves the dashboard from materialized daily rollups.

## Bar widget snapshot

- `scripts/token-window.ts` (`bun run tokens`) writes the caelestia bar widget's
  snapshot to `$XDG_CACHE_HOME/claude-usage/tokens.json`: a rolling window of
  local days (7 by default) of token counters across **every local store the
  sync reads**: Claude Code transcripts, `~/.omp/stats.db` (oh-my-pi),
  `~/.dsh/storages/cost-meter/ledger.json` (DeepSeek Harness), AGY, Codex,
  Kimi and OpenCode. Split into input, output, cache-read and cache-write
  buckets, per model, plus cost and a per-source token total.
- Claude Code is read incrementally: per-file offsets and per-day counters live
  in `$XDG_CACHE_HOME/kharcha/claude-tokens-cache.json` (override with
  `CLAUDE_TOKENS_CACHE_PATH`, pass `--no-cache` to force a cold read). A cold
  read parses only files touched inside the window; a warm run over unchanged
  transcripts reads nothing.
- The other stores are read per run and are cheap because each is windowed:
  omp by `timestamp`, dsh by day key, OpenCode by its `time_created` column
  before any JSON extraction, Codex from its rollout cache. `--claude-only`
  restricts the run to the transcripts, which is what the fixture tests use.
- The window is day-grained, so it rolls off at local midnight rather than on
  some fixed weekday. Claude Code responses are deduped by `message.id` +
  `requestId`, exactly as `readClaudeCodeUsage` does, so the counts match the
  dashboard rather than the ~2x-inflated raw-line totals.
- Cost comes from `$XDG_CACHE_HOME/kharcha/pricing.json`, the models.dev lookup
  `bun run sync` priced its own batch with (overridable with
  `KHARCHA_PRICING_PATH`). omp and dsh report their own per-row cost, which is
  used as exact; models missing a rate are reported as `unpriced` and excluded
  from the total, never priced at zero.
- Both Claude accounts write into the same `~/.claude/projects` transcripts and
  the JSONL carries no account marker, so the Claude Code part of the window is
  always combined across `claude` and `claude2`. The percentage meter is per
  account.

## Data Rules

- Never infer token counts from prompts, response text, byte length, or context
  windows. Only ingest counters reported by the provider or CLI.
- Mark a row `unpriced` when a non-zero token category has no published rate;
  do not silently price it at zero.
- Keep source identifiers stable. The dashboard source label for Google
  Antigravity CLI is `agy`; model pricing remains per canonical provider/model.
- Keep local collectors private: source session IDs are hashed before sync, and
  prompts, paths, account IDs, and machine identifiers never leave the machine.

## AGY Collector

- Antigravity's SQLite conversation database does not persist server token
  counters, so it is not a valid historical source.
- `bun run agy:install` configures AGY's documented status-line callback to
  append only server-reported input, output, cache-read, and cache-creation
  counters to `~/.gemini/antigravity-cli/kharcha-usage.jsonl` after a real
  agent-generation transition.
- The collector captures exact usage going forward. Do not backfill existing
  AGY conversations from their stored context or when reopening a session.
