# Usage Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a public, read-only AI usage dashboard that shows lifetime spend plus a daily historical cost chart with provider/model hover breakdowns, sourced from Claude Code, Codex, and OpenCode on the user's machine.

**Architecture:** A local `bun` sync CLI reads usage from local stores, normalizes provider/model identifiers, applies exact or frozen fallback pricing, and POSTs idempotent batches to a protected Next.js route. The web app stores internal ingestion rows plus daily public rollups in Postgres, and the public homepage renders a minimal stacked bar chart from those rollups using shadcn/ui-compatible chart components.

**Tech Stack:** Bun, TypeScript, Turborepo, Next.js App Router, React 19, Postgres, Drizzle ORM, Zod, shadcn/ui, Recharts.

---

## File Structure

### Workspace and Tooling

- Modify: `package.json`
- Modify: `bun.lock`
- Create: `.env.example`
- Create: `drizzle.config.ts`

### Shared Usage Package

- Create: `packages/usage-core/package.json`
- Create: `packages/usage-core/tsconfig.json`
- Create: `packages/usage-core/src/index.ts`
- Create: `packages/usage-core/src/model-aliases.ts`
- Create: `packages/usage-core/src/types.ts`
- Create: `packages/usage-core/src/pricing/models-dev.ts`
- Create: `packages/usage-core/src/pricing/freeze-pricing.ts`
- Create: `packages/usage-core/src/sources/claude-code.ts`
- Create: `packages/usage-core/src/sources/codex.ts`
- Create: `packages/usage-core/src/sources/opencode.ts`
- Create: `packages/usage-core/src/build-sync-batch.ts`
- Create: `packages/usage-core/test/fixtures/claude-session.jsonl`
- Create: `packages/usage-core/test/fixtures/codex-rollout.jsonl`
- Create: `packages/usage-core/test/fixtures/opencode-message.json`
- Create: `packages/usage-core/test/smoke.test.ts`
- Create: `packages/usage-core/test/model-aliases.test.ts`
- Create: `packages/usage-core/test/pricing.test.ts`
- Create: `packages/usage-core/test/source-readers.test.ts`
- Create: `packages/usage-core/test/build-sync-batch.test.ts`

### Local Sync CLI

- Create: `scripts/sync.ts`

### Web App Data Layer

- Modify: `apps/web/package.json`
- Create: `apps/web/.env.example`
- Create: `apps/web/lib/env.ts`
- Create: `apps/web/lib/db/client.ts`
- Create: `apps/web/lib/db/schema.ts`
- Create: `apps/web/lib/db/ingest.ts`
- Create: `apps/web/lib/dashboard/get-dashboard-data.ts`
- Create: `apps/web/lib/dashboard/chart-shape.ts`
- Create: `apps/web/test/ingest.test.ts`
- Create: `apps/web/test/chart-shape.test.ts`
- Create: `apps/web/app/api/sync/route.ts`
- Create: `apps/web/drizzle/0000_usage_dashboard.sql`

### Web App UI

- Modify: `apps/web/app/page.tsx`
- Modify: `apps/web/app/layout.tsx`
- Create: `apps/web/components/dashboard-header.tsx`
- Create: `apps/web/components/cost-chart.tsx`
- Create: `apps/web/components/day-breakdown-tooltip.tsx`
- Create: `packages/ui/src/components/chart.tsx`
- Create: `packages/ui/src/components/tooltip.tsx`

### Documentation

- Modify: `README.md`

## Task 1: Scaffold Dependencies, Env, and Database Tooling

**Files:**
- Modify: `package.json`
- Modify: `apps/web/package.json`
- Create: `.env.example`
- Create: `apps/web/.env.example`
- Create: `drizzle.config.ts`
- Create: `packages/usage-core/package.json`
- Create: `packages/usage-core/tsconfig.json`
- Create: `packages/usage-core/src/index.ts`
- Create: `packages/usage-core/src/model-aliases.ts`
- Create: `packages/usage-core/test/smoke.test.ts`

- [ ] **Step 1: Write a failing smoke test for the new workspace package**

```ts
// packages/usage-core/test/smoke.test.ts
import { describe, expect, it } from "bun:test"
import { normalizeModelKey } from "../src/model-aliases"

describe("usage-core smoke test", () => {
  it("exports normalizeModelKey", () => {
    expect(typeof normalizeModelKey).toBe("function")
  })
})
```

- [ ] **Step 2: Run the smoke test to verify the package is missing**

Run: `bun test packages/usage-core/test/smoke.test.ts`
Expected: FAIL with `Cannot find module '../src/model-aliases'` or missing package files.

