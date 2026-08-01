// biome-ignore-all lint/suspicious/noConsole: file uses console intentionally
/**
 * Chrome Native Host - Pure TypeScript Implementation
 *
 * This module provides the Chrome native messaging host functionality,
 * previously implemented as a Rust NAPI binding but now in pure TypeScript.
 */

import { randomBytes, randomUUID } from 'node:crypto'
import {
  chmod,
  mkdir,
  readFile,
  readdir,
  rename,
  rmdir,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { createServer, type Server, type Socket } from 'node:net'
import { join } from 'node:path'
import {
  isImplementedChromeToolName,
  MAX_CHROME_BRIDGE_MESSAGE_BYTES,
  type AuthenticatedChromeBridgeToolRequest,
} from '../mcp/index.js'
import { z } from 'zod'
import type { ChromeSocketEndpoint } from '../protocol/index.js'
import {
  CHROME_SOCKET_HOST,
  getEndpointDescriptorPath,
  getSocketDirectory,
  isChromeSocketEndpoint,
} from './paths.js'

const VERSION = '1.0.0'

function log(message: string, ...args: unknown[]): void {
  console.error(`[Claude Chrome Native Host] ${message}`, ...args)
}

function jsonParse(value: string): unknown {
  return JSON.parse(value)
}

function jsonStringify(value: unknown): string {
  return JSON.stringify(value)
}
/**
 * Send a message to stdout (Chrome native messaging protocol)
 */
export function sendChromeMessage(message: string): void {
  const jsonBytes = Buffer.from(message, 'utf-8')
  if (
    jsonBytes.length === 0 ||
    jsonBytes.length > MAX_CHROME_BRIDGE_MESSAGE_BYTES
  ) {
    throw new Error(
      `Chrome Native Messaging payload must be between 1 and ${MAX_CHROME_BRIDGE_MESSAGE_BYTES} bytes`,
    )
  }
  const lengthBuffer = Buffer.alloc(4)
  lengthBuffer.writeUInt32LE(jsonBytes.length, 0)

  process.stdout.write(lengthBuffer)
  process.stdout.write(jsonBytes)
}

export async function runChromeNativeHost(): Promise<void> {
  log('Initializing...')

  const host = new ChromeNativeHost()
  const messageReader = new ChromeMessageReader()

  // Start the native host server
  await host.start()

  // Process messages from Chrome until stdin closes
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  while (true) {
    const message = await messageReader.read()
    if (message === null) {
      // stdin closed, Chrome disconnected
      break
    }

    await host.handleMessage(message)
  }

  // Stop the server
  await host.stop()
}

const messageSchema = z
  .object({
    type: z.string(),
  })
  .passthrough()

type McpClient = {
  id: number
  socket: Socket
  buffer: Buffer
}

export class ChromeNativeHost {
  private mcpClients = new Map<number, McpClient>()
  private requestOwners = new Map<string, number>()
  private nextClientId = 1
  private server: Server | null = null
  private running = false
  private endpoint: ChromeSocketEndpoint | null = null
  private descriptorPath: string | null = null

  async start(): Promise<void> {
    if (this.running) {
      return
    }

    const socketDir = getSocketDirectory()
    await mkdir(socketDir, { recursive: true, mode: 0o700 })
    await chmod(socketDir, 0o700).catch(() => {
      // Windows does not implement POSIX modes; the token still authenticates clients.
    })

    // Remove discovery records whose owning Native Host process no longer exists.
    try {
      for (const file of await readdir(socketDir)) {
        if (!file.endsWith('.json')) continue
        const path = join(socketDir, file)
        try {
          const candidate: unknown = JSON.parse(await readFile(path, 'utf8'))
          if (!isChromeSocketEndpoint(candidate)) {
            await unlink(path)
            continue
          }
          try {
            process.kill(candidate.pid, 0)
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'EPERM') {
              await unlink(path).catch(() => {})
              log(`Removed stale endpoint for PID ${candidate.pid}`)
            }
          }
        } catch {
          await unlink(path).catch(() => {})
        }
      }
    } catch {
      // Ignore discovery cleanup errors; publishing this instance may still work.
    }

    log(`Creating TCP listener on ${CHROME_SOCKET_HOST}`)

    this.server = createServer(socket => this.handleMcpClient(socket))

    await new Promise<void>((resolve, reject) => {
      this.server!.listen({ host: CHROME_SOCKET_HOST, port: 0 }, () => {
        this.running = true
        resolve()
      })

      this.server!.on('error', err => {
        log('Socket server error:', err)
        reject(err)
      })
    })

    const address = this.server.address()
    if (!address || typeof address === 'string') {
      throw new Error('TCP listener did not return a numeric loopback port')
    }
    const id = `${process.pid}-${randomUUID().replaceAll('-', '')}`
    this.endpoint = {
      id,
      host: CHROME_SOCKET_HOST,
      port: address.port,
      token: randomBytes(32).toString('hex'),
      pid: process.pid,
    }
    this.descriptorPath = getEndpointDescriptorPath(id)
    const temporaryDescriptorPath = `${this.descriptorPath}.tmp`
    try {
      await writeFile(
        temporaryDescriptorPath,
        `${JSON.stringify(this.endpoint)}\n`,
        {
          encoding: 'utf8',
          mode: 0o600,
          flag: 'wx',
        },
      )
      await rename(temporaryDescriptorPath, this.descriptorPath)
    } catch (error) {
      await unlink(temporaryDescriptorPath).catch(() => {})
      await new Promise<void>(resolve => this.server!.close(() => resolve()))
      this.server = null
      this.running = false
      this.endpoint = null
      this.descriptorPath = null
      throw error
    }
    await chmod(this.descriptorPath, 0o600).catch(() => {})
    log(`TCP server listening on ${CHROME_SOCKET_HOST}:${address.port}`)
  }

  async stop(): Promise<void> {
    if (!this.running) {
      return
    }

    // Close all MCP clients
    for (const [, client] of this.mcpClients) {
      client.socket.destroy()
    }
    this.mcpClients.clear()
    this.requestOwners.clear()

    // Close server
    if (this.server) {
      await new Promise<void>(resolve => {
        this.server!.close(() => resolve())
      })
      this.server = null
    }

    if (this.descriptorPath) {
      await unlink(this.descriptorPath).catch(() => {})
      log('Cleaned up TCP endpoint record')
    }
    try {
      const socketDir = getSocketDirectory()
      const remaining = await readdir(socketDir)
      if (remaining.length === 0) await rmdir(socketDir)
    } catch {
      // Ignore
    }

    this.endpoint = null
    this.descriptorPath = null
    this.running = false
  }

  async isRunning(): Promise<boolean> {
    return this.running
  }

  async getClientCount(): Promise<number> {
    return this.mcpClients.size
  }

  async handleMessage(messageJson: string): Promise<void> {
    let rawMessage: unknown
    try {
      rawMessage = jsonParse(messageJson)
    } catch (e) {
      log('Invalid JSON from Chrome:', (e as Error).message)
      sendChromeMessage(
        jsonStringify({
          type: 'error',
          error: 'Invalid message format',
        }),
      )
      return
    }
    const parsed = messageSchema.safeParse(rawMessage)
    if (!parsed.success) {
      log('Invalid message from Chrome:', parsed.error.message)
      sendChromeMessage(
        jsonStringify({
          type: 'error',
          error: 'Invalid message format',
        }),
      )
      return
    }
    const message = parsed.data

    log(`Handling Chrome message type: ${message.type}`)

    switch (message.type) {
      case 'ping':
        log('Responding to ping')

        sendChromeMessage(
          jsonStringify({
            type: 'pong',
            timestamp: Date.now(),
          }),
        )
        break

      case 'get_status':
        sendChromeMessage(
          jsonStringify({
            type: 'status_response',
            native_host_version: VERSION,
          }),
        )
        break

      case 'tool_response': {
        const requestId = message.request_id
        if (typeof requestId !== 'string' || requestId.length === 0) {
          log('Dropping tool response without request_id')
          break
        }
        const clientId = this.requestOwners.get(requestId)
        this.requestOwners.delete(requestId)
        if (clientId === undefined) {
          log(`Dropping tool response for unknown request ${requestId}`)
          break
        }
        const client = this.mcpClients.get(clientId)
        if (!client) {
          log(`Dropping tool response for disconnected client ${clientId}`)
          break
        }

        const { type: _, ...data } = message
        try {
          this.writeMcpResponse(client, data)
        } catch (e) {
          log(`Failed to send response to MCP client ${clientId}:`, e)
        }
        break
      }

      case 'notification': {
        if (this.mcpClients.size > 0) {
          log(`Forwarding notification to ${this.mcpClients.size} MCP clients`)

          // Extract the data portion (everything except 'type')
          const { type: _, ...data } = message
          const notificationData = Buffer.from(jsonStringify(data), 'utf-8')
          if (
            notificationData.length === 0 ||
            notificationData.length > MAX_CHROME_BRIDGE_MESSAGE_BYTES
          ) {
            log('Dropping oversized Chrome notification')
            break
          }
          const lengthBuffer = Buffer.alloc(4)
          lengthBuffer.writeUInt32LE(notificationData.length, 0)
          const notificationMsg = Buffer.concat([
            lengthBuffer,
            notificationData,
          ])

          for (const [id, client] of this.mcpClients) {
            try {
              client.socket.write(notificationMsg)
            } catch (e) {
              log(`Failed to send notification to MCP client ${id}:`, e)
            }
          }
        }
        break
      }

      default:
        log(`Unknown message type: ${message.type}`)

        sendChromeMessage(
          jsonStringify({
            type: 'error',
            error: `Unknown message type: ${message.type}`,
          }),
        )
    }
  }

  private handleMcpClient(socket: Socket): void {
    const clientId = this.nextClientId++
    const client: McpClient = {
      id: clientId,
      socket,
      buffer: Buffer.alloc(0),
    }

    this.mcpClients.set(clientId, client)
    log(
      `MCP client ${clientId} connected. Total clients: ${this.mcpClients.size}`,
    )

    // Notify Chrome of connection
    sendChromeMessage(
      jsonStringify({
        type: 'mcp_connected',
      }),
    )

    socket.on('data', (data: Buffer) => {
      client.buffer = Buffer.concat([client.buffer, data])

      // Process complete messages
      while (client.buffer.length >= 4) {
        const length = client.buffer.readUInt32LE(0)

        if (length === 0 || length > MAX_CHROME_BRIDGE_MESSAGE_BYTES) {
          log(`Invalid message length from MCP client ${clientId}: ${length}`)
          socket.destroy()
          return
        }

        if (client.buffer.length < 4 + length) {
          break // Wait for more data
        }

        const messageBytes = client.buffer.slice(4, 4 + length)
        client.buffer = client.buffer.slice(4 + length)

        try {
          const request = jsonParse(
            messageBytes.toString('utf-8'),
          ) as Partial<AuthenticatedChromeBridgeToolRequest>
          if (
            typeof request.request_id !== 'string' ||
            request.request_id.length === 0 ||
            request.auth_token !== this.endpoint?.token ||
            request.method !== 'execute_tool' ||
            !request.params ||
            typeof request.params.tool !== 'string' ||
            !isImplementedChromeToolName(request.params.tool)
          ) {
            log(`Rejecting invalid tool request from MCP client ${clientId}`)
            socket.destroy()
            return
          }
          if (this.requestOwners.has(request.request_id)) {
            log(`Rejecting duplicate request_id ${request.request_id}`)
            socket.destroy()
            return
          }
          this.requestOwners.set(request.request_id, clientId)
          log(
            `Forwarding tool request from MCP client ${clientId}: ${request.method}`,
          )

          // Forward to Chrome
          const nativeRequest = jsonStringify({
            type: 'tool_request',
            request_id: request.request_id,
            method: request.method,
            params: request.params,
          })
          if (
            Buffer.byteLength(nativeRequest, 'utf8') >
            MAX_CHROME_BRIDGE_MESSAGE_BYTES
          ) {
            this.requestOwners.delete(request.request_id)
            this.writeMcpResponse(client, {
              request_id: request.request_id,
              error: {
                content: [
                  {
                    type: 'text',
                    text: `Chrome tool request exceeds the ${MAX_CHROME_BRIDGE_MESSAGE_BYTES}-byte bridge limit.`,
                  },
                ],
              },
            })
            continue
          }
          sendChromeMessage(nativeRequest)
        } catch (e) {
          log(`Failed to parse tool request from MCP client ${clientId}:`, e)
        }
      }
    })

    socket.on('error', err => {
      log(`MCP client ${clientId} error: ${err}`)
    })

    socket.on('close', () => {
      log(
        `MCP client ${clientId} disconnected. Remaining clients: ${this.mcpClients.size - 1}`,
      )
      this.mcpClients.delete(clientId)
      for (const [requestId, ownerId] of this.requestOwners) {
        if (ownerId === clientId) this.requestOwners.delete(requestId)
      }

      // Keep the extension connected while another MCP client still owns the
      // shared Native Host socket. Only the final client changes bridge state.
      if (this.mcpClients.size === 0) {
        sendChromeMessage(
          jsonStringify({
            type: 'mcp_disconnected',
          }),
        )
      }
    })
  }

  private writeMcpResponse(client: McpClient, response: unknown): void {
    const responseData = Buffer.from(jsonStringify(response), 'utf8')
    if (
      responseData.length === 0 ||
      responseData.length > MAX_CHROME_BRIDGE_MESSAGE_BYTES
    ) {
      log(`Dropping oversized response to MCP client ${client.id}`)
      return
    }
    const lengthBuffer = Buffer.alloc(4)
    lengthBuffer.writeUInt32LE(responseData.length, 0)
    client.socket.write(Buffer.concat([lengthBuffer, responseData]))
  }
}

