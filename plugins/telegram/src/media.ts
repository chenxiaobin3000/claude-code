import { chmodSync, mkdirSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { extname, isAbsolute, join, relative } from 'node:path'
import type { TelegramAttachment } from './types.js'

export const TELEGRAM_MEDIA_LIMIT = 20 * 1024 * 1024

function safeSegment(value: string): string { return value.replace(/[^A-Za-z0-9._-]/g, '_').slice(-120) || 'unknown' }
function apiRoot(): string { return (process.env.TELEGRAM_API_ROOT || 'https://api.telegram.org').replace(/\/$/, '') }

export async function downloadTelegramAttachment(
  token: string,
  item: TelegramAttachment,
  botAlias: string,
  chatId: string,
  messageId: number,
  getFile: (fileId: string) => Promise<{ file_path?: string }>,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  if (item.size !== undefined && item.size > TELEGRAM_MEDIA_LIMIT) throw new Error('Telegram attachment exceeds 20 MiB.')
  const file = await getFile(item.fileId)
  if (!file.file_path || file.file_path.includes('..') || file.file_path.startsWith('/')) throw new Error('Telegram getFile returned an invalid path.')
  const root = apiRoot()
  const url = new URL(`${root}/file/bot${token}/${file.file_path}`)
  if (!process.env.TELEGRAM_API_ROOT && (url.protocol !== 'https:' || url.hostname !== 'api.telegram.org')) throw new Error('Telegram attachment URL failed the HTTPS/host allowlist.')
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(30_000), redirect: 'error' })
  if (!response.ok) throw new Error(`Telegram attachment download failed with HTTP ${response.status}.`)
  const declared = Number(response.headers.get('content-length') || 0)
  if (declared > TELEGRAM_MEDIA_LIMIT) throw new Error('Telegram attachment exceeds 20 MiB.')
  const data = Buffer.from(await response.arrayBuffer())
  if (data.length > TELEGRAM_MEDIA_LIMIT) throw new Error('Telegram attachment exceeds 20 MiB.')
  const directory = join(tmpdir(), 'telegram-media', safeSegment(botAlias), safeSegment(chatId), String(messageId))
  mkdirSync(directory, { recursive: true })
  const fallback = `${item.kind}${extname(file.file_path) || ''}`
  const path = join(directory, safeSegment(item.fileName || fallback))
  writeFileSync(path, data)
  try { chmodSync(path, 0o600) } catch { /* Windows ACLs apply. */ }
  return path
}

function allowedRoots(): string[] {
  const raw = process.env.TELEGRAM_ALLOWED_FILE_ROOTS?.trim()
  if (!raw) return []
  return raw.split(process.platform === 'win32' ? ';' : ':').map(value => value.trim()).filter(Boolean).map(value => realpathSync(value))
}
export function validateTelegramOutboundFile(path: string): string {
  if (!isAbsolute(path)) throw new Error('Telegram attachment path must be absolute.')
  const resolved = realpathSync(path)
  const allowed = allowedRoots().some(root => {
    const child = relative(root, resolved)
    return child === '' || (!child.startsWith('..') && !isAbsolute(child))
  })
  if (!allowed) throw new Error('Telegram attachment is outside TELEGRAM_ALLOWED_FILE_ROOTS.')
  const stat = statSync(resolved)
  if (!stat.isFile()) throw new Error('Telegram attachment is not a regular file.')
  if (stat.size > TELEGRAM_MEDIA_LIMIT) throw new Error('Telegram attachment exceeds 20 MiB.')
  return resolved
}

export function inferTelegramMediaKind(path: string): TelegramAttachment['kind'] {
  const extension = extname(path).toLowerCase()
  if (['.jpg', '.jpeg', '.png', '.webp'].includes(extension)) return 'photo'
  if (['.mp3', '.m4a'].includes(extension)) return 'audio'
  if (['.ogg', '.oga', '.opus'].includes(extension)) return 'voice'
  if (extension === '.mp4') return 'video'
  return 'document'
}