- [ ] **Step 3: Add the workspace package and root/app scripts**

Update `package.json`:

```json
{
  "scripts": {
    "test": "bun test",
    "sync": "bun run scripts/sync.ts",
    "db:generate": "bunx drizzle-kit generate",
    "db:migrate": "bunx drizzle-kit migrate"
  }
}
```

Update `apps/web/package.json` dependencies:

```json
{
  "dependencies": {
    "@workspace/usage-core": "workspace:*",
    "drizzle-orm": "^0.44.0",
    "postgres": "^3.4.7",
    "recharts": "^3.2.1"
  },
  "devDependencies": {
    "drizzle-kit": "^0.31.4"
  }
}
```

Create `packages/usage-core/package.json`:

```json
{
  "name": "@workspace/usage-core",
  "version": "0.0.0",
  "type": "module",
  "private": true,
  "scripts": {
    "typecheck": "tsc --noEmit"
  },
  "exports": {
    ".": "./src/index.ts"
  }
}
```

Create `.env.example`:

```bash
DATABASE_URL=
SYNC_SECRET=
SYNC_URL=http://localhost:3000/api/sync
PUBLIC_SITE_TITLE=Your Name
```

Create `apps/web/.env.example`:

```bash
DATABASE_URL=
SYNC_SECRET=
PUBLIC_SITE_TITLE=Your Name
```

Create `drizzle.config.ts`:

```ts
import { defineConfig } from "drizzle-kit"

export default defineConfig({
  schema: "./apps/web/lib/db/schema.ts",
  out: "./apps/web/drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
})
```

- [ ] **Step 4: Create the minimal package export and stubbed alias helper**

```ts
// packages/usage-core/src/model-aliases.ts
export function normalizeModelKey(provider: string, model: string) {
  return { provider, model }
}
```

```ts
// packages/usage-core/src/index.ts
export { normalizeModelKey } from "./model-aliases"
```

- [ ] **Step 5: Install dependencies and rerun the smoke test**

Run: `bun install`
Expected: dependencies install cleanly.

Run: `bun test packages/usage-core/test/smoke.test.ts`
Expected: PASS for the smoke test after the package scaffold exists.

- [ ] **Step 6: Commit**

```bash
git add package.json bun.lock .env.example apps/web/package.json apps/web/.env.example drizzle.config.ts packages/usage-core
git commit -m "chore: scaffold usage dashboard workspace"
```

## Task 2: Implement Shared Types, Model Aliases, and Frozen Pricing

**Files:**
- Create: `packages/usage-core/src/types.ts`
- Create: `packages/usage-core/src/model-aliases.ts`
- Create: `packages/usage-core/src/pricing/models-dev.ts`
- Create: `packages/usage-core/src/pricing/freeze-pricing.ts`
- Create: `packages/usage-core/test/model-aliases.test.ts`
- Create: `packages/usage-core/test/pricing.test.ts`
- Modify: `packages/usage-core/src/index.ts`

- [ ] **Step 1: Write failing tests for alias normalization**

```ts
import { describe, expect, it } from "bun:test"
import { normalizeModelKey } from "../src/model-aliases"

describe("normalizeModelKey", () => {
  it("normalizes Claude variant punctuation", () => {
    expect(normalizeModelKey("github-copilot", "claude-opus-4.6")).toEqual({
      provider: "anthropic",
      model: "claude-opus-4-6",
    })
  })

  it("keeps explicit OpenAI codex variants intact", () => {
    expect(normalizeModelKey("openai", "gpt-5.3-codex")).toEqual({
      provider: "openai",
      model: "gpt-5.3-codex",
    })
  })
})
```

- [ ] **Step 2: Write failing tests for pricing freeze behavior**

```ts
import { describe, expect, it } from "bun:test"
import { freezePricing } from "../src/pricing/freeze-pricing"

describe("freezePricing", () => {
  it("marks exact logged cost rows as exact", () => {
    const result = freezePricing({
      exactCostUsd: 1.23,
      pricingMatch: null,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    })

    expect(result.pricingMode).toBe("exact")
    expect(result.costUsd).toBe(1.23)
  })
})
```

- [ ] **Step 3: Run the new tests to confirm they fail**

Run: `bun test packages/usage-core/test/model-aliases.test.ts packages/usage-core/test/pricing.test.ts`
Expected: FAIL because the source files do not exist yet.

- [ ] **Step 4: Implement shared types and alias mapping**

