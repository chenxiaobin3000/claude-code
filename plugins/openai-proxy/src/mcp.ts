import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  acquireOpenAIProxyClientLease,
  ensureOpenAIProxyDaemon,
} from './lifecycle.js'

export async function runOpenAIProxyMcp(version: string): Promise<void> {
  const server = new Server(
    { name: 'openai-proxy', version },
    { capabilities: {} },
  )
  const transport = new StdioServerTransport()
  const controller = new AbortController()
  const stop = () => controller.abort()
  process.stdin.once('end', stop)
  process.stdin.once('close', stop)
  process.stdin.once('error', stop)
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
  process.once('SIGHUP', stop)
  let connected = false
  let lease: Awaited<ReturnType<typeof acquireOpenAIProxyClientLease>> | undefined
  try {
    // Connecting starts stdin consumption, so an already-closed parent can be
    // observed before the Host creates runtime state or requires a local token.
    await server.connect(transport)
    connected = true
    await Bun.sleep(0)
    if (controller.signal.aborted) return
    lease = await acquireOpenAIProxyClientLease(version)
    await ensureOpenAIProxyDaemon(version)
    if (controller.signal.aborted) return
    await new Promise<void>(resolve =>
      controller.signal.addEventListener('abort', () => resolve(), {
        once: true,
      }),
    )
  } finally {
    process.stdin.off('end', stop)
    process.stdin.off('close', stop)
    process.stdin.off('error', stop)
    process.off('SIGINT', stop)
    process.off('SIGTERM', stop)
    process.off('SIGHUP', stop)
    if (connected) await server.close().catch(() => undefined)
    await lease?.release()
  }
}
