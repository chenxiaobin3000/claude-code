import {
  OPENAI_PROXY_BASE_URL,
  OPENAI_PROXY_LOCAL_TOKEN_ENV,
  resolveLocalToken,
} from './config.js'
import {
  openSystemBrowser,
  OpenAIProxyAuth,
  startBrowserLogin,
} from './auth/oauth.js'
import {
  readOpenAIProxyLastExit,
  readOpenAIProxyRuntimeState,
  runOpenAIProxyService,
  stopOpenAIProxyDaemon,
} from './lifecycle.js'
import { runOpenAIProxyMcp } from './mcp.js'

function usage(): void {
  process.stdout.write(
    'Usage:\n  openai-proxy-host setup\n  openai-proxy-host login [--device-code]\n  openai-proxy-host status\n  openai-proxy-host doctor\n  openai-proxy-host logout\n  openai-proxy-host serve\n  openai-proxy-host stop\n  openai-proxy-host mcp\n',
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
    const auth = new OpenAIProxyAuth()
    if (args[0] === 'setup') {
      resolveLocalToken()
      process.stdout.write(
        `Local gateway token is configured. Use ${OPENAI_PROXY_BASE_URL}/v1 as the models.json baseUrl.\n`,
      )
      return
    }
    if (args[0] === 'login' && args.includes('--device-code')) {
      const device = await auth.requestDeviceCode()
      process.stdout.write(
        `Open ${device.verificationUrl}\nEnter code: ${device.userCode}\nContinue only if you started this login.\n`,
      )
      const session = await auth.completeDeviceCode(device)
      process.stdout.write(
        `Signed in${session.account.email ? ` as ${session.account.email}` : ''}.\n`,
      )
      return
    }
    if (args[0] === 'login') {
      const login = startBrowserLogin(auth)
      const cancel = () => login.cancel()
      process.once('SIGINT', cancel)
      try {
        process.stdout.write(
          `Open this URL to sign in:\n${login.authUrl}\nWaiting on http://localhost:${login.port}/auth/callback\n`,
        )
        await openSystemBrowser(login.authUrl).catch(() => undefined)
        const session = await login.completion
        process.stdout.write(
          `Signed in${session.account.email ? ` as ${session.account.email}` : ''}.\n`,
        )
      } finally {
        process.off('SIGINT', cancel)
      }
      return
    }
    if (args[0] === 'serve') {
      process.stderr.write(`openai-proxy listening on ${OPENAI_PROXY_BASE_URL}\n`)
      await runOpenAIProxyService(version, 'foreground')
      return
    }
    if (args[0] === 'daemon') {
      await runOpenAIProxyService(version, 'daemon')
      return
    }
    if (args[0] === 'stop') {
      const stopped = await stopOpenAIProxyDaemon()
      process.stdout.write(stopped ? 'openai-proxy stopped.\n' : 'openai-proxy is not running.\n')
      return
    }
    if (args[0] === 'status') {
      const session = await auth.store.load()
      const runtime = await readOpenAIProxyRuntimeState()
      if (!session) {
        process.stdout.write('Not logged in.\n')
      } else {
        process.stdout.write(
          `Logged in${session.account.email ? ` as ${session.account.email}` : ''}; plan=${session.account.planType ?? 'unknown'}; workspace=${session.account.accountId ?? 'unknown'}.\n`,
        )
      }
      process.stdout.write(
        runtime
          ? `Gateway recorded: pid=${runtime.pid}; mode=${runtime.mode}; version=${runtime.hostVersion}; endpoint=${runtime.endpoint}.\n`
          : 'Gateway stopped.\n',
      )
      return
    }
    if (args[0] === 'doctor') {
      const session = await auth.store.load()
      const lastExit = await readOpenAIProxyLastExit()
      let gateway = 'stopped'
      try {
        await inspectGateway('/doctor')
        gateway = 'ready'
      } catch {
        gateway = 'stopped'
      }
      process.stdout.write(
        `auth=${session ? 'logged-in' : 'logged-out'}; gateway=${gateway}; forwarding=responses; last-exit=${lastExit?.reason ?? 'none'}.\n`,
      )
      return
    }
    if (args[0] === 'logout') {
      const result = await auth.logout()
      process.stdout.write(
        `${result.removed ? 'Logged out.' : 'No stored login.'}${result.revokeFailures ? ` ${result.revokeFailures} remote revocation request(s) failed; local credentials were removed.` : ''}\n`,
      )
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
