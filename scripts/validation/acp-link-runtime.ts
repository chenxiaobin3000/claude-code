#!/usr/bin/env bun

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { encodeWebSocketAuthProtocol } from '../../packages/acp-link/src/ws-auth.js'
import { MAX_CLIENT_WS_PAYLOAD_BYTES } from '../../packages/acp-link/src/ws-message.js'
import { assert, assertDeepEqual, assertEqual } from './assertions.js'

const root = resolve(import.meta.dir, '../..')
const cli = join(root, 'packages', 'acp-link', 'src', 'cli', 'bin.ts')
const agentFixture = join(
  root,
  'scripts',
  'validation',
  'fixtures',
  'acp-link-agent.ts',
)
const token = 'acp-link-runtime-fixture-token'
const timeoutMs = 15_000

type Child = Bun.Subprocess<'ignore', 'pipe', 'pipe'>
const childLogs = new WeakMap<Child, string[]>()

async function reservePort(): Promise<number> {
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: () => new Response('reserved'),
  })
  const port = server.port
  await server.stop(true)
  return port
}

function spawnCli(
  args: string[],
  env: Record<string, string | undefined> = {},
): Child {
  const child = Bun.spawn([process.execPath, cli, ...args], {
    cwd: root,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      ...process.env,
      ACP_AUTH_TOKEN: token,
      ACP_RCS_URL: undefined,
      ACP_RCS_TOKEN: undefined,
      ACP_RCS_GROUP: undefined,
      ...env,
    },
  })
  const logs: string[] = []
  childLogs.set(child, logs)
  const collect = async (stream: ReadableStream<Uint8Array>) => {
    const reader = stream.getReader()
    const decoder = new TextDecoder()
    while (true) {
      const result = await reader.read()
      if (result.done) break
      logs.push(decoder.decode(result.value, { stream: true }))
    }
  }
  void collect(child.stdout)
  void collect(child.stderr)
  return child
}

async function stopChild(child: Child): Promise<void> {
  if (child.exitCode === null) child.kill()
  await Promise.race([
    child.exited,
    Bun.sleep(3_000).then(() => {
      if (child.exitCode === null) child.kill(9)
    }),
  ])
}

async function childFailure(child: Child, label: string): Promise<Error> {
  return new Error(
    `${label} exited before readiness (code ${child.exitCode})\n${childLogs.get(child)?.join('') ?? ''}`,
  )
}

async function waitForResponse(
  child: Child,
  url: string,
  init?: RequestInit & { tls?: { rejectUnauthorized: boolean } },
): Promise<Response> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw await childFailure(child, url)
    try {
      const response = await fetch(url, init)
      if (response.ok) return response
    } catch {
      // Server or generated TLS certificate is not ready yet.
    }
    await Bun.sleep(50)
  }
  throw new Error(`Timed out waiting for ${url}`)
}

function waitForWebSocket(
  url: string,
  protocols: string | string[] | undefined,
  action: (socket: WebSocket) => void,
  accept: (event: MessageEvent | CloseEvent) => unknown,
): Promise<MessageEvent | CloseEvent> {
  return new Promise((resolvePromise, reject) => {
    const socket = protocols
      ? new WebSocket(url, protocols)
      : new WebSocket(url)
    const timer = setTimeout(() => {
      socket.close()
      reject(new Error(`Timed out waiting for WebSocket result from ${url}`))
    }, timeoutMs)
    const complete = (event: MessageEvent | CloseEvent) => {
      try {
        if (!accept(event)) return
        clearTimeout(timer)
        resolvePromise(event)
      } catch (error) {
        clearTimeout(timer)
        socket.close()
        reject(error)
      }
    }
    socket.addEventListener('error', () => {
      // Authentication and payload failures are asserted through close codes.
    })
    socket.addEventListener('message', complete)
    socket.addEventListener('close', complete)
    socket.addEventListener('open', () => action(socket), { once: true })
  })
}

function verifyAgentBridge(
  child: Child,
  url: string,
  protocol: string,
): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const socket = new WebSocket(url, protocol)
    const timer = setTimeout(() => {
      socket.close()
      reject(
        new Error(
          `Timed out waiting for ACP agent bridge flow\n${childLogs.get(child)?.join('') ?? ''}`,
        ),
      )
    }, timeoutMs)
    const fail = (error: unknown) => {
      clearTimeout(timer)
      socket.close()
      reject(error)
    }
    socket.addEventListener('open', () => {
      socket.send(JSON.stringify({ type: 'connect' }))
    })
    socket.addEventListener('message', event => {
      try {
        const message = JSON.parse(String(event.data)) as {
          type?: string
          payload?: Record<string, unknown>
        }
        if (message.type === 'status' && message.payload?.connected === true) {
          assertEqual(
            (message.payload.agentInfo as { name?: string } | undefined)?.name,
            'acp-link-fixture',
            'ACP initialize result was not relayed',
          )
          socket.send(JSON.stringify({ type: 'new_session', payload: {} }))
          return
        }
        if (message.type === 'session_created') {
          assertEqual(
            message.payload?.sessionId,
            'fixture-session',
            'ACP new session result was not relayed',
          )
          socket.send(
            JSON.stringify({
              type: 'prompt',
              payload: { content: [{ type: 'text', text: 'fixture-input' }] },
            }),
          )
          return
        }
        if (message.type === 'permission_request') {
          assertEqual(
            (message.payload?.toolCall as { toolCallId?: string } | undefined)
              ?.toolCallId,
            'fixture-tool',
            'ACP permission request was not relayed',
          )
          socket.send(
            JSON.stringify({
              type: 'permission_response',
              payload: {
                requestId: message.payload.requestId,
                outcome: { outcome: 'selected', optionId: 'allow' },
              },
            }),
          )
          return
        }
        if (message.type === 'prompt_complete') {
          assertEqual(
            message.payload?.stopReason,
            'end_turn',
            'ACP prompt result was not relayed',
          )
          clearTimeout(timer)
          socket.close()
          resolvePromise()
        }
      } catch (error) {
        fail(error)
      }
    })
    socket.addEventListener('error', () =>
      fail(new Error('ACP bridge socket failed')),
    )
    socket.addEventListener('close', event => {
      if (event.code !== 1000 && event.code !== 1005) {
        fail(new Error(`ACP bridge socket closed early (${event.code})`))
      }
    })
  })
}