/**
 * Chrome message reader using async stdin. Synchronous reads can crash Bun, so we use
 * async reads with a buffer.
 */
class ChromeMessageReader {
  private buffer = Buffer.alloc(0)
  private pendingResolve: ((value: string | null) => void) | null = null
  private closed = false

  constructor() {
    process.stdin.on('data', (chunk: Buffer) => {
      this.buffer = Buffer.concat([this.buffer, chunk])
      this.tryProcessMessage()
    })

    process.stdin.on('end', () => {
      this.closed = true
      if (this.pendingResolve) {
        this.pendingResolve(null)
        this.pendingResolve = null
      }
    })

    process.stdin.on('error', () => {
      this.closed = true
      if (this.pendingResolve) {
        this.pendingResolve(null)
        this.pendingResolve = null
      }
    })
  }

  private tryProcessMessage(): void {
    if (!this.pendingResolve) {
      return
    }

    // Need at least 4 bytes for length prefix
    if (this.buffer.length < 4) {
      return
    }

    const length = this.buffer.readUInt32LE(0)

    if (length === 0 || length > MAX_CHROME_BRIDGE_MESSAGE_BYTES) {
      log(`Invalid message length: ${length}`)
      this.pendingResolve(null)
      this.pendingResolve = null
      return
    }

    // Check if we have the full message
    if (this.buffer.length < 4 + length) {
      return // Wait for more data
    }

    // Extract the message
    const messageBytes = this.buffer.subarray(4, 4 + length)
    this.buffer = this.buffer.subarray(4 + length)

    const message = messageBytes.toString('utf-8')
    this.pendingResolve(message)
    this.pendingResolve = null
  }

  async read(): Promise<string | null> {
    if (this.closed) {
      return null
    }

    // Check if we already have a complete message buffered
    if (this.buffer.length >= 4) {
      const length = this.buffer.readUInt32LE(0)
      if (
        length > 0 &&
        length <= MAX_CHROME_BRIDGE_MESSAGE_BYTES &&
        this.buffer.length >= 4 + length
      ) {
        const messageBytes = this.buffer.subarray(4, 4 + length)
        this.buffer = this.buffer.subarray(4 + length)
        return messageBytes.toString('utf-8')
      }
    }

    // Wait for more data
    return new Promise(resolve => {
      this.pendingResolve = resolve
      // In case data arrived between check and setting pendingResolve
      this.tryProcessMessage()
    })
  }
}