```ts
// packages/usage-core/src/types.ts
export type PricingMode = "exact" | "estimated" | "unpriced"

export type NormalizedModelKey = {
  provider: string
  model: string
}

export type UsageSlice = {
  source: "claude-code" | "codex" | "opencode"
  provider: string
  model: string
  startedAt: string | null
  day: string
  inputTokens: number | null
  outputTokens: number | null
  cacheReadTokens: number | null
  cacheWriteTokens: number | null
  exactCostUsd: number | null
  sourceSessionHash: string
}
```

```ts
// packages/usage-core/src/model-aliases.ts
const MODEL_ALIASES: Record<string, NormalizedModelKey> = {
  "github-copilot:claude-opus-4.6": { provider: "anthropic", model: "claude-opus-4-6" },
  "github-copilot:claude-sonnet-4.6": { provider: "anthropic", model: "claude-sonnet-4-6" },
  "vercel:anthropic/claude-sonnet-4.6": { provider: "anthropic", model: "claude-sonnet-4-6" },
}

export function normalizeModelKey(provider: string, model: string): NormalizedModelKey {
  return MODEL_ALIASES[`${provider}:${model}`] ?? {
    provider,
    model: model.replace(".6", "-6"),
  }
}
```

- [ ] **Step 5: Implement pricing lookup and freeze logic**

```ts
// packages/usage-core/src/pricing/models-dev.ts
import { z } from "zod"

const modelsDevSchema = z.array(
  z.object({
    providerId: z.string(),
    modelId: z.string(),
    inputCost: z.number().nullable().optional(),
    outputCost: z.number().nullable().optional(),
    cacheReadCost: z.number().nullable().optional(),
    cacheWriteCost: z.number().nullable().optional(),
  }),
)

export async function fetchModelsDevCatalog() {
  const response = await fetch("https://models.dev/api.json", { headers: { accept: "application/json" } })
  const json = await response.json()
  return modelsDevSchema.parse(json)
}
```

```ts
// packages/usage-core/src/pricing/freeze-pricing.ts
export function freezePricing(input: {
  exactCostUsd: number | null
  pricingMatch: {
    inputCost: number | null
    outputCost: number | null
    cacheReadCost: number | null
    cacheWriteCost: number | null
  } | null
  inputTokens: number | null
  outputTokens: number | null
  cacheReadTokens: number | null
  cacheWriteTokens: number | null
}) {
  if (input.exactCostUsd !== null) {
    return { pricingMode: "exact" as const, costUsd: input.exactCostUsd, snapshot: null }
  }

  if (!input.pricingMatch) {
    return { pricingMode: "unpriced" as const, costUsd: 0, snapshot: null }
  }

  const costUsd =
    ((input.inputTokens ?? 0) / 1_000_000) * (input.pricingMatch.inputCost ?? 0) +
    ((input.outputTokens ?? 0) / 1_000_000) * (input.pricingMatch.outputCost ?? 0) +
    ((input.cacheReadTokens ?? 0) / 1_000_000) * (input.pricingMatch.cacheReadCost ?? 0) +
    ((input.cacheWriteTokens ?? 0) / 1_000_000) * (input.pricingMatch.cacheWriteCost ?? 0)

  return { pricingMode: "estimated" as const, costUsd, snapshot: input.pricingMatch }
}
```

- [ ] **Step 6: Export the new helpers**

```ts
export * from "./types"
export * from "./model-aliases"
export * from "./pricing/models-dev"
export * from "./pricing/freeze-pricing"
```

- [ ] **Step 7: Rerun the tests**

Run: `bun test packages/usage-core/test/model-aliases.test.ts packages/usage-core/test/pricing.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/usage-core
git commit -m "feat: add usage normalization and pricing primitives"
```

## Task 3: Implement Claude Code, Codex, and OpenCode Readers

**Files:**
- Create: `packages/usage-core/src/sources/claude-code.ts`
- Create: `packages/usage-core/src/sources/codex.ts`
- Create: `packages/usage-core/src/sources/opencode.ts`
- Create: `packages/usage-core/test/fixtures/claude-session.jsonl`
- Create: `packages/usage-core/test/fixtures/codex-rollout.jsonl`
- Create: `packages/usage-core/test/fixtures/opencode-message.json`
- Create: `packages/usage-core/test/source-readers.test.ts`
- Modify: `packages/usage-core/src/index.ts`

- [ ] **Step 1: Create sanitized fixtures from the local formats**

Use short, redacted examples that preserve field shapes only:

```json
{"sessionId":"ses_1","message":{"model":"claude-opus-4-6","usage":{"input_tokens":1200,"output_tokens":300,"cache_read_input_tokens":9000}}}
```

```json
{"timestamp":"2026-03-18T23:36:52.698Z","type":"session_meta","payload":{"model_provider":"openai","model":"gpt-5.4"}}
```

