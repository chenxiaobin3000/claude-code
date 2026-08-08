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
import {
  getUserSettingsEnvValue,
  resolveConfiguredEnvValue,
} from '../../userSettingsEnv.js'

export const TELEGRAM_USER_PROXY_URL_ENV = 'TELEGRAM_USER_PROXY_URL'

export interface TelegramUserAccountConfig {
  alias: string
  apiIdEnv: string
  apiHashEnv: string
  phoneEnv: string
  savedAt: string
}
interface AccountIndex {
  version: 1
  accounts: TelegramUserAccountConfig[]
}

export function validateTelegramUserAlias(value: string): string {
  const alias = value.trim()
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/.test(alias))
    throw new Error(
      'Telegram user account alias must be 1-32 ASCII letters, digits, underscores, or hyphens.',
    )
  return alias
}
export function validateSecretEnvName(value: string): string {
  const name = value.trim()
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name))
    throw new Error('Secret environment variable name is invalid.')
  return name
}
export function getTelegramUserStateDir(): string {
  const dir =
    process.env.TELEGRAM_USER_STATE_DIR ||
    join(homedir(), '.claude', 'channels', 'telegram-user')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 })
  return dir
}
export function getTelegramUserAccountStateDir(alias: string): string {
  const dir = join(
    getTelegramUserStateDir(),
    'accounts',
    validateTelegramUserAlias(alias),
  )
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 })
  try {
    chmodSync(dir, 0o700)
  } catch {
    /* Windows ACLs are authoritative. */
  }
  return dir
}
export function writeTelegramUserPrivateFile(
  path: string,
  content: string,
): void {
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(temporary, content, { encoding: 'utf8', mode: 0o600 })
  try {
    chmodSync(temporary, 0o600)
  } catch {
    /* Best effort on POSIX. */
  }
  renameSync(temporary, path)
  try {
    chmodSync(path, 0o600)
  } catch {
    /* Best effort on POSIX. */
  }
}
function indexPath(): string {
  return join(getTelegramUserStateDir(), 'accounts.json')
}
function legacyCredentialPath(alias: string): string {
  return join(getTelegramUserAccountStateDir(alias), 'credentials.json')
}
function readIndex(): AccountIndex {
  if (!existsSync(indexPath())) return { version: 1, accounts: [] }
  try {
    const parsed = JSON.parse(readFileSync(indexPath(), 'utf8')) as AccountIndex
    if (parsed.version !== 1 || !Array.isArray(parsed.accounts))
      throw new Error('unsupported index')
    return parsed
  } catch (error) {
    throw new Error(`Invalid Telegram user account index: ${error}`)
  }
}
function writeIndex(index: AccountIndex): void {
  writeTelegramUserPrivateFile(
    indexPath(),
    `${JSON.stringify(index, null, 2)}\n`,
  )
}
export function listTelegramUserAccounts(): TelegramUserAccountConfig[] {
  return readIndex()
    .accounts.slice()
    .sort((a, b) => a.alias.localeCompare(b.alias))
}
export function loadTelegramUserAccount(
  alias: string,
): TelegramUserAccountConfig | null {
  return (
    listTelegramUserAccounts().find(
      account => account.alias === validateTelegramUserAlias(alias),
    ) ?? null
  )
}
export function resolveTelegramUserAccount(
  alias?: string,
): TelegramUserAccountConfig | null {
  if (alias?.trim()) return loadTelegramUserAccount(alias)
  const accounts = listTelegramUserAccounts()
  if (accounts.length > 1)
    throw new Error(
      `Multiple Telegram user accounts are configured (${accounts.map(account => account.alias).join(', ')}); specify account alias.`,
    )
  return accounts[0] ?? null
}
function saveTelegramUserAccountConfig(
  account: TelegramUserAccountConfig,
): TelegramUserAccountConfig {
  const index = readIndex()
  const position = index.accounts.findIndex(
    candidate => candidate.alias === account.alias,
  )
  if (position >= 0) index.accounts[position] = account
  else index.accounts.push(account)
  writeIndex(index)
  getTelegramUserAccountStateDir(account.alias)
  return account
}
export function saveTelegramUserAccount(input: {
  alias: string
  apiIdEnv: string
  apiHashEnv: string
  phoneEnv: string
}): TelegramUserAccountConfig {
  const account = saveTelegramUserAccountConfig({
    alias: validateTelegramUserAlias(input.alias),
    apiIdEnv: validateSecretEnvName(input.apiIdEnv),
    apiHashEnv: validateSecretEnvName(input.apiHashEnv),
    phoneEnv: validateSecretEnvName(input.phoneEnv),
    savedAt: new Date().toISOString(),
  })
  rmSync(legacyCredentialPath(account.alias), { force: true })
  return account
}
export function removeTelegramUserAccount(alias: string): void {
  const validated = validateTelegramUserAlias(alias)
  const index = readIndex()
  index.accounts = index.accounts.filter(account => account.alias !== validated)
  writeIndex(index)
  rmSync(join(getTelegramUserStateDir(), 'accounts', validated), {
    recursive: true,
    force: true,
  })
}
export interface TelegramUserCredentials {
  apiId: number
  apiHash: string
  phone: string
}
export function resolveTelegramUserCredentials(
  account: TelegramUserAccountConfig,
): TelegramUserCredentials {
  if (!account.apiIdEnv || !account.apiHashEnv || !account.phoneEnv)
    throw new Error(
      `Credential environment variable names are missing for Telegram user account ${account.alias}.`,
    )
  const rawApiId = resolveConfiguredEnvValue(
    account.apiIdEnv,
    `API ID for Telegram user account ${account.alias}`,
  )
  const apiHash = resolveConfiguredEnvValue(
    account.apiHashEnv,
    `API Hash for Telegram user account ${account.alias}`,
  )
  const phone = resolveConfiguredEnvValue(
    account.phoneEnv,
    `Phone for Telegram user account ${account.alias}`,
  )
  return validateTelegramUserCredentials(
    { apiId: rawApiId, apiHash, phone },
    `Environment credentials for ${account.alias}`,
  )
}

