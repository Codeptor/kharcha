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
bun run agy:install
```

## Architecture

- `packages/usage-core` reads local provider history, normalizes model IDs, and
  creates idempotent sync batches.
- `scripts/sync.ts` reads every configured source, fetches the live models.dev
  catalog, applies explicit official-price overrides, and posts to the web app.
- `apps/web` stores deduplicated usage rows and frozen pricing snapshots in
  Postgres, then serves the dashboard from materialized daily rollups.

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