async function verifyProxy(): Promise<void> {
  const port = await reservePort()
  const child = spawnCli([
    '--port',
    String(port),
    '--host',
    '127.0.0.1',
    process.execPath,
    agentFixture,
  ])
  try {
    const health = await waitForResponse(
      child,
      `http://127.0.0.1:${port}/health`,
    )
    assertDeepEqual(
      await health.json(),
      { status: 'ok' },
      'proxy health response changed',
    )
    assertEqual(
      (await fetch(`http://127.0.0.1:${port}/missing`)).status,
      404,
      'proxy unknown route status changed',
    )

    const unauthorized = await waitForWebSocket(
      `ws://127.0.0.1:${port}/ws`,
      undefined,
      () => {},
      event => event instanceof CloseEvent,
    )
    assert(
      unauthorized instanceof CloseEvent,
      'unauthorized socket did not close',
    )
    assertEqual(
      unauthorized.code,
      4001,
      'unauthorized socket close code changed',
    )

    const authProtocol = encodeWebSocketAuthProtocol(token)
    const pong = await waitForWebSocket(
      `ws://127.0.0.1:${port}/ws`,
      authProtocol,
      socket => socket.send(JSON.stringify({ type: 'ping' })),
      event => event instanceof MessageEvent,
    )
    assert(pong instanceof MessageEvent, 'authorized socket did not answer')
    assertDeepEqual(
      JSON.parse(String(pong.data)),
      { type: 'pong' },
      'legacy ping response changed',
    )

    const jsonRpc = await waitForWebSocket(
      `ws://127.0.0.1:${port}/ws`,
      authProtocol,
      socket =>
        socket.send(
          JSON.stringify({
            jsonrpc: '2.0',
            id: 7,
            method: 'fixture/unknown',
          }),
        ),
      event => event instanceof MessageEvent,
    )
    assert(jsonRpc instanceof MessageEvent, 'JSON-RPC socket did not answer')
    assertDeepEqual(
      JSON.parse(String(jsonRpc.data)),
      {
        jsonrpc: '2.0',
        id: 7,
        error: { code: -32601, message: 'Method not found: fixture/unknown' },
      },
      'JSON-RPC error response changed',
    )

    await verifyAgentBridge(child, `ws://127.0.0.1:${port}/ws`, authProtocol)

    const oversized = await waitForWebSocket(
      `ws://127.0.0.1:${port}/ws`,
      authProtocol,
      socket => socket.send('x'.repeat(MAX_CLIENT_WS_PAYLOAD_BYTES + 1)),
      event => event instanceof CloseEvent,
    )
    assert(oversized instanceof CloseEvent, 'oversized socket did not close')
    assert(
      oversized.code === 1009 || oversized.code === 1006,
      `oversized socket close code changed: ${oversized.code}`,
    )
  } finally {
    await stopChild(child)
  }
}

async function verifyManager(): Promise<void> {
  const port = await reservePort()
  const child = spawnCli(['--manager', '--port', String(port)])
  try {
    const page = await waitForResponse(child, `http://127.0.0.1:${port}/`)
    assert(
      (await page.text()).includes('ACP Manager'),
      'manager UI marker changed',
    )
    const instances = await fetch(`http://127.0.0.1:${port}/api/instances`)
    assertEqual(instances.status, 200, 'manager instance route status changed')
    assertDeepEqual(
      await instances.json(),
      [],
      'manager initial instance list changed',
    )
  } finally {
    await stopChild(child)
  }
}

async function verifyTls(): Promise<void> {
  const port = await reservePort()
  const home = await mkdtemp(join(tmpdir(), 'acp-link-tls-'))
  const child = spawnCli(
    [
      '--https',
      '--port',
      String(port),
      '--host',
      '127.0.0.1',
      'fixture-agent-that-is-not-spawned',
    ],
    { HOME: home, USERPROFILE: home },
  )
  try {
    const response = await waitForResponse(
      child,
      `https://127.0.0.1:${port}/health`,
      { tls: { rejectUnauthorized: false } },
    )
    assertDeepEqual(
      await response.json(),
      { status: 'ok' },
      'TLS health response changed',
    )
  } finally {
    await stopChild(child)
    await rm(home, { recursive: true, force: true })
  }
}

await verifyProxy()
await verifyManager()
await verifyTls()

console.log(
  '[acp-link-runtime] PASS (HTTP/WS auth, JSON-RPC, ACP subprocess/permission, payload limit, Manager, TLS)',
)
