import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import WebSocket from 'ws'
import { createFinalReplyBody, createMediaReplyBody, createPingFrame, createSubscribeFrame, generateWxworkRequestId, parseWxworkFrame } from './protocol.js'
import { WXWORK_MEDIA_LIMITS, WXWORK_UPLOAD_CHUNK_BYTES } from './media.js'
import { WxworkCommand, type UploadedMedia, type WxworkFrame, type WxworkMediaType } from './types.js'

export interface WxworkSocket {
  readonly readyState: number
  on(event: 'open', listener: () => void): this
  on(event: 'message', listener: (data: unknown) => void): this
  on(event: 'close', listener: (code: number, reason: Buffer) => void): this
  on(event: 'error', listener: (error: Error) => void): this
  send(data: string): void
  close(code?: number, reason?: string): void
  terminate(): void
  removeAllListeners(): this
}

export interface WxworkClientCallbacks {
  onAuthenticated?: () => void
  onFrame?: (frame: WxworkFrame) => void | Promise<void>
  onDisconnected?: (reason: string) => void
  onError?: (error: Error) => void
}

export interface WxworkClientOptions {
  botId: string
  secret: string
  wsUrl: string
  heartbeatMs?: number
  requestTimeoutMs?: number
  reconnectBaseMs?: number
  reconnectMaxMs?: number
  maxReconnectAttempts?: number
  maxAuthFailures?: number
  random?: () => number
  socketFactory?: (url: string) => WxworkSocket
  callbacks?: WxworkClientCallbacks
}

interface PendingRequest {
  resolve: (frame: WxworkFrame) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

export class WxworkClient {
  private socket: WxworkSocket | null = null
  private generation = 0
  private authenticated = false
  private manualClose = false
  private kicked = false
  private authRequestId = ''
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private heartbeatRequests = new Set<string>()
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectAttempts = 0
  private authFailures = 0
  private readonly pending = new Map<string, PendingRequest>()

  constructor(private readonly options: WxworkClientOptions) {}

  isAuthenticated(): boolean { return this.authenticated }

  connect(): void {
    this.manualClose = false
    this.kicked = false
    this.clearReconnectTimer()
    this.replaceSocket()
    const generation = ++this.generation
    const socket = (this.options.socketFactory ?? (url => new WebSocket(url) as unknown as WxworkSocket))(this.options.wsUrl)
    this.socket = socket
    socket.on('open', () => {
      if (!this.isCurrent(generation, socket)) return
      this.authRequestId = generateWxworkRequestId(WxworkCommand.Subscribe)
      this.sendFrame(createSubscribeFrame(this.options.botId, this.options.secret, this.authRequestId))
    })
    socket.on('message', data => {
      if (!this.isCurrent(generation, socket)) return
      try { this.handleFrame(parseWxworkFrame(Buffer.isBuffer(data) ? data : String(data))) }
      catch (error) { this.report(error) }
    })
    socket.on('close', (code, reason) => {
      if (!this.isCurrent(generation, socket)) return
      this.socket = null
      this.authenticated = false
      this.stopHeartbeat()
      const detail = reason.toString() || `code ${code}`
      this.rejectPending(`wxwork WebSocket closed: ${detail}`)
      this.options.callbacks?.onDisconnected?.(detail)
      if (!this.manualClose && !this.kicked) this.scheduleReconnect()
    })
    socket.on('error', error => {
      if (this.isCurrent(generation, socket)) this.report(error)
    })
  }

  async waitForAuthentication(timeoutMs = 10_000): Promise<void> {
    if (this.authenticated) return
    await new Promise<void>((resolve, reject) => {
      const started = Date.now()
      const timer = setInterval(() => {
        if (this.authenticated) {
          clearInterval(timer)
          resolve()
        } else if (Date.now() - started >= timeoutMs) {
          clearInterval(timer)
          reject(new Error(`wxwork authentication timed out after ${timeoutMs} ms.`))
        }
      }, 25)
    })
  }

