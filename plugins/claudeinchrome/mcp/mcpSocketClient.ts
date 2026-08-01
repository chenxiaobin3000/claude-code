import { randomUUID } from 'node:crypto'
import { createConnection } from 'net'
import type { Socket } from 'net'

import type {
  ClaudeForChromeContext,
  PermissionMode,
  PermissionOverrides,
} from './types.js'
import { toLoggerDetail } from './types.js'
import {
  CHROME_TOOL_TIMEOUT_MS,
  isImplementedChromeToolName,
  MAX_CHROME_BRIDGE_MESSAGE_BYTES,
  type AuthenticatedChromeBridgeToolRequest,
  type ChromeBridgeToolRequest,
  type ChromeBridgeToolResponse,
} from '../protocol/index.js'

export class SocketConnectionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SocketConnectionError'
  }
}

type ToolRequestWithoutId = Omit<ChromeBridgeToolRequest, 'request_id'>
type ToolResponse = ChromeBridgeToolResponse

interface Notification {
  method: string
  params?: Record<string, unknown>
}

type SocketMessage = ToolResponse | Notification

function isToolResponse(message: SocketMessage): message is ToolResponse {
  return (
    'request_id' in message &&
    typeof message.request_id === 'string' &&
    ('result' in message || 'error' in message)
  )
}

function isNotification(message: SocketMessage): message is Notification {
  return 'method' in message && typeof message.method === 'string'
}

class McpSocketClient {
  private socket: Socket | null = null
  private connected = false
  private connecting = false
  private pendingResponses = new Map<
    string,
    {
      resolve: (response: ToolResponse) => void
      reject: (error: Error) => void
      timeout: NodeJS.Timeout
    }
  >()
  private notificationHandler: ((notification: Notification) => void) | null =
    null
  private responseBuffer = Buffer.alloc(0)
  private reconnectAttempts = 0
  private maxReconnectAttempts = 10
  private reconnectDelay = 1000
  private reconnectTimer: NodeJS.Timeout | null = null
  private context: ClaudeForChromeContext
  // When true, disables automatic reconnection. Used by McpSocketPool which
  // manages reconnection externally by rescanning available sockets.
  public disableAutoReconnect = false

  constructor(context: ClaudeForChromeContext) {
    this.context = context
  }

  private async connect(): Promise<void> {
    const { serverName, logger } = this.context

    if (this.connecting) {
      logger.info(
        `[${serverName}] Already connecting, skipping duplicate attempt`,
      )
      return
    }

    this.closeSocket()
    this.connecting = true

    const endpoint = this.context.endpoint
    if (!endpoint) {
      this.connecting = false
      throw new SocketConnectionError(
        `[${serverName}] No local Chrome TCP endpoint is available`,
      )
    }
    logger.info(
      `[${serverName}] Attempting to connect to Chrome endpoint ${endpoint.id} at ${endpoint.host}:${endpoint.port}`,
    )

    this.socket = createConnection({ host: endpoint.host, port: endpoint.port })

    // Timeout the initial connection attempt - if socket file exists but native
    // host is dead, the connect can hang indefinitely
    const connectTimeout = setTimeout(() => {
      if (!this.connected) {
        logger.info(`[${serverName}] Connection attempt timed out after 5000ms`)
        this.closeSocket()
        this.scheduleReconnect()
      }
    }, 5000)

    this.socket.on('connect', () => {
      clearTimeout(connectTimeout)
      this.connected = true
      this.connecting = false
      this.reconnectAttempts = 0
      logger.info(`[${serverName}] Successfully connected to bridge server`)
    })

    this.socket.on('data', (data: Buffer) => {
      this.responseBuffer = Buffer.concat([this.responseBuffer, data])

      while (this.responseBuffer.length >= 4) {
        const length = this.responseBuffer.readUInt32LE(0)

        if (length === 0 || length > MAX_CHROME_BRIDGE_MESSAGE_BYTES) {
          logger.info(
            `[${serverName}] Invalid bridge response length: ${length}`,
          )
          this.closeSocket()
          return
        }

        if (this.responseBuffer.length < 4 + length) {
          break
        }

        const messageBytes = this.responseBuffer.slice(4, 4 + length)
        this.responseBuffer = this.responseBuffer.slice(4 + length)

        try {
          const message = JSON.parse(
            messageBytes.toString('utf-8'),
          ) as SocketMessage

          if (isNotification(message)) {
            logger.info(
              `[${serverName}] Received notification: ${message.method}`,
            )
            if (this.notificationHandler) {
              this.notificationHandler(message)
            }
          } else if (isToolResponse(message)) {
            logger.info(`[${serverName}] Received tool response: ${message}`)
            this.handleResponse(message)
          } else {
            logger.info(`[${serverName}] Received unknown message: ${message}`)
          }
        } catch (error) {
          logger.info(
            `[${serverName}] Failed to parse message:`,
            toLoggerDetail(error),
          )
        }
      }
    })

    this.socket.on('error', (error: Error & { code?: string }) => {
      clearTimeout(connectTimeout)
      logger.info(
        `[${serverName}] Socket error (code: ${error.code}):`,
        toLoggerDetail(error),
      )
      this.connected = false
      this.connecting = false

      if (
        error.code &&
        [
          'ECONNREFUSED', // Native host not listening (stale socket)
          'ECONNRESET', // Connection reset by peer
          'EPIPE', // Broken pipe (native host died mid-write)
          'ENOENT', // Socket file was deleted
          'EOPNOTSUPP', // Socket file exists but is not a valid socket
          'ECONNABORTED', // Connection aborted
        ].includes(error.code)
      ) {
        this.scheduleReconnect()
      }
    })

    this.socket.on('close', () => {
      clearTimeout(connectTimeout)
      this.connected = false
      this.connecting = false
      this.scheduleReconnect()
    })
  }

