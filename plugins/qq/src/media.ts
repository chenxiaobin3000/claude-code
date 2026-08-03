import { chmodSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { QqAttachment } from './types.js'

const MAX_INBOUND_BYTES = 20 * 1024 * 1024
const QQ_MEDIA_HOSTS = ['qq.com', 'qq.com.cn', 'qpic.cn']
function allowedHost(host: string): boolean { return QQ_MEDIA_HOSTS.some(suffix => host === suffix || host.endsWith(`.${suffix}`)) }
export async function downloadQqAttachment(item: QqAttachment, botAlias: string, messageId: string): Promise<string> {
  const candidate = item.voice_wav_url || item.url
  const url = new URL(candidate)
  if (url.protocol !== 'https:' || !allowedHost(url.hostname.toLowerCase())) throw new Error('QQ attachment URL failed the HTTPS/host allowlist.')
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000), redirect: 'error' })
  if (!response.ok) throw new Error(`QQ attachment download failed with HTTP ${response.status}.`)
  const declared = Number(response.headers.get('content-length') || 0)
  if (declared > MAX_INBOUND_BYTES) throw new Error('QQ attachment exceeds 20 MiB.')
  const data = Buffer.from(await response.arrayBuffer())
  if (data.length > MAX_INBOUND_BYTES) throw new Error('QQ attachment exceeds 20 MiB.')
  const directory = join(tmpdir(), 'qq-media', botAlias)
  mkdirSync(directory, { recursive: true })
  const safeName = (item.filename || `attachment-${Date.now()}`).replace(/[^A-Za-z0-9._-]/g, '_').slice(-120)
  const path = join(directory, `${messageId}-${safeName}`)
  writeFileSync(path, data)
  try { chmodSync(path, 0o600) } catch { /* Windows ACLs apply. */ }
  return path
}