```json
{"role":"assistant","providerID":"anthropic","modelID":"claude-opus-4-6","cost":0.42,"tokens":{"input":1000,"output":300,"total":1300}}
```

- [ ] **Step 2: Write failing reader tests against those fixtures**

```ts
import { describe, expect, it } from "bun:test"
import { readClaudeCodeUsage } from "../src/sources/claude-code"
import { readCodexUsage } from "../src/sources/codex"
import { readOpenCodeUsage } from "../src/sources/opencode"

describe("source readers", () => {
  it("reads Claude Code JSONL rows", async () => {
    const rows = await readClaudeCodeUsage("packages/usage-core/test/fixtures/claude-session.jsonl")
    expect(rows[0]?.model).toBe("claude-opus-4-6")
  })

  it("reads Codex rollout metadata", async () => {
    const rows = await readCodexUsage("packages/usage-core/test/fixtures/codex-rollout.jsonl")
    expect(rows[0]?.provider).toBe("openai")
  })

  it("reads OpenCode assistant rows", async () => {
    const rows = await readOpenCodeUsage("packages/usage-core/test/fixtures/opencode-message.json")
    expect(rows[0]?.exactCostUsd).toBe(0.42)
  })
})
```

- [ ] **Step 3: Run the reader tests to verify failure**

Run: `bun test packages/usage-core/test/source-readers.test.ts`
Expected: FAIL because the reader implementations do not exist yet.

- [ ] **Step 4: Implement the Claude Code reader**

```ts
import { readFile } from "node:fs/promises"

export async function readClaudeCodeUsage(path: string): Promise<UsageSlice[]> {
  const text = await readFile(path, "utf8")
  return text
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line))
    .filter((row) => row.message?.model)
    .map((row) => ({
      source: "claude-code",
      provider: "anthropic",
      model: row.message.model,
      startedAt: null,
      day: new Date().toISOString().slice(0, 10),
      inputTokens: row.message.usage?.input_tokens ?? null,
      outputTokens: row.message.usage?.output_tokens ?? null,
      cacheReadTokens: row.message.usage?.cache_read_input_tokens ?? null,
      cacheWriteTokens: row.message.usage?.cache_creation_input_tokens ?? null,
      exactCostUsd: null,
      sourceSessionHash: row.sessionId,
    }))
}
```

- [ ] **Step 5: Implement the Codex and OpenCode readers with the same output shape**

Implementation requirements:
- Codex reader extracts provider/model evidence from JSONL rollout payloads and exact aggregates from SQLite when present
- OpenCode reader extracts provider/model/cost/tokens from `message.data`
- Every reader returns `UsageSlice[]`
- Every reader hashes local session ids before returning rows

- [ ] **Step 6: Export the readers**

```ts
export * from "./sources/claude-code"
export * from "./sources/codex"
export * from "./sources/opencode"
```

- [ ] **Step 7: Rerun the reader tests**

Run: `bun test packages/usage-core/test/source-readers.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/usage-core
git commit -m "feat: add local usage source readers"
```

## Task 4: Build the Sync Batch Generator and CLI

**Files:**
- Create: `packages/usage-core/src/build-sync-batch.ts`
- Create: `packages/usage-core/test/build-sync-batch.test.ts`
- Create: `scripts/sync.ts`
- Modify: `package.json`
- Modify: `packages/usage-core/src/index.ts`

- [ ] **Step 1: Write a failing batch-builder test**

```ts
import { describe, expect, it } from "bun:test"
import { buildSyncBatch } from "../src/build-sync-batch"

describe("buildSyncBatch", () => {
  it("deduplicates rows by source session, provider, model, and day", async () => {
    const batch = await buildSyncBatch(
      [
      {
        source: "opencode",
        provider: "anthropic",
        model: "claude-opus-4-6",
        startedAt: "2026-03-20T10:00:00.000Z",
        day: "2026-03-20",
        inputTokens: 1000,
        outputTokens: 300,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        exactCostUsd: 0.42,
        sourceSessionHash: "abc",
      },
      {
        source: "opencode",
        provider: "anthropic",
        model: "claude-opus-4-6",
        startedAt: "2026-03-20T10:00:00.000Z",
        day: "2026-03-20",
        inputTokens: 1000,
        outputTokens: 300,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        exactCostUsd: 0.42,
        sourceSessionHash: "abc",
      },
    ],
      new Map(),
    )

    expect(batch.rows).toHaveLength(1)
    expect(batch.rows[0]?.costUsd).toBe(0.42)
    expect(batch.rows[0]?.pricingMode).toBe("exact")
  })
})
```

