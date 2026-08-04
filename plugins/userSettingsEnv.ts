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

export function findUserSettingsEnvName(value: string, label: string): string {
  if (!value) throw new Error(`${label} must not be empty.`)

  const path = getUserSettingsPath()
  if (!existsSync(path)) {
    throw new Error(
      `User settings file ${path} does not exist; add ${label} to settings.json env before running add-local.`,
    )
  }

  let settings: UserSettings
  try {
    settings = JSON.parse(readFileSync(path, 'utf8')) as UserSettings
  } catch (error) {
    throw new Error(`Cannot read user settings file ${path}: ${error}`)
  }

  const matches = Object.entries(settings.env ?? {})
    .filter(
      ([name, candidate]) =>
        /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) &&
        typeof candidate === 'string' &&
        candidate === value,
    )
    .map(([name]) => name)

  if (matches.length === 0) {
    throw new Error(
      `No user settings env entry matches ${label}; add it to ${path} before running add-local.`,
    )
  }
  if (matches.length > 1) {
    throw new Error(
      `Multiple user settings env entries match ${label} (${matches.join(', ')}); use the regular add command with an explicit environment variable name.`,
    )
  }
  return matches[0]!
}
