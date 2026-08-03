import { createDecipheriv, createHash } from 'node:crypto'
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { extname, isAbsolute, join } from 'node:path'
import type { WxworkMediaReference, WxworkMediaType } from './types.js'

export const WXWORK_MEDIA_LIMITS: Readonly<Record<WxworkMediaType, number>> = {
  image: 10 * 1024 * 1024,
  voice: 2 * 1024 * 1024,
  video: 10 * 1024 * 1024,
  file: 20 * 1024 * 1024,
}
export const WXWORK_UPLOAD_CHUNK_BYTES = 512 * 1024
export const WXWORK_UPLOAD_SESSION_MS = 30 * 60_000
export const WXWORK_MEDIA_LIFETIME_MS = 3 * 24 * 60 * 60_000

export function decryptWxworkFile(encrypted: Buffer, aeskey: string): Buffer {
  if (encrypted.length === 0) throw new Error('Encrypted wxwork media is empty.')
  const key = Buffer.from(aeskey, 'base64')
  if (key.length !== 32) throw new Error('wxwork media AES key must decode to 32 bytes.')
  const decipher = createDecipheriv('aes-256-cbc', key, key.subarray(0, 16))
  decipher.setAutoPadding(false)
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()])
  const padding = decrypted.at(-1) ?? 0
  if (padding < 1 || padding > 32 || padding > decrypted.length) throw new Error('Invalid wxwork media PKCS#7 padding.')
  for (let index = decrypted.length - padding; index < decrypted.length; index++) {
    if (decrypted[index] !== padding) throw new Error('Invalid wxwork media PKCS#7 padding bytes.')
  }
  return decrypted.subarray(0, decrypted.length - padding)
}

export async function downloadWxworkMedia(reference: WxworkMediaReference, botAlias: string, messageId: string): Promise<string> {
  const url = new URL(reference.url)
  if (url.protocol !== 'https:') throw new Error('wxwork media download must use HTTPS.')
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000), redirect: 'error' })
  if (!response.ok) throw new Error(`wxwork media download failed with HTTP ${response.status}.`)
  const declared = Number(response.headers.get('content-length') || 0)
  const maximum = WXWORK_MEDIA_LIMITS[reference.type] + 32
  if (declared > maximum) throw new Error(`wxwork ${reference.type} download exceeds its size limit.`)
  const encrypted = Buffer.from(await response.arrayBuffer())
  if (encrypted.length > maximum) throw new Error(`wxwork ${reference.type} download exceeds its size limit.`)
  const plain = decryptWxworkFile(encrypted, reference.aeskey)
  if (plain.length > WXWORK_MEDIA_LIMITS[reference.type]) throw new Error(`wxwork ${reference.type} exceeds its size limit.`)
  const directory = join(tmpdir(), 'wxwork-media', botAlias)
  mkdirSync(directory, { recursive: true })
  const path = join(directory, `${messageId}-${createHash('sha256').update(reference.url).digest('hex').slice(0, 12)}.${reference.type}`)
  writeFileSync(path, plain)
  try { chmodSync(path, 0o600) } catch { /* Windows ACLs apply. */ }
  return path
}

export function inferWxworkMediaType(path: string): WxworkMediaType {
  if (!isAbsolute(path)) throw new Error('wxwork attachments must use absolute local paths.')
  const extension = extname(path).toLowerCase()
  if (['.jpg', '.jpeg', '.png'].includes(extension)) return 'image'
  if (['.amr', '.ogg', '.opus', '.mp3', '.wav'].includes(extension)) return 'voice'
  if (['.mp4', '.mov', '.m4v'].includes(extension)) return 'video'
  return 'file'
}
