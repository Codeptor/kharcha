# Usage Dashboard Design

Date: 2026-03-20
Project: kharcha

## Summary

Build a public personal AI usage dashboard modeled after the sparse historical chart at ephraimduncan.com/token-usage.

The public site shows only:

- lifetime total cost
- daily historical cost bars
- hover breakdown of provider and model costs for the selected day

The system ingests local usage data from Claude Code, Codex, and OpenCode on the user's machine, normalizes the records, attaches frozen pricing, and stores daily rollups for fast rendering.

## Goals

- Match the reference interaction pattern closely: simple header, total spend, historical chart, hover details
- Keep the public view limited to cost, providers, and models
- Support both manual sync and automatic sync from the user's machine
- Preserve historical totals by freezing fallback pricing at sync time
- Use `bun` as the package manager and runtime for local sync tooling
- Use shadcn/ui components where they fit naturally in the frontend

## Non-Goals

- No public auth flow
- No public session list or session drill-down
- No tokens in the public UI
- No prompts, responses, cwd paths, repo names, usernames, hostnames, or machine identifiers
- No general-purpose analytics dashboard with filters, tables, settings, or multiple pages

## Product Scope

The product is a single public page.

The page contains:

- a small identity/header area
- a lifetime total cost value
- a daily stacked bar chart

Hovering a day shows:

- the date
- the day's total cost
- provider and model line items with cost values

The stack segments are keyed by provider and model. Colors are consistent over time for the same provider-model pair.

## Data Sources

### Claude Code

Primary source:

- raw session logs in `~/.claude/projects/**/*.jsonl`

Observed fields:

- model identifiers
- token usage fields
- session identifiers

Secondary source:

- `~/.claude/stats-cache.json`

Use:

- aggregate-only historical model evidence
- fallback historical hints if raw logs are incomplete

### Codex

Primary sources:

- `~/.codex/state_5.sqlite`
- `~/.codex/sessions/**/*.jsonl`

Use:

- exact aggregate rows when present in SQLite
- historical model-name evidence from rollout logs

Current caveat:

- model coverage is partial compared with OpenCode and Claude Code
- older models are presently evidenced more reliably by rollout logs than by exact aggregate cost rows

### OpenCode

Primary source:

- `~/.local/share/opencode/opencode.db`

Observed fields:

- provider id
- model id
- session id
- timestamps
- token totals
- exact cost for some providers and models

This is the strongest local source for normalized provider-model usage.

## Normalization

Local sources use different identifiers for the same effective model. The ingestion layer must normalize these into a consistent internal shape.

Normalized fields:

- source
- provider
- model
- day
- exact logged cost if present
- estimated cost if exact cost is absent
- pricing mode: `exact`, `estimated`, or `unpriced`
- stable dedupe key

Examples of likely normalization work:

- `claude-opus-4-6` vs `claude-opus-4.6`
- provider-specific wrappers such as `github-copilot`, `vercel`, and `opencode`
- Codex historical variants such as `gpt-5.4`, `gpt-5.3-codex`, and `gpt-5.2-codex`

## Pricing Strategy

Historical pricing is frozen at sync time.

Rules:

- If local logs include exact USD cost, store and use that value
- If local logs do not include exact cost, resolve pricing from `models.dev`
- Persist the pricing snapshot used for estimation with an effective timestamp
- Never silently recalculate historical totals when upstream pricing changes

This keeps the public chart stable and trustworthy.

## Storage Model

### Internal Ingestion Table

Store normalized imported usage slices to support dedupe and rollup rebuilds.

Required fields:

- dedupe key
- source
- provider
- model
- day
- cost_usd
- pricing_mode
- sync_run_id

Optional internal-only fields:

- source session hash
- token fields needed for fallback pricing
- source timestamps

These fields are not exposed publicly.

### Pricing Snapshot Table

Store frozen fallback pricing records used during estimation.

Fields:

- provider
- model
- input cost
- output cost
- cache read cost
- cache write cost
- source catalog identifier
- fetched_at
- snapshot hash or version marker

### Public Rollup Table

This is the main query surface for the site.

Fields:

- date
- provider
- model
- cost_usd

Derived values such as lifetime total can be computed from this table or from a materialized aggregate query.

## Sync Design

### Manual Sync

Run:

- `bun run sync`

Behavior:

- read local Claude Code, Codex, and OpenCode sources
- normalize provider and model identifiers
- calculate exact or fallback estimated cost
- send only normalized rows to the deployed app

### Auto Sync

Use the same `bun run sync` command under a local timer or cron on the user's machine.

The local machine is the authority for new data. Vercel does not scrape local files.

### Server Ingest Endpoint

Provide a write-only API route on the deployed app.

Requirements:

- protected by a shared secret or request signature
- idempotent by dedupe key
- able to upsert normalized ingestion rows
- rebuild affected daily rollups after successful ingest

The public site remains open, but the write path is private.

## UI Design

The public page stays intentionally sparse.

Layout:

- small heading or identity label on the left
- lifetime total cost on the right
- large chart below

Chart behavior:

- daily vertical stacked bars
- each stack segment corresponds to one provider-model pair
- hover tooltip shows date, daily total, and provider-model cost rows
- consistent color assignment for each provider-model pair
- minimal axes and chrome

Implementation notes:

- use shadcn/ui primitives where useful
- use `bun` for dependency and script management
- use a chart library compatible with shadcn patterns, likely Recharts

## Security And Privacy

The public site intentionally exposes only aggregate cost history.

Do not store or expose:

- prompt text
- response text
- repo names
- cwd paths
- usernames
- hostnames
- machine identifiers
- raw opaque provider payloads

The only sensitive surface is the ingest endpoint, which must require a secret.

## Testing Strategy

- Verify source readers against real local files and databases
- Verify normalization for known provider-model aliases
- Verify dedupe on repeated sync runs
- Verify pricing snapshot freeze behavior
- Verify rollup rebuilds for changed days
- Verify homepage queries and tooltip formatting

## Recommended Implementation Order

1. Build normalized source readers for Claude Code, Codex, and OpenCode
2. Build pricing lookup and snapshot persistence using `models.dev`
3. Build ingest endpoint and rollup storage
4. Build `bun run sync` for manual and automatic sync
5. Build the public chart page with shadcn/ui-based structure

## Open Constraints

- Codex local data is less complete than OpenCode and Claude Code, so some model history may remain estimate-only or evidence-only until reader coverage improves
- Some provider-model ids will require hand-maintained alias mappings for reliable pricing lookup

## Decision Record

- Public site only
- Show only cost, providers, and models
- Manual sync and automatic sync both supported
- History preserved over time
- Historical pricing frozen at sync time
- `models.dev` used for fallback pricing lookup
- `bun` used as package manager and runtime
- shadcn/ui used for frontend components
