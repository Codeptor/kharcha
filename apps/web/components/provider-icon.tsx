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

// Modal has no lobehub icon — extracted from https://modal.com/assets/favicon.svg
// (300×300 geometric M, green #62DE61). Single outline path, rendered monochrome
// via currentColor to match other provider marks. Uses 300 viewBox.
const MODAL_LOGO = [
  "M121.683 75.25L149.997 124L91.4816 224.75C90.3128 226.757 88.155 228 85.8174 228H32.9664C31.7976 228 30.6778 227.691 29.697 227.131C28.7161 226.57 27.8906 225.758 27.3021 224.75L0.876625 179.25C-0.292208 177.243 -0.292208 174.765 0.876625 172.75L57.512 75.25C58.0923 74.2425 58.9259 73.43 59.9068 72.8694C60.8876 72.3088 62.0074 72 63.1762 72H116.027C118.365 72 120.523 73.2431 121.692 75.25H121.683ZM299.125 172.75L242.49 75.25C241.91 74.2425 241.076 73.43 240.095 72.8694C239.114 72.3088 237.995 72 236.826 72H183.975C181.637 72 179.479 73.2431 178.311 75.25L149.997 124L208.512 224.75C209.681 226.757 211.839 228 214.177 228H267.027C268.196 228 269.316 227.691 270.297 227.131C271.278 226.57 272.103 225.758 272.692 224.75L299.117 179.25C300.286 177.243 300.286 174.765 299.117 172.75H299.125Z",
]

const ICON_PATHS: Record<string, string[]> = {
  anthropic: extractPaths(claudeSvg),
  claude: extractPaths(claudeSvg),
  "claude-code": extractPaths(claudeCodeSvg),
  agy: extractPaths(geminiSvg),
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
  modal: MODAL_LOGO,
}

const ICON_VIEWBOX: Record<string, string> = {
  modal: "0 0 300 300",
}

function getModelIconName(model: string, provider?: string): string {
  const raw = model.includes(" / ") ? (model.split(" / ").pop() ?? model) : model
  const base = raw.includes("/") ? (raw.split("/").pop() ?? raw) : raw
  const m = base.toLowerCase()
  if (m.startsWith("muse-spark") || m.startsWith("muse-")) return "meta"
  if (m.startsWith("kimi")) return "kimi"
  if (m.startsWith("claude")) return "anthropic"
  if (m.startsWith("gpt") || m.startsWith("codex") || m.startsWith("o1") || m.startsWith("o3")) return "openai"
  if (m.startsWith("gemini") || m.startsWith("gemma")) return "gemini"
  if (m.startsWith("deepseek")) return "deepseek"
  if (m.startsWith("fugu")) return "sakana"
  if (m.startsWith("grok")) return "groq"
  if (provider && ICON_PATHS[provider]) return provider
  return m.split("-")[0] ?? provider ?? "unknown"
}

export function ModelIcon({
  model,
  provider,
  size = 12,
  className,
}: {
  model: string
  provider?: string
  size?: number
  className?: string
}) {
  const name = getModelIconName(model, provider)
  return <ProviderIcon name={name} size={size} className={className} />
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
  const viewBox = ICON_VIEWBOX[name] ?? "0 0 24 24"

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
        viewBox={viewBox}
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
