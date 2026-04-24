# Kharcha

Public AI usage dashboard for Claude Code, Codex, OpenCode, and Kimi.

## Setup

```bash
bun install
```

Copy the example env files and fill them in:

```bash
cp .env.example .env
cp apps/web/.env.example apps/web/.env
```

Required env vars:

- `DATABASE_URL`
- `SYNC_SECRET`
- `SYNC_URL` at the repo root
- `PUBLIC_SITE_TITLE`

## Database

Run migrations after `DATABASE_URL` is set:

```bash
bun run db:migrate
```

## Sync

Dry-run the local usage import without writing to the server:

```bash
bun run sync --dry-run
```

Push a real sync batch to the deployed API:

```bash
bun run sync
```

The local sync script reads usage data from your machine, normalizes provider and model names, and posts the batch to `SYNC_URL` with `SYNC_SECRET`.

## Dashboard

The public page is server-rendered by Astro and read-only. The protected write path is `POST /api/sync`, and it requires a valid `SYNC_SECRET` bearer token.

## Vercel

The Astro app uses the official Vercel adapter for SSR. Set the same production env vars in Vercel:

- `DATABASE_URL`
- `SYNC_SECRET`
- `PUBLIC_SITE_TITLE`
- `SYNC_URL`

If you change the deployed API route, update `SYNC_URL` to match the new endpoint.
