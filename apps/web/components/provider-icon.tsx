import claudeSvg from "@lobehub/icons-static-svg/icons/claude.svg?raw"
import claudeCodeSvg from "@lobehub/icons-static-svg/icons/claudecode.svg?raw"
import codexSvg from "@lobehub/icons-static-svg/icons/codex.svg?raw"
import openaiSvg from "@lobehub/icons-static-svg/icons/openai.svg?raw"
import geminiSvg from "@lobehub/icons-static-svg/icons/gemini.svg?raw"
import groqSvg from "@lobehub/icons-static-svg/icons/groq.svg?raw"
import kimiSvg from "@lobehub/icons-static-svg/icons/kimi.svg?raw"
import moonshotSvg from "@lobehub/icons-static-svg/icons/moonshot.svg?raw"
import opencodeSvg from "@lobehub/icons-static-svg/icons/opencode.svg?raw"
import githubcopilotSvg from "@lobehub/icons-static-svg/icons/githubcopilot.svg?raw"
import nvidiaSvg from "@lobehub/icons-static-svg/icons/nvidia.svg?raw"
import metaSvg from "@lobehub/icons-static-svg/icons/meta.svg?raw"
import deepseekSvg from "@lobehub/icons-static-svg/icons/deepseek.svg?raw"

function extractPaths(svg: string): string[] {
  const matches = svg.matchAll(/\sd="([^"]+)"/g)
  return [...matches].map((m) => m[1]!)
}

// Sakana ("fish") has no lobehub icon — a simple fish (body + forked tail), legible
// down to ~11px where provider marks render. Used for the codex-fugu / Fugu Ultra model.
const SAKANA_FISH = [
  "M3 12a7.5 5 0 1 0 15 0a7.5 5 0 1 0-15 0Z",
  "M15 12 22 8 19.5 12 22 16Z",
]

const ICON_PATHS: Record<string, string[]> = {
  anthropic: extractPaths(claudeSvg),
  claude: extractPaths(claudeSvg),
  "claude-code": extractPaths(claudeCodeSvg),
  codex: extractPaths(codexSvg),
  openai: extractPaths(openaiSvg),
  google: extractPaths(geminiSvg),
  gemini: extractPaths(geminiSvg),
  groq: extractPaths(groqSvg),
  kimi: extractPaths(kimiSvg),
  moonshot: extractPaths(moonshotSvg),
  moonshotai: extractPaths(moonshotSvg),
  "kimi-for-coding": extractPaths(kimiSvg),
  "github-copilot": extractPaths(githubcopilotSvg),
  opencode: extractPaths(opencodeSvg),
  nvidia: extractPaths(nvidiaSvg),
  meta: extractPaths(metaSvg),
  deepseek: extractPaths(deepseekSvg),
  sakana: SAKANA_FISH,
  fugu: SAKANA_FISH,
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
  const paths = ICON_PATHS[name]

  if (!paths || paths.length === 0) {
    return (
      <span
        className={`inline-flex shrink-0 items-center justify-center rounded-sm bg-stone-300 font-mono text-[8px] font-bold text-stone-600 dark:bg-stone-700 dark:text-stone-400 ${className ?? ""}`}
        style={{ width: size, height: size }}
      >
        {name.charAt(0).toUpperCase()}
      </span>
    )
  }

  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center opacity-60 ${className ?? ""}`}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="currentColor"
        aria-hidden="true"
      >
        {paths.map((d, i) => (
          <path key={i} d={d} />
        ))}
      </svg>
    </span>
  )
}