- [ ] **Step 2: Run the batch test to verify failure**

Run: `bun test packages/usage-core/test/build-sync-batch.test.ts`
Expected: FAIL because `buildSyncBatch` does not exist yet.

- [ ] **Step 3: Implement `buildSyncBatch`**

```ts
import { createHash } from "node:crypto"

export async function buildSyncBatch(
  rows: UsageSlice[],
  pricingLookup: Map<string, { inputCost: number | null; outputCost: number | null; cacheReadCost: number | null; cacheWriteCost: number | null }>,
) {
  const pricingSnapshots = new Map<
    string,
    {
      snapshotKey: string
      provider: string
      model: string
      inputCost: number | null
      outputCost: number | null
      cacheReadCost: number | null
      cacheWriteCost: number | null
    }
  >()
  const deduped = new Map<
    string,
    {
      dedupeKey: string
      source: string
      provider: string
      model: string
      day: string
      costUsd: number
      pricingMode: string
      pricingSnapshotKey: string | null
    }
  >()

  for (const row of rows) {
    const normalized = normalizeModelKey(row.provider, row.model)
    const pricing = freezePricing({
      exactCostUsd: row.exactCostUsd,
      pricingMatch: pricingLookup.get(`${normalized.provider}:${normalized.model}`) ?? null,
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      cacheReadTokens: row.cacheReadTokens,
      cacheWriteTokens: row.cacheWriteTokens,
    })
    const dedupeKey = createHash("sha256")
      .update([row.source, row.sourceSessionHash, normalized.provider, normalized.model, row.day].join(":"))
      .digest("hex")
    const pricingSnapshotKey = pricing.snapshot
      ? createHash("sha256")
          .update(
            [
              normalized.provider,
              normalized.model,
              pricing.snapshot.inputCost ?? "",
              pricing.snapshot.outputCost ?? "",
              pricing.snapshot.cacheReadCost ?? "",
              pricing.snapshot.cacheWriteCost ?? "",
            ].join(":"),
          )
          .digest("hex")
      : null

    if (pricingSnapshotKey && pricing.snapshot && !pricingSnapshots.has(pricingSnapshotKey)) {
      pricingSnapshots.set(pricingSnapshotKey, {
        snapshotKey: pricingSnapshotKey,
        provider: normalized.provider,
        model: normalized.model,
        inputCost: pricing.snapshot.inputCost ?? null,
        outputCost: pricing.snapshot.outputCost ?? null,
        cacheReadCost: pricing.snapshot.cacheReadCost ?? null,
        cacheWriteCost: pricing.snapshot.cacheWriteCost ?? null,
      })
    }

    if (!deduped.has(dedupeKey)) {
      deduped.set(dedupeKey, {
        dedupeKey,
        source: row.source,
        provider: normalized.provider,
        model: normalized.model,
        day: row.day,
        costUsd: pricing.costUsd,
        pricingMode: pricing.pricingMode,
        pricingSnapshotKey,
      })
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    pricingSnapshots: [...pricingSnapshots.values()],
    rows: [...deduped.values()],
  }
}
```

- [ ] **Step 4: Implement the local CLI with `--dry-run` and `--source` filters**

```ts
// scripts/sync.ts
import {
  buildSyncBatch,
  fetchModelsDevCatalog,
  readClaudeCodeUsage,
  readCodexUsage,
  readOpenCodeUsage,
} from "@workspace/usage-core"

const dryRun = process.argv.includes("--dry-run")

async function main() {
  const rows = [
    ...(await readClaudeCodeUsage(process.env.HOME + "/.claude/projects")),
    ...(await readCodexUsage(process.env.HOME + "/.codex")),
    ...(await readOpenCodeUsage(process.env.HOME + "/.local/share/opencode/opencode.db")),
  ]

  const catalog = await fetchModelsDevCatalog()
  const pricingLookup = new Map(
    catalog.map((entry) => [
      `${entry.providerId}:${entry.modelId}`,
      {
        inputCost: entry.inputCost ?? null,
        outputCost: entry.outputCost ?? null,
        cacheReadCost: entry.cacheReadCost ?? null,
        cacheWriteCost: entry.cacheWriteCost ?? null,
      },
    ]),
  )

  const batch = await buildSyncBatch(rows, pricingLookup)

  if (dryRun) {
    console.log(JSON.stringify(batch, null, 2))
    return
  }

  await fetch(process.env.SYNC_URL!, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${process.env.SYNC_SECRET}`,
    },
    body: JSON.stringify(batch),
  })
}

