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
- `scripts/sync.ts` reads every configured source, archives the models.dev
  catalog, prices each request at the rate in force when it was made, and
  posts to the web app.
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
  sync reads**: Claude Code transcripts, omp (oh-my-pi) session transcripts,
  DeepSeek Harness session transcripts, AGY, Codex, Kimi and OpenCode. Split
  into input, output, cache-read and cache-write buckets, per model, plus cost
  and a per-source token total.
- omp and the DeepSeek Harness are read from their **session transcripts**
  (`~/.omp/agent/sessions`, `~/.dsh/sessions`), not from the derived stores
  beside them. Both harnesses keep a second database that only folds sessions
  in on its own schedule: omp's `stats.db` had 10 of 59 sessions ingested and
  the DeepSeek Harness's cost-meter ledger stopped mid-day, so either one
  under-reports by an order of magnitude. Verify against the session files.
- dsh transcripts are zstd-compressed and carry no cost, so those rows are
  priced from the catalog; omp transcripts carry the harness's own cost, which
  is kept as exact.
- Claude Code is read incrementally: per-file offsets, per-day counters and the
  response keys already counted live in
  `$XDG_CACHE_HOME/kharcha/claude-tokens-cache.json` (override with
  `CLAUDE_TOKENS_CACHE_PATH`, pass `--no-cache` to force a cold read). A cold
  read parses only files touched inside the window; a warm run over unchanged
  transcripts reads nothing. The key set spans the whole window on purpose: a
  resumed or replayed session can log a response again far from its first
  appearance, and a short trailing window double-counts those.
- The other stores are read per run and are cheap because each is windowed:
  omp by `timestamp`, dsh by day key, OpenCode by its `time_created` column
  before any JSON extraction, Codex from its rollout cache. `--claude-only`
  restricts the run to the transcripts, which is what the fixture tests use.
- The window is day-grained, so it rolls off at local midnight rather than on
  some fixed weekday. Claude Code responses are deduped by `message.id` +
  `requestId`, exactly as `readClaudeCodeUsage` does, so the counts match the
  dashboard rather than the ~2x-inflated raw-line totals.
- Cost comes from the catalog archive the sync writes, through the same dated
  resolver the sync prices with (`createDatedPricing`), so a rate never has two
  sources of truth. Logged per-row costs (omp, OpenCode) are used as exact,
  except where a peak rule overrides them; models missing a rate are reported
  as `unpriced` and excluded from the total, never priced at zero. With no
  archive yet (before the first sync) every estimated model is unpriced.
- Each request is priced at its context tier with the same functions the sync
  uses (`resolveRates`, `priceCounters`). The Claude Code cache (schema 5)
  keeps counters split by the tier band each response fell into and records
  each day's thresholds per model, so a pricing change that moves them forces
  a cold read. Claude Code counters are day-grained, so they take the rate in
  force at local noon of their day, as any slice without a timestamp does.
- Both Claude accounts write into the same `~/.claude/projects` transcripts and
  the JSONL carries no account marker, so the Claude Code part of the window is
  always combined across `claude` and `claude2`. The percentage meter is per
  account.

## Data Rules

- Never infer token counts from prompts, response text, byte length, or context
  windows. Only ingest counters reported by the provider or CLI.
- Mark a row `unpriced` when a non-zero token category has no published rate;
  do not silently price it at zero.
- Price every request at the context tier its prompt falls into. models.dev
  publishes the thresholds as `cost.tiers` (older entries use
  `context_over_200k`), and a tier applies when input + cache-read +
  cache-write tokens exceed its size. Readers must keep emitting one slice per
  API response; a slice that sums several requests would bill at the wrong
  tier. A row that mixes priced and unpriced turns is marked `unpriced`.
- Gateway providers that resell other vendors' models without publishing rates
  of their own (NIM, TokenRouter, OpenCode, OpenRouter, QwenCloud) borrow the
  retail rate of the same model under a provider that publishes one, matched
  on the trailing model id in any case, preferring first-party vendors and then
  well-known hosts. QwenCloud (Alibaba's Token Plan) mirrors Alibaba's own
  pay-as-you-go catalog first. A model whose id says `free` is exempt: zero is
  its actual rate, not a missing one, so it prices at $0 even after the catalog
  drops it.
- OpenCode's `claude-agent` provider (`opus`, `sonnet`, `fable`) runs Claude
  Code, so its turns are already in `~/.claude/projects` under the real model
  ids. The OpenCode reader drops them; reading both doubled those tokens.
- `CUSTOM_PRICING` holds only models the catalog lacks, each citing its source.
  An entry replaces the catalog's rate and its tiers, so delete it once
  models.dev lists the model.
- Price each request at the rate in force when it was made. Every sync
  archives the models.dev catalog as `YYYY-MM-DD.json.gz` under
  `$XDG_DATA_HOME/kharcha/catalog` (`KHARCHA_CATALOG_DIR`) when it changed, and
  a request uses the newest archive at or before its local day. A model the
  catalog listed only later takes its first listed price. The archive is
  persistent data: deleting it re-prices history at the oldest surviving day.
  Unreadable files are skipped, a payload with under 1,000 models or under 70%
  of the newest archive is refused, a failed fetch prices from the archive,
  and `--dry-run` never writes it.
- models.dev trails vendors by days to weeks, and the archive starts on
  2026-11-12, so verified past rates live in `PRICE_HISTORY`
  (`packages/usage-core/src/pricing/price-history.ts`), each with an `until`
  and a source quote. They apply to raw catalog rows before derivation, so
  gateways that borrow a vendor's rate inherit them. Never add an entry without
  `until`: it would pin that rate over every later catalog change.
- `PEAK_RULES` holds time-of-day surcharges: DeepSeek bills 2x Monday to Friday
  01:00-04:00 and 06:00-10:00 UTC since 2026-08-16 16:00 UTC, except on China's
  public holidays (by China-local date). Harnesses log DeepSeek costs from the
  off-peak catalog, so those logged costs are ignored and kharcha prices the
  requests itself. Add each year's holidays when the State Council publishes
  them (usually November). Alibaba's busy-hour pricing for its DeepSeek models
  is not modeled; QwenCloud usage is a subscription priced at Alibaba's list.
- The sync never re-prices DB rows whose local source is gone. A new
  `PRICE_HISTORY` entry that covers their days needs a one-off correction of
  those rows (scale each token class by the rate change; keep the stored
  cache-write mix).
- The production DB keeps rows whose local source is gone: Claude Code prunes
  transcripts after 30 days and older Codex rollouts are deleted. Never
  reconcile the DB against a batch wholesale; delete only keys proven stale
  (the session is still on disk, or the reader that wrote them was replaced).
- A turn with no token counters and no cost is not usage. Readers drop those
  rows instead of persisting zero rows, which would otherwise surface
  downstream as unpriced noise.
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
