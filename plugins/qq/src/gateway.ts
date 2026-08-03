import WebSocket from 'ws'
import { loadQqState, saveQqState } from './config.js'
import { heartbeatPayload, identifyPayload, normalizeQqDispatch, resumePayload } from './protocol.js'
import { GatewayEvent, GatewayOp, type GatewayPayload, type QqInboundMessage, type QqSessionState } from './types.js'
import type { QqApiClient } from './api.js'

export interface QqSocket {
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
export interface QqGatewayOptions {
  alias: string
  api: Pick<QqApiClient, 'getToken' | 'getGatewayUrl' | 'clearToken'>
  socketFactory?: (url: string) => QqSocket
  random?: () => number
  reconnectBaseMs?: number
  reconnectMaxMs?: number
  maxReconnectAttempts?: number
  onReady?: () => void
  onMessage?: (message: QqInboundMessage) => void | Promise<void>
  onError?: (error: Error) => void
  onDisconnected?: (reason: string) => void
}

export class QqGateway {
  private socket: QqSocket | null = null
  private generation = 0
  private stopped = false
  private ready = false
  private fatal = false
  private session: QqSessionState | null
  private heartbeat: ReturnType<typeof setInterval> | null = null
  private heartbeatAcknowledged = true
  private reconnect: ReturnType<typeof setTimeout> | null = null
  private attempts = 0
  constructor(private readonly options: QqGatewayOptions) { this.session = loadQqState<QqSessionState | null>(options.alias, 'session.json', null) }
  isReady(): boolean { return this.ready }
  start(): void { this.stopped = false; this.fatal = false; void this.connect() }
  stop(): void {
    this.stopped = true
    this.generation++
    this.stopHeartbeat()
    if (this.reconnect) clearTimeout(this.reconnect)
    this.reconnect = null
    const socket = this.socket
    this.socket = null
    socket?.removeAllListeners()
    try { socket?.close(1000, 'Host stopped') } catch { socket?.terminate() }
    this.ready = false
  }
  async waitUntilReady(timeoutMs = 10_000): Promise<void> {
    const started = Date.now()
    while (!this.ready) {
      if (this.fatal) throw new Error(`QQ bot ${this.options.alias} cannot connect due to a fatal Gateway error.`)
      if (Date.now() - started >= timeoutMs) throw new Error(`QQ bot ${this.options.alias} Gateway timed out.`)
      await new Promise(resolve => setTimeout(resolve, 25))
    }
  }
  private async connect(): Promise<void> {
    if (this.stopped || this.fatal) return
    const generation = ++this.generation
    try {
      const token = await this.options.api.getToken()
      const url = await this.options.api.getGatewayUrl()
      if (generation !== this.generation || this.stopped) return
      const socket = (this.options.socketFactory ?? (value => new WebSocket(value, { headers: { 'User-Agent': 'claude-code-qq/1.0' } }) as unknown as QqSocket))(url)
      this.socket = socket
      socket.on('open', () => { if (this.current(generation, socket)) this.attempts = 0 })
      socket.on('message', data => {
        if (!this.current(generation, socket)) return
        try { this.handle(JSON.parse(Buffer.isBuffer(data) ? data.toString() : String(data)) as GatewayPayload, socket, token) } catch (error) { this.report(error) }
      })
      socket.on('close', (code, reason) => {
        if (!this.current(generation, socket)) return
        this.socket = null
        this.ready = false
        this.stopHeartbeat()
        this.options.onDisconnected?.(reason.toString() || `code ${code}`)
        this.handleClose(code)
      })
      socket.on('error', error => { if (this.current(generation, socket)) this.report(error) })
    } catch (error) { if (generation === this.generation) { this.report(error); this.scheduleReconnect() } }
  }
  private handle(payload: GatewayPayload, socket: QqSocket, token: string): void {
    if (typeof payload.s === 'number') {
      if (this.session) this.session.lastSeq = payload.s
      if (this.session) saveQqState(this.options.alias, 'session.json', this.session)
    }
    if (payload.op === GatewayOp.Hello) {
      const interval = (payload.d as { heartbeat_interval?: unknown } | undefined)?.heartbeat_interval
      if (typeof interval !== 'number' || interval < 100) throw new Error('QQ Gateway HELLO is missing a valid heartbeat interval.')
      socket.send(JSON.stringify(this.session?.sessionId && this.session.lastSeq !== null ? resumePayload(token, this.session.sessionId, this.session.lastSeq) : identifyPayload(token)))
      this.startHeartbeat(socket, interval)
      return
    }
    if (payload.op === GatewayOp.HeartbeatAck) { this.heartbeatAcknowledged = true; return }
    if (payload.op === GatewayOp.Reconnect) { socket.terminate(); return }
    if (payload.op === GatewayOp.InvalidSession) {
      if (payload.d !== true) this.clearSession()
      socket.terminate()
      return
    }
    if (payload.op !== GatewayOp.Dispatch || !payload.t) return
    if (payload.t === GatewayEvent.Ready) {
      const id = (payload.d as { session_id?: unknown } | undefined)?.session_id
      if (typeof id !== 'string') throw new Error('QQ READY is missing session_id.')
      this.session = { sessionId: id, lastSeq: typeof payload.s === 'number' ? payload.s : null }
      saveQqState(this.options.alias, 'session.json', this.session)
      this.ready = true
      this.options.onReady?.()
      return
    }
    if (payload.t === GatewayEvent.Resumed) { this.ready = true; this.options.onReady?.(); return }
    const message = normalizeQqDispatch(this.options.alias, payload.t, payload.d)
    if (message) Promise.resolve(this.options.onMessage?.(message)).catch(error => this.report(error))
  }
  private startHeartbeat(socket: QqSocket, interval: number): void {
    this.stopHeartbeat()
    this.heartbeatAcknowledged = true
    this.heartbeat = setInterval(() => {
      if (!this.heartbeatAcknowledged) { this.report(new Error('QQ Gateway missed a heartbeat acknowledgement.')); socket.terminate(); return }
      this.heartbeatAcknowledged = false
      socket.send(JSON.stringify(heartbeatPayload(this.session?.lastSeq ?? null)))
    }, interval)
  }
  private stopHeartbeat(): void { if (this.heartbeat) clearInterval(this.heartbeat); this.heartbeat = null; this.heartbeatAcknowledged = true }
  private handleClose(code: number): void {
    if (this.stopped || code === 1000) return
    if (code === 4914 || code === 4915) { this.fatal = true; this.report(new Error(`QQ Gateway rejected Bot intents (${code}).`)); return }
    if (code === 4004) this.options.api.clearToken()
    if ([4006, 4007, 4009].includes(code)) { this.clearSession(); this.options.api.clearToken() }
    this.scheduleReconnect(code === 4008 ? 60_000 : undefined)
  }
  private clearSession(): void { this.session = null; saveQqState(this.options.alias, 'session.json', null) }
  private scheduleReconnect(delayOverride?: number): void {
    if (this.stopped || this.fatal || this.reconnect) return
    if (this.attempts >= (this.options.maxReconnectAttempts ?? 10)) { this.fatal = true; this.report(new Error('QQ Gateway reconnect attempts exhausted.')); return }
    const base = this.options.reconnectBaseMs ?? 1_000
    const cap = this.options.reconnectMaxMs ?? 60_000
    const jitter = 0.8 + (this.options.random ?? Math.random)() * 0.4
    const delay = delayOverride ?? Math.floor(Math.min(cap, base * 2 ** this.attempts) * jitter)
    this.attempts++
    this.reconnect = setTimeout(() => { this.reconnect = null; void this.connect() }, delay)
  }
  private current(generation: number, socket: QqSocket): boolean { return generation === this.generation && socket === this.socket }
  private report(error: unknown): void { this.options.onError?.(error instanceof Error ? error : new Error(String(error))) }
}