await main()
```

- [ ] **Step 5: Rerun the tests and dry-run the CLI**

Run: `bun test packages/usage-core/test/build-sync-batch.test.ts`
Expected: PASS.

Run: `bun run sync --dry-run`
Expected: JSON output with normalized `rows`, no network call, no prompt or path leakage in the payload, estimated rows include `pricingSnapshotKey`, and the batch includes a `pricingSnapshots` array.

- [ ] **Step 6: Commit**

```bash
git add package.json packages/usage-core scripts/sync.ts
git commit -m "feat: add sync batch builder and local cli"
```

## Task 5: Add Postgres Schema, Ingest Logic, and the Protected Sync Route

**Files:**
- Create: `apps/web/lib/env.ts`
- Create: `apps/web/lib/db/client.ts`
- Create: `apps/web/lib/db/schema.ts`
- Create: `apps/web/lib/db/ingest.ts`
- Create: `apps/web/app/api/sync/route.ts`
- Create: `apps/web/drizzle/0000_usage_dashboard.sql`
- Create: `apps/web/test/ingest.test.ts`

- [ ] **Step 1: Write a failing pure test for daily rollup shaping**

```ts
import { describe, expect, it } from "bun:test"
import { rollupRowsByDay } from "../lib/db/ingest"

describe("rollupRowsByDay", () => {
  it("groups costs by day, provider, and model", () => {
    const rows = [
      { day: "2026-03-20", provider: "anthropic", model: "claude-opus-4-6", costUsd: 1.2 },
      { day: "2026-03-20", provider: "anthropic", model: "claude-opus-4-6", costUsd: 0.3 },
    ]

    expect(rollupRowsByDay(rows)).toEqual([
      { day: "2026-03-20", provider: "anthropic", model: "claude-opus-4-6", costUsd: 1.5 },
    ])
  })
})
```

- [ ] **Step 2: Run the test to confirm the ingest module is missing**

Run: `bun test apps/web/test/ingest.test.ts`
Expected: FAIL because `apps/web/lib/db/ingest.ts` does not exist yet.

- [ ] **Step 3: Define env parsing and the Drizzle schema**

```ts
// apps/web/lib/env.ts
import { z } from "zod"

export const env = z
  .object({
    DATABASE_URL: z.string().min(1),
    SYNC_SECRET: z.string().min(1),
    PUBLIC_SITE_TITLE: z.string().default("Your Name"),
  })
  .parse(process.env)
