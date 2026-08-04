import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

interface UserSettings {
  env?: Record<string, unknown>
}

export function getUserSettingsPath(): string {
  const configDir = process.env.CLAUDE_CONFIG_DIR?.trim()
  return join(configDir || join(homedir(), '.claude'), 'settings.json')
}

function readUserSettings(): { path: string; settings: UserSettings } {
  const path = getUserSettingsPath()
  if (!existsSync(path)) {
    throw new Error(`User settings file ${path} does not exist.`)
  }

  let settings: UserSettings
  try {
    settings = JSON.parse(readFileSync(path, 'utf8')) as UserSettings
  } catch (error) {
    throw new Error(`Cannot read user settings file ${path}: ${error}`)
  }
  return { path, settings }
}

export function getUserSettingsEnvValue(name: string): string | undefined {
  const { settings } = readUserSettings()
  const value = settings.env?.[name]
  return typeof value === 'string' ? value : undefined
}

export function resolveConfiguredEnvValue(name: string, label: string): string {
  const value = process.env[name] ?? getUserSettingsEnvValue(name)
  const resolved = value?.trim()
  if (!resolved) {
    throw new Error(
      `${label} environment variable ${name} is not set in the process or user settings.json env.`,
    )
  }
  return resolved
}
