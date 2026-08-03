import { readFileSync, realpathSync, statSync } from 'node:fs'
import { extname, isAbsolute, relative, resolve } from 'node:path'
import { QQ_API_BASE_URL, QQ_TOKEN_BASE_URL, type QqBotConfig } from './config.js'
import { deterministicMsgSeq } from './protocol.js'
import type { QqChatScope } from './types.js'

export class QqApiError extends Error {
  constructor(message: string, readonly httpStatus: number, readonly path: string, readonly bizCode?: number, readonly retryAfterMs?: number) { super(message) }
}

interface TokenState { value: string; expiresAt: number }
export type QqFetch = typeof fetch

export class QqApiClient {
  private token: TokenState | null = null
  constructor(private readonly bot: QqBotConfig, private readonly secret: string, private readonly request: QqFetch = fetch, private readonly apiBaseUrl = QQ_API_BASE_URL, private readonly tokenBaseUrl = QQ_TOKEN_BASE_URL) {}

  clearToken(): void { this.token = null }
  async getToken(force = false): Promise<string> {
    if (!force && this.token && Date.now() < this.token.expiresAt - Math.min(5 * 60_000, (this.token.expiresAt - Date.now()) / 3)) return this.token.value
    const response = await this.request(`${this.tokenBaseUrl}/app/getAppAccessToken`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': 'claude-code-qq/1.0' },
      body: JSON.stringify({ appId: this.bot.appId, clientSecret: this.secret }), signal: AbortSignal.timeout(10_000),
    })
    const raw = await response.text()
    if (!response.ok) throw this.error(response, '/app/getAppAccessToken', raw)
    const body = JSON.parse(raw) as { access_token?: unknown; expires_in?: unknown }
    if (typeof body.access_token !== 'string') throw new QqApiError('QQ token response is missing access_token.', response.status, '/app/getAppAccessToken')
    this.token = { value: body.access_token, expiresAt: Date.now() + (typeof body.expires_in === 'number' ? body.expires_in : 7200) * 1000 }
    return this.token.value
  }

  async getGatewayUrl(): Promise<string> {
    const body = await this.call<{ url?: unknown }>('GET', '/gateway')
    if (typeof body.url !== 'string' || new URL(body.url).protocol !== 'wss:') throw new Error('QQ gateway response did not provide a secure WebSocket URL.')
    return body.url
  }

  async sendText(scope: QqChatScope, targetId: string, messageId: string, text: string, part: number): Promise<unknown> {
    return this.call('POST', this.messagePath(scope, targetId), { content: text, msg_type: 0, msg_id: messageId, msg_seq: deterministicMsgSeq(messageId, part) })
  }

  async sendMedia(scope: QqChatScope, targetId: string, messageId: string, path: string, part: number): Promise<unknown> {
    const file = readAllowedQqFile(path)
    if (file.data.length > 20 * 1024 * 1024) throw new Error('QQ one-shot media upload supports at most 20 MiB; large-file chunk upload is outside the current product boundary.')
    const upload = await this.call<{ file_info?: unknown }>('POST', this.filePath(scope, targetId), {
      file_type: inferQqFileType(path), file_data: file.data.toString('base64'), file_name: file.name, srv_send_msg: false,
    }, 120_000)
    if (typeof upload.file_info !== 'string') throw new Error('QQ media upload response is missing file_info.')
    return this.call('POST', this.messagePath(scope, targetId), {
      msg_type: 7, media: { file_info: upload.file_info }, msg_id: messageId, msg_seq: deterministicMsgSeq(messageId, part),
    }, 120_000)
  }

  private async call<T = unknown>(method: string, path: string, body?: unknown, timeout = 30_000): Promise<T> {
    const token = await this.getToken()
    const response = await this.request(`${this.apiBaseUrl}${path}`, {
      method, headers: { Authorization: `QQBot ${token}`, 'Content-Type': 'application/json', 'User-Agent': 'claude-code-qq/1.0' },
      ...(body !== undefined && { body: JSON.stringify(body) }), signal: AbortSignal.timeout(timeout),
    })
    const raw = await response.text()
    if (!response.ok) {
      if (response.status === 401) this.clearToken()
      throw this.error(response, path, raw)
    }
    try { return JSON.parse(raw) as T } catch { throw new QqApiError(`QQ API returned invalid JSON for ${path}.`, response.status, path) }
  }

  private error(response: Response, path: string, raw: string): QqApiError {
    let message = `QQ API HTTP ${response.status}`
    let code: number | undefined
    try {
      const body = JSON.parse(raw) as { message?: unknown; code?: unknown; err_code?: unknown }
      if (typeof body.message === 'string') message = body.message
      const candidate = body.code ?? body.err_code
      if (typeof candidate === 'number') code = candidate
    } catch { /* Truncate non-JSON provider details. */ }
    const seconds = Number(response.headers.get('retry-after'))
    return new QqApiError(`${message} (${path}).`, response.status, path, code, Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : undefined)
  }

  private messagePath(scope: QqChatScope, target: string): string { return scope === 'c2c' ? `/v2/users/${target}/messages` : `/v2/groups/${target}/messages` }
  private filePath(scope: QqChatScope, target: string): string { return scope === 'c2c' ? `/v2/users/${target}/files` : `/v2/groups/${target}/files` }
}

function allowedRoots(): string[] {
  return (process.env.QQ_ALLOWED_FILE_ROOTS ?? '').split(process.platform === 'win32' ? ';' : ':').map(value => value.trim()).filter(Boolean).map(value => realpathSync(resolve(value)))
}
function readAllowedQqFile(path: string): { data: Buffer; name: string } {
  if (!isAbsolute(path)) throw new Error('QQ attachment paths must be absolute.')
  const actual = realpathSync(path)
  const allowed = allowedRoots().some(root => {
    const child = relative(root, actual)
    return child === '' || (!child.startsWith('..') && !isAbsolute(child))
  })
  if (!allowed) throw new Error('QQ attachment is outside QQ_ALLOWED_FILE_ROOTS.')
  if (!statSync(actual).isFile()) throw new Error('QQ attachment is not a regular file.')
  return { data: readFileSync(actual), name: actual.split(/[\\/]/).at(-1) ?? 'attachment.bin' }
}
export function inferQqFileType(path: string): 1 | 2 | 3 | 4 {
  const extension = extname(path).toLowerCase()
  if (['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'].includes(extension)) return 1
  if (['.mp4', '.mov', '.m4v'].includes(extension)) return 2
  if (['.mp3', '.wav', '.silk', '.ogg', '.opus'].includes(extension)) return 3
  return 4
}
