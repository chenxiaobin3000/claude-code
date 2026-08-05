import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { getUserSettingsEnvValue } from '../../userSettingsEnv.js'

export const X_BEARER_TOKEN_ENV = 'X_BEARER_TOKEN'
export const X_PROXY_URL_ENV = 'X_PROXY_URL'

export interface XAppConfig {
  alias: string
  savedAt: string
}

interface AppIndex {
  version: 1
  apps: XAppConfig[]
}

export function validateXAppAlias(value: string): string {
  const alias = value.trim()
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/.test(alias))
    throw new Error(
      'X App alias must be 1-32 ASCII letters, digits, underscores, or hyphens.',
    )
  return alias
}

export function getXStateDir(): string {
  const dir = process.env.X_STATE_DIR || join(homedir(), '.claude', 'x')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 })
  return dir
}

function indexPath(): string {
  return join(getXStateDir(), 'apps.json')
}

function writePrivateFile(path: string, content: string): void {
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(temporary, content, { encoding: 'utf8', mode: 0o600 })
  try {
    chmodSync(temporary, 0o600)
  } catch {
    /* Windows ACLs are authoritative. */
  }
  renameSync(temporary, path)
  try {
    chmodSync(path, 0o600)
  } catch {
    /* Best effort on POSIX. */
  }
}

function readIndex(): AppIndex {
  if (!existsSync(indexPath())) return { version: 1, apps: [] }
  try {
    const parsed = JSON.parse(readFileSync(indexPath(), 'utf8')) as AppIndex
    if (parsed.version !== 1 || !Array.isArray(parsed.apps))
      throw new Error('unsupported index')
    return parsed
  } catch (error) {
    throw new Error(`Invalid X App index: ${error}`)
  }
}

function writeIndex(index: AppIndex): void {
  writePrivateFile(indexPath(), `${JSON.stringify(index, null, 2)}\n`)
}

export function listXApps(): XAppConfig[] {
  return readIndex()
    .apps.slice()
    .sort((a, b) => a.alias.localeCompare(b.alias))
}

export function saveXApp(alias: string): XAppConfig {
  const app: XAppConfig = {
    alias: validateXAppAlias(alias),
    savedAt: new Date().toISOString(),
  }
  const index = readIndex()
  const position = index.apps.findIndex(
    candidate => candidate.alias === app.alias,
  )
  if (position >= 0) index.apps[position] = app
  else index.apps.push(app)
  writeIndex(index)
  return app
}

export function removeXApp(alias: string): void {
  const validated = validateXAppAlias(alias)
  const index = readIndex()
  index.apps = index.apps.filter(app => app.alias !== validated)
  writeIndex(index)
  if (!index.apps.length) rmSync(indexPath(), { force: true })
}

export function resolveXApp(alias?: string): XAppConfig | null {
  const apps = listXApps()
  if (alias?.trim())
    return apps.find(app => app.alias === validateXAppAlias(alias)) ?? null
  if (apps.length > 1)
    throw new Error(
      `Multiple X Apps are configured (${apps.map(app => app.alias).join(', ')}); specify app.`,
    )
  return apps[0] ?? null
}

function optionalUserEnv(name: string): string | undefined {
  const processValue = process.env[name]?.trim()
  if (processValue) return processValue
  try {
    return getUserSettingsEnvValue(name)?.trim() || undefined
  } catch {
    return undefined
  }
}

export function resolveXBearerToken(app: XAppConfig): string {
  const raw = optionalUserEnv(X_BEARER_TOKEN_ENV)
  if (!raw)
    throw new Error(
      `${X_BEARER_TOKEN_ENV} is not set in the process or user settings.json env.`,
    )
  if (!raw.startsWith('{')) {
    if (listXApps().length > 1)
      throw new Error(
        `${X_BEARER_TOKEN_ENV} must be a JSON object keyed by App alias when multiple X Apps are configured.`,
      )
    return raw
  }
  let map: Record<string, unknown>
  try {
    map = JSON.parse(raw) as Record<string, unknown>
  } catch {
    throw new Error(`${X_BEARER_TOKEN_ENV} contains invalid JSON.`)
  }
  const token = map[app.alias]
  if (typeof token !== 'string' || !token.trim())
    throw new Error(
      `${X_BEARER_TOKEN_ENV} has no token for X App ${app.alias}.`,
    )
  return token.trim()
}

export function resolveXProxyUrl(): string | undefined {
  return optionalUserEnv(X_PROXY_URL_ENV)
}
