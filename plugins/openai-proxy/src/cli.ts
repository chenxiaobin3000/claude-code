import {
  OPENAI_PROXY_BASE_URL,
  OPENAI_PROXY_LOCAL_TOKEN_ENV,
  resolveLocalToken,
} from './config.js'
import { startOpenAIProxyGateway } from './gateway.js'
import { runOpenAIProxyMcp } from './mcp.js'

function usage(): void {
  process.stdout.write(
    'Usage:\n  openai-proxy-host serve\n  openai-proxy-host status\n  openai-proxy-host doctor\n  openai-proxy-host mcp\n',
  )
}

async function inspectGateway(path: '/health' | '/doctor'): Promise<void> {
  const headers: Record<string, string> = {}
  if (path === '/doctor') {
    headers.authorization = `Bearer ${resolveLocalToken()}`
  }
  const response = await fetch(`${OPENAI_PROXY_BASE_URL}${path}`, {
    headers,
    signal: AbortSignal.timeout(5_000),
  })
  const body = await response.text()
  if (!response.ok) throw new Error(`openai-proxy ${path} failed (${response.status}).`)
  process.stdout.write(`${body}\n`)
}

export async function handleOpenAIProxyCli(
  args: string[],
  version: string,
): Promise<void> {
  try {
    if (args[0] === 'serve') {
      const gateway = startOpenAIProxyGateway(version)
      process.stderr.write(`openai-proxy listening on ${gateway.url}\n`)
      await new Promise<void>(resolve => {
        process.once('SIGINT', resolve)
        process.once('SIGTERM', resolve)
      })
      gateway.stop()
      return
    }
    if (args[0] === 'status') {
      await inspectGateway('/health')
      return
    }
    if (args[0] === 'doctor') {
      await inspectGateway('/doctor')
      return
    }
    if (args[0] === 'mcp') {
      await runOpenAIProxyMcp(version)
      return
    }
    usage()
    if (args.length > 0) process.exitCode = 1
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const token = process.env[OPENAI_PROXY_LOCAL_TOKEN_ENV]
    process.stderr.write(`${token ? message.replaceAll(token, '[REDACTED]') : message}\n`)
    process.exitCode = 1
  }
}