```

```ts
// apps/web/lib/db/schema.ts
import { numeric, pgTable, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core"

export const usageRows = pgTable(
  "usage_rows",
  {
    dedupeKey: varchar("dedupe_key", { length: 64 }).primaryKey(),
    source: text("source").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    day: text("day").notNull(),
    costUsd: numeric("cost_usd", { precision: 12, scale: 4 }).notNull(),
    pricingMode: text("pricing_mode").notNull(),
    pricingSnapshotKey: text("pricing_snapshot_key"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    dayProviderModelIdx: uniqueIndex("usage_rows_dedupe_idx").on(table.dedupeKey),
  }),
)

export const pricingSnapshots = pgTable(
  "pricing_snapshots",
  {
    snapshotKey: text("snapshot_key").primaryKey(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    inputCost: numeric("input_cost", { precision: 12, scale: 4 }),
    outputCost: numeric("output_cost", { precision: 12, scale: 4 }),
    cacheReadCost: numeric("cache_read_cost", { precision: 12, scale: 4 }),
    cacheWriteCost: numeric("cache_write_cost", { precision: 12, scale: 4 }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
)

export const dailyRollups = pgTable(
  "daily_rollups",
  {
    day: text("day").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    costUsd: numeric("cost_usd", { precision: 12, scale: 4 }).notNull(),
  },
  (table) => ({
    uniqueDayProviderModel: uniqueIndex("daily_rollups_day_provider_model_idx").on(table.day, table.provider, table.model),
  }),
)
```

- [ ] **Step 4: Implement the DB client, ingest helpers, and route protection**

```ts
// apps/web/lib/db/client.ts
import postgres from "postgres"
import { drizzle } from "drizzle-orm/postgres-js"
import { env } from "../env"

const client = postgres(env.DATABASE_URL, { prepare: false })
export const db = drizzle(client)
```

```ts
// apps/web/app/api/sync/route.ts
import { NextRequest, NextResponse } from "next/server"
import { env } from "@/lib/env"
import { ingestSyncBatch } from "@/lib/db/ingest"

export async function POST(request: NextRequest) {
  const auth = request.headers.get("authorization")
  if (auth !== `Bearer ${env.SYNC_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }

  const body = await request.json()
  const result = await ingestSyncBatch(body)
  return NextResponse.json(result)
}
```

Implementation requirements for `apps/web/lib/db/ingest.ts`:
- validate the incoming batch shape with Zod
- upsert `pricing_snapshots` before inserting `usage_rows`
- upsert `usage_rows` by `dedupe_key`
- rebuild `daily_rollups` only for affected days
- return counts for inserted rows, skipped rows, and touched days

- [ ] **Step 5: Generate and check in the first migration**

Run: `bun run db:generate`
Expected: `apps/web/drizzle/0000_usage_dashboard.sql` created.

Run: `bun run db:migrate`
Expected: migration applies cleanly to the configured Postgres database.

- [ ] **Step 6: Rerun the rollup test**

Run: `bun test apps/web/test/ingest.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/lib apps/web/app/api/sync apps/web/drizzle drizzle.config.ts apps/web/.env.example
git commit -m "feat: add sync ingest route and database schema"
```

## Task 6: Build Public Dashboard Queries and Chart Data Shaping

**Files:**
- Create: `apps/web/lib/dashboard/get-dashboard-data.ts`
- Create: `apps/web/lib/dashboard/chart-shape.ts`
- Create: `apps/web/test/chart-shape.test.ts`

- [ ] **Step 1: Write a failing chart-shape test**

```ts
import { describe, expect, it } from "bun:test"
import { buildChartData } from "../lib/dashboard/chart-shape"

describe("buildChartData", () => {
  it("returns sorted daily rows plus lifetime total", () => {
    const result = buildChartData([
      { day: "2026-03-20", provider: "anthropic", model: "claude-opus-4-6", costUsd: "1.50" },
      { day: "2026-03-20", provider: "google", model: "gemini-3.1-pro-preview-customtools", costUsd: "2.00" },
    ])

    expect(result.lifetimeTotalUsd).toBe(3.5)
    expect(result.days[0]?.segments).toHaveLength(2)
  })
})
```

- [ ] **Step 2: Run the test to verify failure**

Run: `bun test apps/web/test/chart-shape.test.ts`
Expected: FAIL because the dashboard query helpers do not exist.

- [ ] **Step 3: Implement the chart-shaping helper**

```ts
export function buildChartData(rows: Array<{ day: string; provider: string; model: string; costUsd: string }>) {
  const grouped = new Map<string, { day: string; total: number; segments: Array<{ key: string; label: string; costUsd: number }> }>()

  for (const row of rows) {
    const cost = Number(row.costUsd)
    const entry =
      grouped.get(row.day) ??
      { day: row.day, total: 0, segments: [] }

    entry.total += cost
    entry.segments.push({
      key: `${row.provider}:${row.model}`,
      label: `${row.provider} / ${row.model}`,
      costUsd: cost,
    })

    grouped.set(row.day, entry)
  }

  const days = [...grouped.values()].sort((a, b) => a.day.localeCompare(b.day))
  const lifetimeTotalUsd = days.reduce((sum, day) => sum + day.total, 0)
  return { days, lifetimeTotalUsd }
}
```

- [ ] **Step 4: Implement the DB query wrapper**

```ts
// apps/web/lib/dashboard/get-dashboard-data.ts
import { asc } from "drizzle-orm"
import { db } from "@/lib/db/client"
import { dailyRollups } from "@/lib/db/schema"
import { buildChartData } from "./chart-shape"

export async function getDashboardData() {
  const rows = await db.select().from(dailyRollups).orderBy(asc(dailyRollups.day), asc(dailyRollups.provider), asc(dailyRollups.model))
  return buildChartData(rows)
}
```

- [ ] **Step 5: Rerun the test**

Run: `bun test apps/web/test/chart-shape.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/dashboard apps/web/test/chart-shape.test.ts
git commit -m "feat: add public dashboard data queries"
```

## Task 7: Add shadcn/ui Chart Primitives and Build the Public Page

**Files:**
- Create: `packages/ui/src/components/chart.tsx`
- Create: `packages/ui/src/components/tooltip.tsx`
- Create: `apps/web/components/dashboard-header.tsx`
- Create: `apps/web/components/cost-chart.tsx`
- Create: `apps/web/components/day-breakdown-tooltip.tsx`
- Modify: `apps/web/app/page.tsx`
- Modify: `apps/web/app/layout.tsx`

- [ ] **Step 1: Add the shadcn chart primitives**

Run:

```bash
cd packages/ui
bunx --bun shadcn@latest add chart tooltip
```

Expected: shadcn creates the base chart and tooltip components inside `packages/ui/src/components`.

- [ ] **Step 2: Write a minimal component contract before implementation**

```ts
// apps/web/components/cost-chart.tsx
type CostChartProps = {
  days: Array<{
    day: string
    total: number
    segments: Array<{ key: string; label: string; costUsd: number }>
  }>
}
```

- [ ] **Step 3: Implement the sparse public header**

```tsx
// apps/web/components/dashboard-header.tsx
export function DashboardHeader({ title, lifetimeTotalUsd }: { title: string; lifetimeTotalUsd: number }) {
  return (
    <header className="flex items-start justify-between gap-6">
      <div>
        <h1 className="text-sm font-medium tracking-tight">{title}</h1>
      </div>
      <div className="text-right">
        <p className="text-xs text-muted-foreground">Total spend</p>
        <p className="text-xl font-medium tabular-nums">${lifetimeTotalUsd.toFixed(2)}</p>
      </div>
    </header>
  )
}
```

- [ ] **Step 4: Implement the chart and hover tooltip**

Implementation requirements:
- render one stacked bar per day
- use a stable color map derived from `provider:model`
- show date, day total, and flat provider/model rows in the tooltip
- do not show tokens, sessions, filters, tables, or extra analytics

```tsx
// apps/web/components/day-breakdown-tooltip.tsx
export function DayBreakdownTooltip({ day, total, segments }: { day: string; total: number; segments: Array<{ label: string; costUsd: number }> }) {
  return (
    <div className="min-w-64 space-y-3 rounded-xl border bg-background/95 p-3 shadow-lg">
      <div className="flex items-baseline justify-between gap-4">
        <p className="text-sm font-medium">{day}</p>
        <p className="text-sm tabular-nums">${total.toFixed(2)}</p>
      </div>
      <div className="space-y-1 text-sm">
        {segments.map((segment) => (
          <div key={segment.label} className="flex items-center justify-between gap-4">
            <span className="text-muted-foreground">{segment.label}</span>
            <span className="tabular-nums">${segment.costUsd.toFixed(2)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Replace the starter page with the real server-rendered dashboard**

```tsx
// apps/web/app/page.tsx
import { DashboardHeader } from "@/components/dashboard-header"
import { CostChart } from "@/components/cost-chart"
import { getDashboardData } from "@/lib/dashboard/get-dashboard-data"
import { env } from "@/lib/env"

export default async function Page() {
  const data = await getDashboardData()

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-6xl flex-col gap-10 px-6 py-8">
      <DashboardHeader title={env.PUBLIC_SITE_TITLE} lifetimeTotalUsd={data.lifetimeTotalUsd} />
      <CostChart days={data.days} />
    </main>
  )
}
```

- [ ] **Step 6: Run the app checks**

Run: `bun run typecheck`
Expected: PASS.

Run: `bun run lint`
Expected: PASS.

Run: `bun run build`
Expected: all commands pass and the build completes with the public page.

- [ ] **Step 7: Commit**

```bash
git add apps/web/app apps/web/components packages/ui/src/components
git commit -m "feat: build public usage dashboard ui"
```

## Task 8: Verify Sync End-to-End and Document Deployment

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Document local sync usage and Vercel env requirements**

Add a short section to `README.md` covering:
- `bun install`
- `bun run db:migrate`
- `bun run sync --dry-run`
- `bun run sync`
- required env vars for local and Vercel

- [ ] **Step 2: Run a local dry sync against the real machine data**

Run: `bun run sync --dry-run > /tmp/kharcha-sync.json`
Expected: a payload with normalized `provider`, `model`, `day`, `costUsd`, and `pricingMode` fields only, without prompt text or local paths.

- [ ] **Step 3: Run one real sync against the protected route**

Run: `bun run sync`
Expected: 200 response from `/api/sync`, inserted or upserted rows, and refreshed `daily_rollups`.

- [ ] **Step 4: Verify the homepage with seeded data**

Run: `bun run dev`
Expected: the page shows a lifetime total and a daily bar chart; hovering a bar reveals date plus provider/model cost rows only.

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs: add usage dashboard setup and sync instructions"
```

## Review Checklist

- Source readers never emit prompt text or filesystem paths
- Alias normalization keeps provider/model colors stable over time
- Exact logged costs win over fallback pricing
- Estimated rows persist frozen pricing context
- Ingest route is private even though the site is public
- Public page only shows cost, providers, and models
- `bun run sync --dry-run` is safe to use on the real machine

## Execution Notes

- Prefer implementing tasks in order
- Do not skip the fixture sanitization step
- Keep the public UI visually sparse; do not add filters, cards, auth, or secondary dashboards
- If Codex exact cost remains unavailable, ship token-derived estimates rather than blocking the rest of the pipeline