export function resolveTelegramUserProxyUrl(): string | undefined {
  const processValue = process.env[TELEGRAM_USER_PROXY_URL_ENV]?.trim()
  if (processValue) return processValue
  try {
    return (
      getUserSettingsEnvValue(TELEGRAM_USER_PROXY_URL_ENV)?.trim() || undefined
    )
  } catch {
    return undefined
  }
}
function validateTelegramUserCredentials(
  input: { apiId?: string | number; apiHash?: string; phone?: string },
  label: string,
): TelegramUserCredentials {
  const rawApiId = String(input.apiId ?? '').trim()
  const apiHash = input.apiHash?.trim()
  const phone = input.phone?.trim()
  const apiId = Number(rawApiId)
  if (!Number.isSafeInteger(apiId) || apiId <= 0)
    throw new Error(`${label}: API ID is missing or invalid.`)
  if (!apiHash || !/^[A-Fa-f0-9]{32}$/.test(apiHash))
    throw new Error(`${label}: API hash is missing or invalid.`)
  if (!phone || !/^\+[1-9]\d{5,14}$/.test(phone))
    throw new Error(`${label}: phone is missing or invalid.`)
  return { apiId, apiHash, phone }
}
export function loadTelegramUserState<T>(
  alias: string,
  filename: string,
  fallback: T,
): T {
  const path = join(getTelegramUserAccountStateDir(alias), filename)
  if (!existsSync(path)) return fallback
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T
  } catch {
    return fallback
  }
}
export function saveTelegramUserState(
  alias: string,
  filename: string,
  value: unknown,
): void {
  writeTelegramUserPrivateFile(
    join(getTelegramUserAccountStateDir(alias), filename),
    `${JSON.stringify(value, null, 2)}\n`,
  )
}
export function loadTelegramUserSession(alias: string): string {
  const path = join(getTelegramUserAccountStateDir(alias), 'session.txt')
  return existsSync(path) ? readFileSync(path, 'utf8').trim() : ''
}
export function saveTelegramUserSession(alias: string, value: string): void {
  if (!value) throw new Error('Refusing to save an empty Telegram session.')
  writeTelegramUserPrivateFile(
    join(getTelegramUserAccountStateDir(alias), 'session.txt'),
    `${value}\n`,
  )
}
export function clearTelegramUserSession(alias: string): void {
  rmSync(join(getTelegramUserAccountStateDir(alias), 'session.txt'), {
    force: true,
  })
  rmSync(join(getTelegramUserAccountStateDir(alias), 'identity.json'), {
    force: true,
  })
}
