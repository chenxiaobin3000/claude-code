import {
  clearAccount,
  DEFAULT_BASE_URL,
  loadAccount,
  saveAccount,
} from './accounts.js'
import { startLogin, waitForLogin } from './login.js'
import { confirmPairing } from './pairing.js'
import { runWeixinMcpServer } from './server.js'

function printUsage(): void {
  process.stdout.write(
    [
      'Usage:',
      '  weixin-host mcp',
      '  weixin-host login',
      '  weixin-host login clear',
      '  weixin-host access pair <code>',
      '',
      'Session enablement:',
      '  claude --channels plugin:weixin@local',
    ].join('\n') + '\n',
  )
}

async function runLogin(clear = false): Promise<void> {
  if (clear) {
    clearAccount()
    process.stdout.write('WeChat account cleared.\n')
    return
  }

  const existing = loadAccount()
  if (existing) {
    process.stdout.write(
      [
        'Already connected:',
        `  User ID: ${existing.userId || 'unknown'}`,
        `  Connected since: ${existing.savedAt}`,
        '',
        'Run `weixin-host login clear` to disconnect.',
        'Restart Claude Code with:',
        '  claude --channels plugin:weixin@local',
      ].join('\n') + '\n',
    )
    return
  }

  process.stdout.write('Starting WeChat QR login...\n\n')
  const qr = await startLogin(DEFAULT_BASE_URL)
  process.stdout.write(
    `\nScan the QR code above with WeChat, or open this URL:\n${qr.qrcodeUrl || ''}\n\n`,
  )

  const result = await waitForLogin({
    qrcodeId: qr.qrcodeId,
    apiBaseUrl: DEFAULT_BASE_URL,
  })

  if (!result.connected || !result.token) {
    process.stderr.write(`Login failed: ${result.message}\n`)
    process.exit(1)
  }

  saveAccount({
    token: result.token,
    baseUrl: result.baseUrl || DEFAULT_BASE_URL,
    userId: result.userId,
    savedAt: new Date().toISOString(),
  })

  process.stdout.write(
    [
      'Connected successfully!',
      `  User ID: ${result.userId || 'unknown'}`,
      `  Base URL: ${result.baseUrl || DEFAULT_BASE_URL}`,
      '',
      'Restart Claude Code with:',
      '  claude --channels plugin:weixin@local',
    ].join('\n') + '\n',
  )
}

function runAccess(args: string[]): void {
  if (args[0] !== 'pair' || !args[1]) {
    printUsage()
    process.exit(1)
  }

  const userId = confirmPairing(args[1])
  if (!userId) {
    process.stderr.write('Invalid or expired pairing code.\n')
    process.exit(1)
  }

  process.stdout.write(`Paired successfully: ${userId}\n`)
}

export async function handleWeixinCli(
  args: string[],
  version?: string,
): Promise<void> {
  const [subcommand, ...rest] = args

  switch (subcommand) {
    case 'mcp':
      await runWeixinMcpServer(version ?? '0.0.0')
      return
    case 'login':
      await runLogin(rest[0] === 'clear')
      return
    case 'access':
      runAccess(rest)
      return
    default:
      printUsage()
  }
}
