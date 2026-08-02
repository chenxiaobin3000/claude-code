import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const DEFAULT_BASE_URL = 'https://ilinkai.weixin.qq.com'
export const CDN_BASE_URL = 'https://novac2c.cdn.weixin.qq.com/c2c'
export const DEFAULT_ACCOUNT_ID = 'default'

export interface AccountData {
  accountId: string
  token: string
  baseUrl: string
  userId?: string
  savedAt: string
}

export interface AccountSummary {
  accountId: string
  userId?: string
  baseUrl: string
  savedAt: string
}

export interface WeixinFeatureConfig {
  quotedText: boolean
  remoteHttpMedia: boolean
  channelDiagnostics: boolean
  echo: boolean
  streamingMarkdown: boolean
  toolProgress: boolean
}

export const DEFAULT_FEATURE_CONFIG: Readonly<WeixinFeatureConfig> = {
  quotedText: true,
  remoteHttpMedia: false,
  channelDiagnostics: false,
  echo: false,
  streamingMarkdown: false,
  toolProgress: false,
}

interface AccountsIndex {
  version: 1
  accounts: AccountSummary[]
}

export class AmbiguousWeixinAccountError extends Error {
  constructor(accountIds: string[]) {
    super(
      `Multiple WeChat accounts are configured (${accountIds.join(', ')}); specify account_id or use the routed chat_id.`,
    )
    this.name = 'AmbiguousWeixinAccountError'
  }
}

export function validateAccountId(value: string): string {
  const accountId = value.trim()
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/.test(accountId)) {
    throw new Error(
      'WeChat account ID must be 1-32 ASCII letters, digits, underscores, or hyphens and start with a letter or digit.',
    )
  }
  return accountId
}