  disconnect(): void {
    this.manualClose = true
    this.generation++
    this.clearReconnectTimer()
    this.stopHeartbeat()
    this.rejectPending('wxwork client stopped.')
    this.replaceSocket()
    this.authenticated = false
  }

  async replyFinal(requestId: string, content: string): Promise<WxworkFrame> {
    return this.request(requestId, WxworkCommand.Respond, createFinalReplyBody(generateWxworkRequestId('stream'), content))
  }

  async replyMedia(requestId: string, type: WxworkMediaType, mediaId: string): Promise<WxworkFrame> {
    return this.request(requestId, WxworkCommand.Respond, createMediaReplyBody(type, mediaId))
  }

  async uploadMedia(path: string, type: WxworkMediaType): Promise<UploadedMedia> {
    const data = readFileSync(path)
    const maximum = WXWORK_MEDIA_LIMITS[type]
    if (data.length === 0 || data.length > maximum) throw new Error(`wxwork ${type} must be 1-${maximum} bytes.`)
    const totalChunks = Math.ceil(data.length / WXWORK_UPLOAD_CHUNK_BYTES)
    const init = await this.request(
      generateWxworkRequestId(WxworkCommand.UploadInit),
      WxworkCommand.UploadInit,
      {
        type,
        filename: path.split(/[\\/]/).at(-1) || `attachment.${type}`,
        total_size: data.length,
        total_chunks: totalChunks,
        md5: createHash('md5').update(data).digest('hex'),
      },
    )
    const uploadId = (init.body as { upload_id?: unknown } | undefined)?.upload_id
    if (typeof uploadId !== 'string' || !uploadId) throw new Error('wxwork media upload init did not return upload_id.')
    for (let index = 0; index < totalChunks; index++) {
      const chunk = data.subarray(index * WXWORK_UPLOAD_CHUNK_BYTES, (index + 1) * WXWORK_UPLOAD_CHUNK_BYTES)
      let error: Error | null = null
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          await this.request(generateWxworkRequestId(WxworkCommand.UploadChunk), WxworkCommand.UploadChunk, {
            upload_id: uploadId,
            chunk_index: index,
            base64_data: chunk.toString('base64'),
          })
          error = null
          break
        } catch (caught) {
          error = caught instanceof Error ? caught : new Error(String(caught))
          if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 100 * 2 ** attempt))
        }
      }
      if (error) throw error
    }
    const finish = await this.request(
      generateWxworkRequestId(WxworkCommand.UploadFinish),
      WxworkCommand.UploadFinish,
      { upload_id: uploadId },
    )
    const body = finish.body as { media_id?: unknown; created_at?: unknown; type?: unknown } | undefined
    if (typeof body?.media_id !== 'string') throw new Error('wxwork media upload finish did not return media_id.')
    return {
      type: body.type === type ? type : type,
      mediaId: body.media_id,
      createdAt: typeof body.created_at === 'string' ? body.created_at : new Date().toISOString(),
    }
  }

  request(requestId: string, cmd: string, body?: Record<string, unknown>): Promise<WxworkFrame> {
    if (!this.authenticated && cmd !== WxworkCommand.Subscribe) return Promise.reject(new Error('wxwork bot is not authenticated.'))
    if (this.pending.has(requestId)) return Promise.reject(new Error(`wxwork request ${requestId} is already pending.`))
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId)
        reject(new Error(`wxwork request ${requestId} timed out.`))
      }, this.options.requestTimeoutMs ?? 10_000)
      this.pending.set(requestId, { resolve, reject, timer })
      try { this.sendFrame({ cmd, headers: { req_id: requestId }, ...(body && { body }) }) }
      catch (error) {
        clearTimeout(timer)
        this.pending.delete(requestId)
        reject(error)
      }
    })
  }

  private handleFrame(frame: WxworkFrame): void {
    const requestId = frame.headers.req_id
    if (requestId === this.authRequestId) {
      if (frame.errcode !== 0) {
        this.authFailures++
        this.report(new Error(`wxwork authentication failed: ${frame.errmsg || 'unknown error'} (${frame.errcode ?? 'no code'}).`))
        if (this.authFailures >= (this.options.maxAuthFailures ?? 3)) this.manualClose = true
        this.socket?.terminate()
        return
      }
      this.authenticated = true
      this.authFailures = 0
      this.reconnectAttempts = 0
      this.startHeartbeat()
      this.options.callbacks?.onAuthenticated?.()
      return
    }
    if (this.heartbeatRequests.delete(requestId)) return
    const pending = this.pending.get(requestId)
    if (pending) {
      clearTimeout(pending.timer)
      this.pending.delete(requestId)
      if (frame.errcode !== undefined && frame.errcode !== 0) pending.reject(new Error(`wxwork ${frame.errmsg || 'request failed'} (${frame.errcode}).`))
      else pending.resolve(frame)
      return
    }
    if (frame.cmd === WxworkCommand.EventCallback) {
      const event = (frame.body as { event?: { eventtype?: unknown } } | undefined)?.event?.eventtype
      if (event === 'disconnected_event') {
        this.kicked = true
        this.options.callbacks?.onFrame?.(frame)
        this.socket?.terminate()
        return
      }
    }
    if (frame.cmd === WxworkCommand.MessageCallback || frame.cmd === WxworkCommand.EventCallback) {
      Promise.resolve(this.options.callbacks?.onFrame?.(frame)).catch(error => this.report(error))
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat()
    this.heartbeatTimer = setInterval(() => {
      if (this.heartbeatRequests.size >= 2) {
        this.report(new Error('wxwork heartbeat missed two consecutive acknowledgements.'))
        this.socket?.terminate()
        return
      }
      const frame = createPingFrame()
      this.heartbeatRequests.add(frame.headers.req_id)
      try { this.sendFrame(frame) } catch (error) { this.report(error) }
    }, this.options.heartbeatMs ?? 30_000)
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer)
    this.heartbeatTimer = null
    this.heartbeatRequests.clear()
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= (this.options.maxReconnectAttempts ?? 10)) {
      this.report(new Error('wxwork reconnect attempts exhausted.'))
      return
    }
    const attempt = this.reconnectAttempts++
    const base = this.options.reconnectBaseMs ?? 1_000
    const cap = this.options.reconnectMaxMs ?? 30_000
    const jitter = 0.8 + (this.options.random ?? Math.random)() * 0.4
    const delay = Math.floor(Math.min(cap, base * 2 ** attempt) * jitter)
    this.reconnectTimer = setTimeout(() => { this.reconnectTimer = null; this.connect() }, delay)
  }

  private sendFrame(frame: WxworkFrame): void {
    if (!this.socket || this.socket.readyState !== 1) throw new Error('wxwork WebSocket is not open.')
    this.socket.send(JSON.stringify(frame))
  }

  private isCurrent(generation: number, socket: WxworkSocket): boolean {
    return generation === this.generation && socket === this.socket
  }

  private replaceSocket(): void {
    const socket = this.socket
    this.socket = null
    if (!socket) return
    socket.removeAllListeners()
    try { socket.close(1000, 'client shutdown') } catch { socket.terminate() }
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
  }

  private rejectPending(message: string): void {
    for (const item of this.pending.values()) {
      clearTimeout(item.timer)
      item.reject(new Error(message))
    }
    this.pending.clear()
  }

  private report(error: unknown): void {
    const source = error instanceof Error ? error : new Error(String(error))
    const message = this.options.secret
      ? source.message.split(this.options.secret).join('[REDACTED]')
      : source.message
    this.options.callbacks?.onError?.(new Error(message))
  }
}
