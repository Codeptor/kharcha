import {
  Anthropic,
  Claude,
  ClaudeCode,
  Codex,
  Gemini,
  Google,
  Groq,
  Kimi,
  Moonshot,
  OpenAI,
  OpenCode,
} from "@lobehub/icons"

const ICON_MAP: Record<string, React.ComponentType<{ size?: number }>> = {
  anthropic: Claude,
  claude: Claude,
  "claude-code": ClaudeCode,
  codex: Codex,
  openai: OpenAI,
  google: Gemini,
  gemini: Gemini,
  groq: Groq,
  kimi: Kimi,
  moonshot: Moonshot,
  moonshotai: Moonshot,
  "kimi-for-coding": Kimi,
  "github-copilot": Claude,
  opencode: OpenCode,
}

export function ProviderIcon({
  name,
  size = 14,
  className,
}: {
  name: string
  size?: number
  className?: string
}) {
  const Icon = ICON_MAP[name]

  if (!Icon) {
    return (
      <span
        className={`inline-flex items-center justify-center rounded-sm bg-stone-300 font-mono text-[8px] font-bold text-stone-600 dark:bg-stone-700 dark:text-stone-400 ${className ?? ""}`}
        style={{ width: size, height: size }}
      >
        {name.charAt(0).toUpperCase()}
      </span>
    )
  }

  return (
    <span className={`inline-flex shrink-0 items-center justify-center opacity-60 ${className ?? ""}`}>
      <Icon size={size} />
    </span>
  )
}
