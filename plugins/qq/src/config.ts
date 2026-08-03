import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const QQ_API_BASE_URL = 'https://api.sgroup.qq.com'
export const QQ_TOKEN_BASE_URL = 'https://bots.qq.com'

export interface QqBotConfig {
  alias: string
  appId: string
  secretEnv: string
  savedAt: string
}

interface BotIndex { version: 1; bots: QqBotConfig[] }

export function validateQqAlias(value: string): string {
  const alias = value.trim()
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/.test(alias)) throw new Error('QQ Bot alias must be 1-32 ASCII letters, digits, underscores, or hyphens.')
  return alias
}

function printable(value: string, label: string): string {
  const result = value.trim()
  if (!result || result.length > 256 || [...result].some(character => character.charCodeAt(0) < 32)) throw new Error(`${label} is invalid.`)
  return result
}

export function validateQqAppId(value: string): string { return printable(value, 'QQ AppID') }

export function validateQqSecretEnv(value: string): string {
  const result = value.trim()
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(result)) throw new Error('QQ Secret environment variable name is invalid.')
  return result
}

export function getQqStateDir(): string {
  const dir = process.env.QQ_STATE_DIR || join(homedir(), '.claude', 'channels', 'qq')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

export function getQqBotStateDir(alias: string): string {
  const dir = join(getQqStateDir(), 'bots', validateQqAlias(alias))
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

export function writeQqPrivateFile(path: string, content: string): void {
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(temporary, content, 'utf8')
  try { chmodSync(temporary, 0o600) } catch { /* Windows ACLs are authoritative. */ }
  renameSync(temporary, path)
  try { chmodSync(path, 0o600) } catch { /* Best effort on POSIX. */ }
}

function indexPath(): string { return join(getQqStateDir(), 'bots.json') }
function readIndex(): BotIndex {
  if (!existsSync(indexPath())) return { version: 1, bots: [] }
  try {
    const index = JSON.parse(readFileSync(indexPath(), 'utf8')) as BotIndex
    if (index.version !== 1 || !Array.isArray(index.bots)) throw new Error('unsupported index')
    return index
  } catch (error) { throw new Error(`Invalid QQ Bot index: ${error}`) }
}
function writeIndex(index: BotIndex): void { writeQqPrivateFile(indexPath(), `${JSON.stringify(index, null, 2)}\n`) }

export function listQqBots(): QqBotConfig[] { return readIndex().bots.slice().sort((a, b) => a.alias.localeCompare(b.alias)) }
export function loadQqBot(alias: string): QqBotConfig | null { return listQqBots().find(bot => bot.alias === validateQqAlias(alias)) ?? null }
export function resolveQqBot(alias?: string): QqBotConfig | null {
  if (alias?.trim()) return loadQqBot(alias)
  const bots = listQqBots()
  if (bots.length > 1) throw new Error(`Multiple QQ bots are configured (${bots.map(bot => bot.alias).join(', ')}); specify bot_alias.`)
  return bots[0] ?? null
}
export function saveQqBot(input: Omit<QqBotConfig, 'savedAt'>): QqBotConfig {
  const bot = { alias: validateQqAlias(input.alias), appId: validateQqAppId(input.appId), secretEnv: validateQqSecretEnv(input.secretEnv), savedAt: new Date().toISOString() }
  const index = readIndex()
  const duplicate = index.bots.find(candidate => candidate.appId === bot.appId && candidate.alias !== bot.alias)
  if (duplicate) throw new Error(`QQ AppID is already configured as ${duplicate.alias}.`)
  const position = index.bots.findIndex(candidate => candidate.alias === bot.alias)
  if (position >= 0) index.bots[position] = bot
  else index.bots.push(bot)
  writeIndex(index)
  getQqBotStateDir(bot.alias)
  return bot
}
export function removeQqBot(alias: string): void {
  const resolved = validateQqAlias(alias)
  const index = readIndex()
  index.bots = index.bots.filter(bot => bot.alias !== resolved)
  writeIndex(index)
  rmSync(join(getQqStateDir(), 'bots', resolved), { recursive: true, force: true })
}
export function resolveQqSecret(bot: QqBotConfig): string {
  const secret = process.env[bot.secretEnv]?.trim()
  if (!secret) throw new Error(`Secret environment variable ${bot.secretEnv} is not set for QQ bot ${bot.alias}.`)
  return secret
}
export function loadQqState<T>(alias: string, filename: string, fallback: T): T {
  const path = join(getQqBotStateDir(alias), filename)
  if (!existsSync(path)) return fallback
  try { return JSON.parse(readFileSync(path, 'utf8')) as T } catch { return fallback }
}
export function saveQqState(alias: string, filename: string, value: unknown): void {
  writeQqPrivateFile(join(getQqBotStateDir(alias), filename), `${JSON.stringify(value, null, 2)}\n`)
}
