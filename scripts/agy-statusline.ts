import { createHash } from "node:crypto"
import {
  appendFile,
  mkdir,
  readFile,
  rename,
  writeFile,
} from "node:fs/promises"
import { join } from "node:path"

type AgyStatusPayload = {
  agent_state?: string
  conversation_id?: string
  context_window?: {
    current_usage?: {
      cache_creation_input_tokens?: number
      cache_read_input_tokens?: number
      input_tokens?: number
      output_tokens?: number
    }
    total_input_tokens?: number
    total_output_tokens?: number
  }
  model?: {
    id?: string
  }
}

type ConversationState = {
  active: boolean
  lastUsageSignature: string | null
}

type TrackerState = Record<string, ConversationState>

const ACTIVE_AGENT_STATES = new Set(["thinking", "working", "tool_use"])

function tokenCount(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : null
}

function eventFingerprint(
  payload: AgyStatusPayload,
  modelId: string,
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens: number,
  cacheCreationInputTokens: number
): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        conversationId: payload.conversation_id,
        modelId,
        totalInputTokens: payload.context_window?.total_input_tokens ?? null,
        totalOutputTokens: payload.context_window?.total_output_tokens ?? null,
        inputTokens,
        outputTokens,
        cacheReadTokens,
        cacheCreationInputTokens,
      })
    )
    .digest("hex")
}

function usageSignature(
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens: number,
  cacheCreationInputTokens: number
): string {
  return JSON.stringify([
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheCreationInputTokens,
  ])
}

async function readState(statePath: string): Promise<TrackerState> {
  try {
    const parsed = JSON.parse(await readFile(statePath, "utf8")) as unknown
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return {}

    const state: TrackerState = {}
    for (const [key, value] of Object.entries(parsed)) {
      if (!value || typeof value !== "object" || Array.isArray(value)) continue
      const entry = value as Record<string, unknown>
      const lastUsageSignature = entry.lastUsageSignature
      if (typeof entry.active !== "boolean") continue
      if (typeof lastUsageSignature === "string") {
        state[key] = {
          active: entry.active,
          lastUsageSignature,
        }
      } else if (lastUsageSignature === null) {
        state[key] = {
          active: entry.active,
          lastUsageSignature: null,
        }
      }
    }
    return state
  } catch {
    return {}
  }
}

async function writeState(statePath: string, state: TrackerState) {
  const temporaryStatePath = `${statePath}.tmp`
  await writeFile(temporaryStatePath, JSON.stringify(state))
  await rename(temporaryStatePath, statePath)
}

async function main() {
  const input = await Bun.stdin.text()
  let payload: AgyStatusPayload
  try {
    payload = JSON.parse(input) as AgyStatusPayload
  } catch {
    return
  }

  const conversationId = payload.conversation_id
  const modelId = payload.model?.id
  const usage = payload.context_window?.current_usage
  const inputTokens = tokenCount(usage?.input_tokens)
  const outputTokens = tokenCount(usage?.output_tokens)
  const cacheReadTokens = tokenCount(usage?.cache_read_input_tokens) ?? 0
  const cacheCreationInputTokens =
    tokenCount(usage?.cache_creation_input_tokens) ?? 0

  if (!conversationId || !modelId) return

  const root =
    process.env.AGY_USAGE_DIR ??
    join(process.env.HOME ?? "", ".gemini/antigravity-cli")
  const ledgerPath = join(root, "kharcha-usage.jsonl")
  const statePath = join(root, "kharcha-usage-state.json")
  const stateKey = `${conversationId}:${modelId}`

  await mkdir(root, { recursive: true })
  const state = await readState(statePath)
  const entry = state[stateKey] ?? {
    active: false,
    lastUsageSignature: null,
  }
  const active = ACTIVE_AGENT_STATES.has(payload.agent_state ?? "")
  const hasUsage =
    inputTokens !== null &&
    outputTokens !== null &&
    inputTokens + outputTokens + cacheReadTokens + cacheCreationInputTokens > 0
  const signature = hasUsage
    ? usageSignature(
        inputTokens,
        outputTokens,
        cacheReadTokens,
        cacheCreationInputTokens
      )
    : null

  if (entry.active && signature && signature !== entry.lastUsageSignature) {
    const event = {
      at: new Date().toISOString(),
      cacheCreationInputTokens,
      cacheReadTokens,
      eventId: eventFingerprint(
        payload,
        modelId,
        inputTokens!,
        outputTokens!,
        cacheReadTokens,
        cacheCreationInputTokens
      ),
      inputTokens,
      modelId,
      outputTokens,
      version: 2,
    }
    await appendFile(ledgerPath, `${JSON.stringify(event)}\n`)
  }

  state[stateKey] = {
    active,
    lastUsageSignature: signature,
  }
  await writeState(statePath, state)
}

await main()
