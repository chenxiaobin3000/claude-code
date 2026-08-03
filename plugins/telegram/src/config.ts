import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export interface TelegramBotConfig {
  alias: string
  tokenEnv: string
  savedAt: string
}

interface BotIndex { version: 1; bots: TelegramBotConfig[] }

export function validateTelegramAlias(value: string): string {
  const alias = value.trim()
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/.test(alias)) throw new Error('Telegram Bot alias must be 1-32 ASCII letters, digits, underscores, or hyphens.')
  return alias
}

export function validateTelegramTokenEnv(value: string): string {
  const result = value.trim()
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(result)) throw new Error('Telegram Token environment variable name is invalid.')
  return result
}

export function getTelegramStateDir(): string {
  const dir = process.env.TELEGRAM_STATE_DIR || join(homedir(), '.claude', 'channels', 'telegram')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

export function getTelegramBotStateDir(alias: string): string {
  const dir = join(getTelegramStateDir(), 'bots', validateTelegramAlias(alias))
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

export function writeTelegramPrivateFile(path: string, content: string): void {
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(temporary, content, 'utf8')
  try { chmodSync(temporary, 0o600) } catch { /* Windows ACLs are authoritative. */ }
  renameSync(temporary, path)
  try { chmodSync(path, 0o600) } catch { /* Best effort on POSIX. */ }
}

function indexPath(): string { return join(getTelegramStateDir(), 'bots.json') }
function readIndex(): BotIndex {
  if (!existsSync(indexPath())) return { version: 1, bots: [] }
  try {
    const index = JSON.parse(readFileSync(indexPath(), 'utf8')) as BotIndex
    if (index.version !== 1 || !Array.isArray(index.bots)) throw new Error('unsupported index')
    return index
  } catch (error) { throw new Error(`Invalid Telegram Bot index: ${error}`) }
}
function writeIndex(index: BotIndex): void { writeTelegramPrivateFile(indexPath(), `${JSON.stringify(index, null, 2)}\n`) }

export function listTelegramBots(): TelegramBotConfig[] { return readIndex().bots.slice().sort((a, b) => a.alias.localeCompare(b.alias)) }
export function loadTelegramBot(alias: string): TelegramBotConfig | null { return listTelegramBots().find(bot => bot.alias === validateTelegramAlias(alias)) ?? null }
export function resolveTelegramBot(alias?: string): TelegramBotConfig | null {
  if (alias?.trim()) return loadTelegramBot(alias)
  const bots = listTelegramBots()
  if (bots.length > 1) throw new Error(`Multiple Telegram bots are configured (${bots.map(bot => bot.alias).join(', ')}); specify bot_alias.`)
  return bots[0] ?? null
}
export function saveTelegramBot(input: Omit<TelegramBotConfig, 'savedAt'>): TelegramBotConfig {
  const bot = { alias: validateTelegramAlias(input.alias), tokenEnv: validateTelegramTokenEnv(input.tokenEnv), savedAt: new Date().toISOString() }
  const index = readIndex()
  const duplicate = index.bots.find(candidate => candidate.tokenEnv === bot.tokenEnv && candidate.alias !== bot.alias)
  if (duplicate) throw new Error(`Telegram Token environment variable is already configured as ${duplicate.alias}.`)
  const position = index.bots.findIndex(candidate => candidate.alias === bot.alias)
  if (position >= 0) index.bots[position] = bot
  else index.bots.push(bot)
  writeIndex(index)
  getTelegramBotStateDir(bot.alias)
  return bot
}
export function removeTelegramBot(alias: string): void {
  const resolved = validateTelegramAlias(alias)
  const index = readIndex()
  index.bots = index.bots.filter(bot => bot.alias !== resolved)
  writeIndex(index)
  rmSync(join(getTelegramStateDir(), 'bots', resolved), { recursive: true, force: true })
}
export function resolveTelegramToken(bot: TelegramBotConfig): string {
  const token = process.env[bot.tokenEnv]?.trim()
  if (!token) throw new Error(`Token environment variable ${bot.tokenEnv} is not set for Telegram bot ${bot.alias}.`)
  if (!/^\d+:[A-Za-z0-9_-]{20,}$/.test(token)) throw new Error(`Token environment variable ${bot.tokenEnv} is invalid for Telegram bot ${bot.alias}.`)
  return token
}
export function loadTelegramState<T>(alias: string, filename: string, fallback: T): T {
  const path = join(getTelegramBotStateDir(alias), filename)
  if (!existsSync(path)) return fallback
  try { return JSON.parse(readFileSync(path, 'utf8')) as T } catch { return fallback }
}
export function saveTelegramState(alias: string, filename: string, value: unknown): void {
  writeTelegramPrivateFile(join(getTelegramBotStateDir(alias), filename), `${JSON.stringify(value, null, 2)}\n`)
}
