import { mkdirSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { getTelegramUserAccountStateDir } from './config.js'
import { TELEGRAM_USER_MEDIA_LIMIT } from './protocol.js'

function allowedRoots(): string[] { return (process.env.TELEGRAM_USER_ALLOWED_FILE_ROOTS ?? '').split(process.platform === 'win32' ? ';' : ':').map(value => value.trim()).filter(Boolean).map(value => realpathSync(value)) }
function within(root: string, path: string): boolean { const value = relative(root, path); return value === '' || (!value.startsWith('..') && !isAbsolute(value)) }
export function validateTelegramUserOutboundFile(path: string): string {
  if (!isAbsolute(path)) throw new Error('Telegram user media path must be absolute.')
  const actual = realpathSync(path); const roots = allowedRoots()
  if (!roots.length || !roots.some(root => within(root, actual))) throw new Error('Telegram user media path is outside TELEGRAM_USER_ALLOWED_FILE_ROOTS.')
  const stat = statSync(actual); if (!stat.isFile()) throw new Error('Telegram user media path is not a file.')
  if (stat.size > TELEGRAM_USER_MEDIA_LIMIT) throw new Error('Telegram user media exceeds the 20 MiB limit.')
  return actual
}
export function saveTelegramUserInboundMedia(alias: string, peerId: string, messageId: number, data: Buffer, filename = 'attachment.bin'): string {
  if (data.byteLength > TELEGRAM_USER_MEDIA_LIMIT) throw new Error('Telegram user media exceeds the 20 MiB limit.')
  const safeName = filename.replace(/[^A-Za-z0-9._-]/g, '_').slice(-120) || 'attachment.bin'
  const directory = join(getTelegramUserAccountStateDir(alias), 'media', peerId.replace(/[^0-9-]/g, '_'), String(messageId)); mkdirSync(directory, { recursive: true, mode: 0o700 })
  const path = resolve(directory, safeName); writeFileSync(path, data, { mode: 0o600 }); return path
}

