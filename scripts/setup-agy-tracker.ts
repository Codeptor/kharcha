import { readFile, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"

type AgySettings = Record<string, unknown>

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}

async function readSettings(path: string): Promise<AgySettings> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as unknown
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as AgySettings
    }
  } catch {
    // A missing settings file is created below; malformed settings must not be overwritten.
    const exists = await Bun.file(path).exists()
    if (exists) throw new Error(`cannot read valid JSON from ${path}`)
  }

  return {}
}

async function main() {
  const agyDirectory = join(process.env.HOME ?? "", ".gemini/antigravity-cli")
  const settingsPath = join(agyDirectory, "settings.json")
  const settings = await readSettings(settingsPath)
  const trackerPath = resolve(import.meta.dir, "agy-statusline.ts")
  const trackerCommand = `${shellQuote(process.execPath)} ${shellQuote(trackerPath)}`
  const existingStatusLine = settings.statusLine
  if (
    existingStatusLine &&
    typeof existingStatusLine === "object" &&
    !Array.isArray(existingStatusLine) &&
    (existingStatusLine as Record<string, unknown>).command !== trackerCommand
  ) {
    throw new Error(
      "AGY already has a custom status line. Keep it intact and configure the tracker command manually."
    )
  }

  settings.statusLine = {
    command: trackerCommand,
    stack_with_default: true,
    type: "command",
  }

  await Bun.write(settingsPath, `${JSON.stringify(settings, null, 2)}\n`)
  console.log(`AGY token tracker installed: ${settingsPath}`)
}

await main()
