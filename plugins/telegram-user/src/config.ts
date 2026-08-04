import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export interface TelegramUserAccountConfig {
  alias: string
  apiIdEnv: string
  apiHashEnv: string
  phoneEnv: string
  savedAt: string
}
interface AccountIndex { version: 1; accounts: TelegramUserAccountConfig[] }

export function validateTelegramUserAlias(value: string): string {
  const alias = value.trim()
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/.test(alias)) throw new Error('Telegram user account alias must be 1-32 ASCII letters, digits, underscores, or hyphens.')
  return alias
}
export function validateSecretEnvName(value: string): string {
  const name = value.trim()
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error('Secret environment variable name is invalid.')
  return name
}
export function getTelegramUserStateDir(): string {
  const dir = process.env.TELEGRAM_USER_STATE_DIR || join(homedir(), '.claude', 'channels', 'telegram-user')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 })
  return dir
}
export function getTelegramUserAccountStateDir(alias: string): string {
  const dir = join(getTelegramUserStateDir(), 'accounts', validateTelegramUserAlias(alias))
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 })
  try { chmodSync(dir, 0o700) } catch { /* Windows ACLs are authoritative. */ }
  return dir
}
export function writeTelegramUserPrivateFile(path: string, content: string): void {
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(temporary, content, { encoding: 'utf8', mode: 0o600 })
  try { chmodSync(temporary, 0o600) } catch { /* Best effort on POSIX. */ }
  renameSync(temporary, path)
  try { chmodSync(path, 0o600) } catch { /* Best effort on POSIX. */ }
}
function indexPath(): string { return join(getTelegramUserStateDir(), 'accounts.json') }
function readIndex(): AccountIndex {
  if (!existsSync(indexPath())) return { version: 1, accounts: [] }
  try {
    const parsed = JSON.parse(readFileSync(indexPath(), 'utf8')) as AccountIndex
    if (parsed.version !== 1 || !Array.isArray(parsed.accounts)) throw new Error('unsupported index')
    return parsed
  } catch (error) { throw new Error(`Invalid Telegram user account index: ${error}`) }
}
function writeIndex(index: AccountIndex): void { writeTelegramUserPrivateFile(indexPath(), `${JSON.stringify(index, null, 2)}\n`) }
export function listTelegramUserAccounts(): TelegramUserAccountConfig[] { return readIndex().accounts.slice().sort((a, b) => a.alias.localeCompare(b.alias)) }
export function loadTelegramUserAccount(alias: string): TelegramUserAccountConfig | null { return listTelegramUserAccounts().find(account => account.alias === validateTelegramUserAlias(alias)) ?? null }
export function resolveTelegramUserAccount(alias?: string): TelegramUserAccountConfig | null {
  if (alias?.trim()) return loadTelegramUserAccount(alias)
  const accounts = listTelegramUserAccounts()
  if (accounts.length > 1) throw new Error(`Multiple Telegram user accounts are configured (${accounts.map(account => account.alias).join(', ')}); specify account alias.`)
  return accounts[0] ?? null
}
export function saveTelegramUserAccount(input: Omit<TelegramUserAccountConfig, 'savedAt'>): TelegramUserAccountConfig {
  const account = { alias: validateTelegramUserAlias(input.alias), apiIdEnv: validateSecretEnvName(input.apiIdEnv), apiHashEnv: validateSecretEnvName(input.apiHashEnv), phoneEnv: validateSecretEnvName(input.phoneEnv), savedAt: new Date().toISOString() }
  const index = readIndex()
  const position = index.accounts.findIndex(candidate => candidate.alias === account.alias)
  if (position >= 0) index.accounts[position] = account; else index.accounts.push(account)
  writeIndex(index); getTelegramUserAccountStateDir(account.alias)
  return account
}
export function removeTelegramUserAccount(alias: string): void {
  const validated = validateTelegramUserAlias(alias)
  const index = readIndex(); index.accounts = index.accounts.filter(account => account.alias !== validated); writeIndex(index)
  rmSync(join(getTelegramUserStateDir(), 'accounts', validated), { recursive: true, force: true })
}
export interface TelegramUserCredentials { apiId: number; apiHash: string; phone: string }
export function resolveTelegramUserCredentials(account: TelegramUserAccountConfig): TelegramUserCredentials {
  const rawApiId = process.env[account.apiIdEnv]?.trim()
  const apiHash = process.env[account.apiHashEnv]?.trim()
  const phone = process.env[account.phoneEnv]?.trim()
  const apiId = Number(rawApiId)
  if (!Number.isSafeInteger(apiId) || apiId <= 0) throw new Error(`API ID environment variable ${account.apiIdEnv} is missing or invalid for ${account.alias}.`)
  if (!apiHash || !/^[A-Fa-f0-9]{32}$/.test(apiHash)) throw new Error(`API hash environment variable ${account.apiHashEnv} is missing or invalid for ${account.alias}.`)
  if (!phone || !/^\+[1-9]\d{5,14}$/.test(phone)) throw new Error(`Phone environment variable ${account.phoneEnv} is missing or invalid for ${account.alias}.`)
  return { apiId, apiHash, phone }
}
export function loadTelegramUserState<T>(alias: string, filename: string, fallback: T): T {
  const path = join(getTelegramUserAccountStateDir(alias), filename)
  if (!existsSync(path)) return fallback
  try { return JSON.parse(readFileSync(path, 'utf8')) as T } catch { return fallback }
}
export function saveTelegramUserState(alias: string, filename: string, value: unknown): void { writeTelegramUserPrivateFile(join(getTelegramUserAccountStateDir(alias), filename), `${JSON.stringify(value, null, 2)}\n`) }
export function loadTelegramUserSession(alias: string): string { const path = join(getTelegramUserAccountStateDir(alias), 'session.txt'); return existsSync(path) ? readFileSync(path, 'utf8').trim() : '' }
export function saveTelegramUserSession(alias: string, value: string): void { if (!value) throw new Error('Refusing to save an empty Telegram session.'); writeTelegramUserPrivateFile(join(getTelegramUserAccountStateDir(alias), 'session.txt'), `${value}\n`) }
export function clearTelegramUserSession(alias: string): void { rmSync(join(getTelegramUserAccountStateDir(alias), 'session.txt'), { force: true }); rmSync(join(getTelegramUserAccountStateDir(alias), 'identity.json'), { force: true }) }

