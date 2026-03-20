# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Kharcha — a public AI usage dashboard that aggregates Claude Code, Codex, and OpenCode spend into a read-only Next.js site. A local Bun script reads usage data from the machine, normalizes models/pricing, and POSTs batches to a protected sync endpoint. The dashboard is server-rendered, force-dynamic, no auth on the read side.

## Commands

```bash
bun install                  # install deps
bun run dev                  # turbo dev (all apps/packages)
bun run build                # turbo build
bun run lint                 # turbo lint
bun run typecheck            # turbo typecheck
bun run test                 # bun test (all packages)
bun run format               # turbo format (prettier)

bun run db:generate          # drizzle-kit generate (migration SQL)
bun run db:migrate           # drizzle-kit migrate (apply to DATABASE_URL)

bun run sync --dry-run       # local usage import, prints JSON without HTTP
bun run sync                 # POST batch to SYNC_URL with SYNC_SECRET
```

Single-package test: `cd packages/usage-core && bun test` or `cd apps/web && bun test`.

## Monorepo Layout

```
apps/web/          Next.js 16 App Router — dashboard UI + POST /api/sync endpoint
packages/ui/       Shared shadcn/ui components (Tailwind v4, radix-vega style, HugeIcons)
packages/usage-core/  Source readers, model aliasing, pricing freeze, sync batch builder
packages/eslint-config/  Shared ESLint flat configs
packages/typescript-config/  Shared tsconfig bases
scripts/sync.ts    CLI entry: reads local usage → fetches pricing → POSTs batch
```

## Architecture & Data Flow

```
~/.claude/projects/**/*.jsonl  ─┐
~/.codex/ (SQLite + JSONL)     ─┼─→ usage-core source readers
~/.local/share/opencode/       ─┘         │
                                    normalizeModelKey()
                                          │
                                    models.dev API → freezePricing()
                                          │
                                    buildSyncBatch() (deduped by SHA256 key)
                                          │
                                    POST /api/sync (Bearer SYNC_SECRET)
                                          │
                                    Drizzle tx: upsert pricing_snapshots
                                              → upsert usage_rows
                                              → rebuild daily_rollups (affected days only)
                                          │
                                    GET / → getDashboardData() → CostChart (Recharts)
```

## Database (PostgreSQL / Drizzle ORM)

Schema: `apps/web/lib/db/schema.ts`. Migrations: `apps/web/drizzle/`. Config: `drizzle.config.ts` (root).

Three tables:
- **usage_rows** — deduplicated ingestion log, PK is `dedupe_key` (SHA256 of source:session:provider:model:day)
- **pricing_snapshots** — frozen per-model pricing at ingest time, PK is `snapshotKey`
- **daily_rollups** — materialized aggregates (day × provider × model), rebuilt on each sync for affected days

## Key Patterns

- **Idempotent sync**: `dedupe_key` prevents duplicate rows across repeated syncs.
- **Pricing modes**: exact (logged cost) > estimated (token counts × frozen pricing) > unpriced (zero).
- **Model aliasing**: `normalizeModelKey()` in `usage-core/src/model-aliases.ts` harmonizes provider/model strings across sources (e.g. `github-copilot:claude-opus-4.6` → `anthropic:claude-opus-4-6`).
- **Privacy**: No prompts, paths, usernames, or machine identifiers leave the local CLI.
- **Force-dynamic**: Dashboard page always fetches fresh data (no ISR/SSG).

## Environment Variables

Required in both root `.env` and `apps/web/.env` (see `.env.example` files):
- `DATABASE_URL` — Postgres connection string
- `SYNC_SECRET` — Bearer token for POST /api/sync
- `SYNC_URL` — Full URL to sync endpoint (root only, used by `scripts/sync.ts`)
- `PUBLIC_SITE_TITLE` — Display name on the dashboard

All four are declared in `turbo.json` globalEnv.

## Stack

- **Runtime**: Bun (dev/scripts), Node (Next.js prod)
- **Framework**: Next.js 16 App Router, React 19, Turbopack
- **Styling**: Tailwind CSS v4, shadcn/ui (radix-vega), Geist fonts, HugeIcons
- **ORM**: Drizzle + `postgres` driver
- **Build**: Turborepo
- **Testing**: Bun test runner, fixtures in `packages/usage-core/test/fixtures/`

## Conventions

- Workspace imports use `@workspace/ui` and `@workspace/usage-core` (not relative paths between packages).
- Web app internal imports use `@/*` alias.
- shadcn/ui components go in `packages/ui/src/components/`, app-specific components in `apps/web/components/`.
- Prettier with tailwindcss plugin; formatting enforced via `bun run format`.
- ESLint flat config per package, extending shared bases from `packages/eslint-config/`.
