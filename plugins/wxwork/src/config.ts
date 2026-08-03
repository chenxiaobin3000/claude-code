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

export const DEFAULT_WXWORK_WS_URL = 'wss://openws.work.weixin.qq.com'

export interface WxworkBotConfig {
  alias: string
  botId: string
  secretEnv: string
  wsUrl: string
  savedAt: string
}

interface BotIndex {
  version: 1
  bots: WxworkBotConfig[]
}

export function validateBotAlias(value: string): string {
  const alias = value.trim()
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/.test(alias)) {
    throw new Error('Bot alias must be 1-32 ASCII letters, digits, underscores, or hyphens.')
  }
  return alias
}

export function validateSecretEnv(value: string): string {
  const name = value.trim()
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error('Secret environment variable name is invalid.')
  }
  return name
}

export function validateBotId(value: string): string {
  const botId = value.trim()
  if (
    !botId ||
    botId.length > 256 ||
    [...botId].some(character => character.charCodeAt(0) < 32)
  ) {
    throw new Error('Bot ID must be a non-empty printable value no longer than 256 characters.')
  }
  return botId
}

export function validateWsUrl(value: string): string {
  const url = new URL(value)
  if (url.protocol !== 'wss:') throw new Error('WeCom WebSocket URL must use wss://.')
  return url.toString().replace(/\/$/, '')
}

export function getWxworkStateDir(): string {
  const dir = process.env.WXWORK_STATE_DIR || join(homedir(), '.claude', 'channels', 'wxwork')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

export function getBotStateDir(alias: string): string {
  const dir = join(getWxworkStateDir(), 'bots', validateBotAlias(alias))
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

function indexPath(): string {
  return join(getWxworkStateDir(), 'bots.json')
}

export function writePrivateFileAtomic(path: string, content: string): void {
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(temporary, content, 'utf8')
  try { chmodSync(temporary, 0o600) } catch { /* Windows ACLs are authoritative. */ }
  renameSync(temporary, path)
  try { chmodSync(path, 0o600) } catch { /* Best effort on non-POSIX filesystems. */ }
}

function readIndex(): BotIndex {
  if (!existsSync(indexPath())) return { version: 1, bots: [] }
  try {
    const index = JSON.parse(readFileSync(indexPath(), 'utf8')) as BotIndex
    if (index.version !== 1 || !Array.isArray(index.bots)) throw new Error('unsupported index')
    return index
  } catch (error) {
    throw new Error(`Invalid wxwork bot index: ${error}`)
  }
}

function writeIndex(index: BotIndex): void {
  writePrivateFileAtomic(indexPath(), `${JSON.stringify(index, null, 2)}\n`)
}

export function listBots(): WxworkBotConfig[] {
  return readIndex().bots.slice().sort((a, b) => a.alias.localeCompare(b.alias))
}

export function loadBot(alias: string): WxworkBotConfig | null {
  return listBots().find(bot => bot.alias === validateBotAlias(alias)) ?? null
}

export function resolveBot(alias?: string): WxworkBotConfig | null {
  if (alias?.trim()) return loadBot(alias)
  const bots = listBots()
  if (bots.length === 0) return null
  if (bots.length > 1) throw new Error(`Multiple wxwork bots are configured (${bots.map(bot => bot.alias).join(', ')}); specify bot_alias.`)
  return bots[0]!
}

export function saveBot(input: Omit<WxworkBotConfig, 'savedAt' | 'wsUrl'> & { wsUrl?: string }): WxworkBotConfig {
  const bot: WxworkBotConfig = {
    alias: validateBotAlias(input.alias),
    botId: validateBotId(input.botId),
    secretEnv: validateSecretEnv(input.secretEnv),
    wsUrl: validateWsUrl(input.wsUrl || DEFAULT_WXWORK_WS_URL),
    savedAt: new Date().toISOString(),
  }
  const index = readIndex()
  const duplicate = index.bots.find(candidate => candidate.botId === bot.botId && candidate.alias !== bot.alias)
  if (duplicate) throw new Error(`Bot ID is already configured as ${duplicate.alias}.`)
  const position = index.bots.findIndex(candidate => candidate.alias === bot.alias)
  if (position >= 0) index.bots[position] = bot
  else index.bots.push(bot)
  writeIndex(index)
  getBotStateDir(bot.alias)
  return bot
}

export function removeBot(alias: string): void {
  const resolved = validateBotAlias(alias)
  const index = readIndex()
  index.bots = index.bots.filter(bot => bot.alias !== resolved)
  writeIndex(index)
  rmSync(join(getWxworkStateDir(), 'bots', resolved), { recursive: true, force: true })
}

export function resolveBotSecret(bot: WxworkBotConfig): string {
  const value = process.env[bot.secretEnv]?.trim()
  if (!value) throw new Error(`Secret environment variable ${bot.secretEnv} is not set for wxwork bot ${bot.alias}.`)
  return value
}

export function loadBotState<T>(alias: string, filename: string, fallback: T): T {
  const path = join(getBotStateDir(alias), filename)
  if (!existsSync(path)) return fallback
  try { return JSON.parse(readFileSync(path, 'utf8')) as T } catch { return fallback }
}

export function saveBotState(alias: string, filename: string, value: unknown): void {
  writePrivateFileAtomic(join(getBotStateDir(alias), filename), `${JSON.stringify(value, null, 2)}\n`)
}