export function getStateDir(): string {
  const dir =
    process.env.WEIXIN_STATE_DIR ||
    join(homedir(), '.claude', 'channels', 'weixin')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

export function getAccountStateDir(accountId: string): string {
  const dir = join(getStateDir(), 'accounts', validateAccountId(accountId))
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

function indexPath(): string {
  return join(getStateDir(), 'accounts.json')
}

function accountPath(accountId: string): string {
  return join(getAccountStateDir(accountId), 'account.json')
}

function writePrivateFileAtomic(path: string, content: string): void {
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(temporary, content, 'utf-8')
  try {
    chmodSync(temporary, 0o600)
  } catch {
    // Windows applies the current user ACL; chmod is best effort.
  }
  renameSync(temporary, path)
  try {
    chmodSync(path, 0o600)
  } catch {
    // Best effort on filesystems without POSIX modes.
  }
}

function readIndex(): AccountsIndex {
  const path = indexPath()
  if (!existsSync(path)) {
    const legacyPath = join(getStateDir(), 'account.json')
    if (!existsSync(legacyPath)) return { version: 1, accounts: [] }
    try {
      const legacy = JSON.parse(readFileSync(legacyPath, 'utf-8')) as Omit<
        AccountData,
        'accountId'
      >
      const accountId = DEFAULT_ACCOUNT_ID
      const migrated: AccountData = { ...legacy, accountId }
      writePrivateFileAtomic(
        accountPath(accountId),
        `${JSON.stringify(migrated, null, 2)}\n`,
      )
      for (const filename of [
        'access.json',
        'pending-pairings.json',
        'cursor.txt',
        'context-tokens.json',
      ]) {
        const source = join(getStateDir(), filename)
        const destination = join(getAccountStateDir(accountId), filename)
        if (existsSync(source) && !existsSync(destination)) renameSync(source, destination)
      }
      rmSync(legacyPath, { force: true })
      const index: AccountsIndex = {
        version: 1,
        accounts: [
          {
            accountId,
            baseUrl: legacy.baseUrl,
            savedAt: legacy.savedAt,
            ...(legacy.userId && { userId: legacy.userId }),
          },
        ],
      }
      writePrivateFileAtomic(path, `${JSON.stringify(index, null, 2)}\n`)
      return index
    } catch (error) {
      throw new Error(`Failed to migrate legacy WeChat account: ${error}`)
    }
  }
  try {
    const value = JSON.parse(readFileSync(path, 'utf-8')) as AccountsIndex
    if (value.version !== 1 || !Array.isArray(value.accounts)) {
      throw new Error('unsupported accounts index')
    }
    return value
  } catch (error) {
    throw new Error(`Invalid WeChat accounts index: ${error}`)
  }
}

function writeIndex(index: AccountsIndex): void {
  writePrivateFileAtomic(indexPath(), `${JSON.stringify(index, null, 2)}\n`)
}

export function listAccounts(): AccountSummary[] {
  return readIndex().accounts.slice().sort((a, b) =>
    a.accountId.localeCompare(b.accountId),
  )
}

export function resolveAccountId(accountId?: string): string | null {
  if (accountId?.trim()) return validateAccountId(accountId)
  const ids = listAccounts().map(account => account.accountId)
  if (ids.length === 0) return null
  if (ids.length > 1) throw new AmbiguousWeixinAccountError(ids)
  return ids[0]!
}

export function loadAccount(accountId?: string): AccountData | null {
  const resolved = resolveAccountId(accountId)
  if (!resolved) return null
  const path = accountPath(resolved)
  if (!existsSync(path)) return null
  try {
    const value = JSON.parse(readFileSync(path, 'utf-8')) as AccountData
    return { ...value, accountId: resolved }
  } catch (error) {
    throw new Error(`Invalid WeChat account ${resolved}: ${error}`)
  }
}

export function loadAllAccounts(): AccountData[] {
  return listAccounts().map(summary => {
    const account = loadAccount(summary.accountId)
    if (!account) throw new Error(`Missing credentials for WeChat account ${summary.accountId}`)
    return account
  })
}

export function saveAccount(data: Omit<AccountData, 'accountId'>, accountId = DEFAULT_ACCOUNT_ID): void {
  const resolved = validateAccountId(accountId)
  const account: AccountData = { ...data, accountId: resolved }
  writePrivateFileAtomic(accountPath(resolved), `${JSON.stringify(account, null, 2)}\n`)
  const index = readIndex()
  const summary: AccountSummary = {
    accountId: resolved,
    baseUrl: data.baseUrl,
    savedAt: data.savedAt,
    ...(data.userId && { userId: data.userId }),
  }
  const position = index.accounts.findIndex(item => item.accountId === resolved)
  if (position >= 0) index.accounts[position] = summary
  else index.accounts.push(summary)
  writeIndex(index)
}

export function clearAccount(accountId?: string): void {
  const resolved = resolveAccountId(accountId)
  if (!resolved) return
  const dir = getAccountStateDir(resolved)
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
  const index = readIndex()
  index.accounts = index.accounts.filter(item => item.accountId !== resolved)
  writeIndex(index)
}

export function loadStateJson<T>(filename: string, fallback: T, accountId = DEFAULT_ACCOUNT_ID): T {
  const path = join(getAccountStateDir(accountId), filename)
  if (!existsSync(path)) return fallback
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as T
  } catch {
    return fallback
  }
}

export function saveStateJson(filename: string, value: unknown, accountId = DEFAULT_ACCOUNT_ID): void {
  writePrivateFileAtomic(
    join(getAccountStateDir(accountId), filename),
    `${JSON.stringify(value, null, 2)}\n`,
  )
}

export function loadStateText(filename: string, accountId = DEFAULT_ACCOUNT_ID): string {
  const path = join(getAccountStateDir(accountId), filename)
  if (!existsSync(path)) return ''
  try {
    return readFileSync(path, 'utf-8').trim()
  } catch {
    return ''
  }
}

export function saveStateText(filename: string, value: string, accountId = DEFAULT_ACCOUNT_ID): void {
  writePrivateFileAtomic(join(getAccountStateDir(accountId), filename), value)
}

export function loadFeatureConfig(accountId: string): WeixinFeatureConfig {
  const configured = loadStateJson<Partial<WeixinFeatureConfig>>('features.json', {}, accountId)
  const features = { ...DEFAULT_FEATURE_CONFIG, ...configured }
  if (features.streamingMarkdown || features.toolProgress) {
    throw new Error(
      `WeChat account ${accountId} enables an unsupported feature: streamingMarkdown and toolProgress require host events that the current MCP Channel transport does not provide.`,
    )
  }
  return features
}

export function formatRoutedChatId(accountId: string, userId: string): string {
  return `${validateAccountId(accountId)}::${userId}`
}

export function parseRoutedChatId(chatId: string): { accountId: string; userId: string } | null {
  const separator = chatId.indexOf('::')
  if (separator <= 0) return null
  const accountId = chatId.slice(0, separator)
  const userId = chatId.slice(separator + 2)
  if (!userId) return null
  try {
    return { accountId: validateAccountId(accountId), userId }
  } catch {
    return null
  }
}

export function listAccountStateFiles(accountId: string): string[] {
  const dir = getAccountStateDir(accountId)
  return existsSync(dir) ? readdirSync(dir).sort() : []
}
