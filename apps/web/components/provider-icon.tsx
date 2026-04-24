const LABEL_MAP: Record<string, string> = {
  anthropic: "A",
  claude: "C",
  "claude-code": "CC",
  codex: "CX",
  openai: "O",
  google: "G",
  gemini: "G",
  groq: "GR",
  kimi: "K",
  moonshot: "M",
  moonshotai: "M",
  "kimi-for-coding": "K",
  "github-copilot": "GH",
  opencode: "OC",
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
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-sm bg-stone-300 font-mono font-bold text-stone-600 opacity-70 dark:bg-stone-700 dark:text-stone-300 ${className ?? ""}`}
      style={{
        width: size,
        height: size,
        fontSize: Math.max(6, Math.floor(size * 0.46)),
        lineHeight: 1,
      }}
    >
      {LABEL_MAP[name] ?? name.charAt(0).toUpperCase()}
    </span>
  )
}