  private scheduleReconnect(): void {
    const { serverName, logger } = this.context

    if (this.disableAutoReconnect) {
      return
    }

    if (this.reconnectTimer) {
      logger.info(`[${serverName}] Reconnect already scheduled, skipping`)
      return
    }

    this.reconnectAttempts++

    // Give up after extended polling (~50 min). A new ensureConnected() call
    // from a tool request will restart the cycle if needed.
    const maxTotalAttempts = 100
    if (this.reconnectAttempts > maxTotalAttempts) {
      logger.info(
        `[${serverName}] Giving up after ${maxTotalAttempts} attempts. Will retry on next tool call.`,
      )
      this.reconnectAttempts = 0
      return
    }

    // Use aggressive backoff for first 10 attempts, then slow poll every 30s.
    const delay = Math.min(
      this.reconnectDelay * 1.5 ** (this.reconnectAttempts - 1),
      30000,
    )

    if (this.reconnectAttempts <= this.maxReconnectAttempts) {
      logger.info(
        `[${serverName}] Reconnecting in ${Math.round(delay)}ms (attempt ${
          this.reconnectAttempts
        })`,
      )
    } else if (this.reconnectAttempts % 10 === 0) {
      // Log every 10th slow-poll attempt to avoid log spam
      logger.info(
        `[${serverName}] Still polling for native host (attempt ${this.reconnectAttempts})`,
      )
    }

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      void this.connect()
    }, delay)
  }

  private handleResponse(response: ToolResponse): void {
    const pending = this.pendingResponses.get(response.request_id)
    if (!pending) return
    this.pendingResponses.delete(response.request_id)
    clearTimeout(pending.timeout)
    pending.resolve(response)
  }

  public setNotificationHandler(
    handler: (notification: Notification) => void,
  ): void {
    this.notificationHandler = handler
  }

  public async ensureConnected(): Promise<boolean> {
    const { serverName } = this.context

    if (this.connected && this.socket) {
      return true
    }

    if (!this.socket && !this.connecting) {
      await this.connect()
    }

    // Wait for connection with timeout
    return new Promise((resolve, reject) => {
      let checkTimeoutId: NodeJS.Timeout | null = null

      const timeout = setTimeout(() => {
        if (checkTimeoutId) {
          clearTimeout(checkTimeoutId)
        }
        reject(
          new SocketConnectionError(
            `[${serverName}] Connection attempt timed out after 5000ms`,
          ),
        )
      }, 5000)

      const checkConnection = () => {
        if (this.connected) {
          clearTimeout(timeout)
          resolve(true)
        } else {
          checkTimeoutId = setTimeout(checkConnection, 500)
        }
      }
      checkConnection()
    })
  }

  private async sendRequest(
    requestWithoutId: ToolRequestWithoutId,
    timeoutMs = CHROME_TOOL_TIMEOUT_MS,
  ): Promise<ToolResponse> {
    const { serverName } = this.context

    if (!this.socket) {
      throw new SocketConnectionError(
        `[${serverName}] Cannot send request: not connected`,
      )
    }

    const socket = this.socket

    const request: AuthenticatedChromeBridgeToolRequest = {
      request_id: randomUUID(),
      auth_token: this.context.endpoint?.token ?? '',
      ...requestWithoutId,
    }
    const requestJson = JSON.stringify(request)
    const requestBytes = Buffer.from(requestJson, 'utf-8')
    if (
      requestBytes.length === 0 ||
      requestBytes.length > MAX_CHROME_BRIDGE_MESSAGE_BYTES
    ) {
      throw new Error(
        `[${serverName}] Bridge request exceeds ${MAX_CHROME_BRIDGE_MESSAGE_BYTES} bytes`,
      )
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingResponses.delete(request.request_id)
        reject(
          new SocketConnectionError(
            `[${serverName}] Tool request timed out after ${timeoutMs}ms`,
          ),
        )
      }, timeoutMs)

      this.pendingResponses.set(request.request_id, {
        resolve,
        reject,
        timeout,
      })

      const lengthPrefix = Buffer.allocUnsafe(4)
      lengthPrefix.writeUInt32LE(requestBytes.length, 0)

      const message = Buffer.concat([lengthPrefix, requestBytes])
      socket.write(message)
    })
  }

  public async callTool(
    name: string,
    args: Record<string, unknown>,
    _permissionOverrides?: PermissionOverrides,
  ): Promise<unknown> {
    if (!isImplementedChromeToolName(name)) {
      throw new Error(`Chrome tool "${name}" is not implemented`)
    }
    const request: ToolRequestWithoutId = {
      method: 'execute_tool',
      params: {
        client_id: this.context.clientTypeId,
        tool: name,
        args,
      },
    }

    return this.sendRequestWithRetry(request)
  }

  /**
   * Send a request with automatic retry on connection errors.
   *
   * On connection error or timeout, the native host may be a zombie (connected
   * to dead Chrome). Force reconnect to pick up a fresh native host process
   * and retry once.
   */
  private async sendRequestWithRetry(
    request: ToolRequestWithoutId,
  ): Promise<unknown> {
    const { serverName, logger } = this.context

    try {
      return await this.sendRequest(request)
    } catch (error) {
      if (!(error instanceof SocketConnectionError)) {
        throw error
      }

      logger.info(
        `[${serverName}] Connection error, forcing reconnect and retrying: ${error.message}`,
      )

      this.closeSocket()
      await this.ensureConnected()

      return await this.sendRequest(request)
    }
  }

  public async setPermissionMode(
    _mode: PermissionMode,
    _allowedDomains?: string[],
  ): Promise<void> {
    // No-op: permission mode is only supported over the bridge (WebSocket) transport
  }

  public isConnected(): boolean {
    return this.connected
  }

  private closeSocket(): void {
    if (this.socket) {
      this.socket.removeAllListeners()
      this.socket.end()
      this.socket.destroy()
      this.socket = null
    }
    this.connected = false
    this.connecting = false
    this.rejectPendingResponses()
  }

  private rejectPendingResponses(): void {
    if (this.pendingResponses.size === 0) return
    const error = new SocketConnectionError(
      `[${this.context.serverName}] Bridge connection closed`,
    )
    for (const pending of this.pendingResponses.values()) {
      clearTimeout(pending.timeout)
      pending.reject(error)
    }
    this.pendingResponses.clear()
  }

  private cleanup(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }

    this.closeSocket()
    this.reconnectAttempts = 0
    this.responseBuffer = Buffer.alloc(0)
    this.rejectPendingResponses()
  }

  public disconnect(): void {
    this.cleanup()
  }
}

export function createMcpSocketClient(
  context: ClaudeForChromeContext,
): McpSocketClient {
  return new McpSocketClient(context)
}

export type { McpSocketClient }
