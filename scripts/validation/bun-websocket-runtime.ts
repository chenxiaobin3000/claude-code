#!/usr/bin/env bun

import { WebSocketTransport as CliWebSocketTransport } from '../../src/cli/transports/WebSocketTransport.js'
import { WebSocketTransport as McpWebSocketTransport } from '../../src/utils/mcpWebSocketTransport.js'
import { assert, assertDeepEqual, assertEqual } from './assertions.js'

const timeoutMs = 10_000

function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  return Promise.race([
    promise,
    Bun.sleep(timeoutMs).then(() => {
      throw new Error(`Timed out waiting for ${label}`)
    }),
  ])
}

class CliProbeTransport extends CliWebSocketTransport {
  sendRaw(value: string): boolean {
    return this.sendLine(value)
  }
}

const server = Bun.serve({
  hostname: '127.0.0.1',
  port: 0,
  fetch(request, bunServer) {
    if (new URL(request.url).pathname !== '/ws') {
      return new Response('not found', { status: 404 })
    }
    return bunServer.upgrade(request)
      ? undefined
      : new Response('upgrade failed', { status: 400 })
  },
  websocket: {
    message(socket, message) {
      socket.send(message)
    },
  },
})

const url = new URL(`ws://127.0.0.1:${server.port}/ws`)

try {
  let resolveConnected!: () => void
  const connected = new Promise<void>(resolve => {
    resolveConnected = resolve
  })
  let resolveCliData!: (value: string) => void
  const cliData = new Promise<string>(resolve => {
    resolveCliData = resolve
  })
  const cliTransport = new CliProbeTransport(url, {
    'X-Bun-Only-Fixture': 'true',
  })
  cliTransport.setOnConnect(resolveConnected)
  cliTransport.setOnData(resolveCliData)
  await cliTransport.connect()
  await withTimeout(connected, 'CLI WebSocket connection')
  assert(cliTransport.sendRaw('cli-native-websocket'), 'CLI send failed')
  assertEqual(
    await withTimeout(cliData, 'CLI WebSocket echo'),
    'cli-native-websocket',
    'CLI native WebSocket payload changed',
  )
  cliTransport.close()

  const nativeSocket = new globalThis.WebSocket(url)
  const mcpTransport = new McpWebSocketTransport(nativeSocket)
  let resolveMcpMessage!: (value: unknown) => void
  const mcpMessage = new Promise<unknown>(resolve => {
    resolveMcpMessage = resolve
  })
  mcpTransport.onmessage = resolveMcpMessage
  await withTimeout(mcpTransport.start(), 'MCP WebSocket connection')
  const notification = {
    jsonrpc: '2.0' as const,
    method: 'notifications/initialized',
  }
  await mcpTransport.send(notification)
  assertDeepEqual(
    await withTimeout(mcpMessage, 'MCP WebSocket echo'),
    notification,
    'MCP native WebSocket JSON-RPC payload changed',
  )
  await mcpTransport.close()

  assert(typeof Bun.version === 'string', 'fixture must execute under Bun')
} finally {
  await server.stop(true)
}

console.log('[bun-websocket-runtime] PASS (CLI and MCP native WebSocket paths)')
