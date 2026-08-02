import {
  clearAccount,
  DEFAULT_ACCOUNT_ID,
  DEFAULT_BASE_URL,
  listAccounts,
  loadAccount,
  resolveAccountId,
  saveAccount,
  validateAccountId,
} from './accounts.js'
import { startLogin, waitForLogin } from './login.js'
import { confirmPairing } from './pairing.js'
import { runWeixinMcpServer } from './server.js'
import { resetSessionPause } from './session.js'

function printUsage(): void {
  process.stdout.write(
    [
      'Usage:',
      '  weixin-host mcp',
      '  weixin-host accounts',
      '  weixin-host login [account-id]',
      '  weixin-host login refresh [account-id]',
      '  weixin-host login clear [account-id]',
      '  weixin-host access pair [account-id] <code>',
      '',
      'Session enablement:',
      '  claude --channels plugin:weixin@local',
    ].join('\n') + '\n',
  )
}

function resolveCliAccountId(explicit?: string, create = false): string {
  if (explicit) return validateAccountId(explicit)
  const resolved = resolveAccountId()
  if (resolved) return resolved
  if (create) return DEFAULT_ACCOUNT_ID
  throw new Error('No WeChat account is configured.')
}

async function runLogin(args: string[]): Promise<void> {
  const action = args[0] === 'clear' || args[0] === 'refresh' ? args[0] : 'login'
  const explicitAccountId = action === 'login' ? args[0] : args[1]
  const accountId = resolveCliAccountId(explicitAccountId, action === 'login')

  if (action === 'clear') {
    clearAccount(accountId)
    process.stdout.write(`WeChat account cleared: ${accountId}.\n`)
    return
  }

  const existing = loadAccount(accountId)
  if (existing && action !== 'refresh') {
    process.stdout.write(
      [
        `Already connected: ${accountId}`,
        `  User ID: ${existing.userId || 'unknown'}`,
        `  Connected since: ${existing.savedAt}`,
        '',
        `Run \`weixin-host login clear ${accountId}\` to disconnect.`,
        `Run \`weixin-host login refresh ${accountId}\` to refresh the binding.`,
        'Restart Claude Code with:',
        '  claude --channels plugin:weixin@local',
      ].join('\n') + '\n',
    )
    return
  }

  process.stdout.write(`Starting WeChat QR login for account ${accountId}...\n\n`)
  const localTokens = existing?.token ? [existing.token] : []
  const qr = await startLogin(DEFAULT_BASE_URL, localTokens)
  process.stdout.write(
    `\nScan the QR code above with WeChat, or open this URL:\n${qr.qrcodeUrl || ''}\n\n`,
  )

  const result = await waitForLogin({
    qrcodeId: qr.qrcodeId,
    apiBaseUrl: DEFAULT_BASE_URL,
    localTokens,
  })

  if (result.alreadyConnected && existing) {
    process.stdout.write(`${result.message}\n`)
    return
  }
  if (!result.connected || !result.token) {
    throw new Error(`Login failed: ${result.message}`)
  }

  saveAccount(
    {
      token: result.token,
      baseUrl: result.baseUrl || DEFAULT_BASE_URL,
      userId: result.userId,
      savedAt: new Date().toISOString(),
    },
    accountId,
  )
  resetSessionPause(accountId)

  process.stdout.write(
    [
      `Connected successfully: ${accountId}`,
      `  User ID: ${result.userId || 'unknown'}`,
      `  Base URL: ${result.baseUrl || DEFAULT_BASE_URL}`,
      '',
      'Restart Claude Code with:',
      '  claude --channels plugin:weixin@local',
    ].join('\n') + '\n',
  )
}

function runAccounts(): void {
  const accounts = listAccounts()
  if (accounts.length === 0) {
    process.stdout.write('No WeChat accounts configured.\n')
    return
  }
  process.stdout.write(
    accounts
      .map(account =>
        `${account.accountId}\t${account.userId || 'unknown'}\t${account.baseUrl}`,
      )
      .join('\n') + '\n',
  )
}

function runAccess(args: string[]): void {
  if (args[0] !== 'pair') throw new Error('Expected `access pair`.')
  const hasAccount = args.length >= 3
  const accountId = resolveCliAccountId(hasAccount ? args[1] : undefined)
  const code = hasAccount ? args[2] : args[1]
  if (!code) throw new Error('Pairing code is required.')
  const userId = confirmPairing(code, accountId)
  if (!userId) throw new Error('Invalid or expired pairing code.')
  process.stdout.write(`Paired successfully on ${accountId}: ${userId}\n`)
}

export async function handleWeixinCli(args: string[], version?: string): Promise<void> {
  const [subcommand, ...rest] = args
  try {
    switch (subcommand) {
      case 'mcp':
        await runWeixinMcpServer(version ?? '0.0.0')
        return
      case 'accounts':
        runAccounts()
        return
      case 'login':
        await runLogin(rest)
        return
      case 'access':
        runAccess(rest)
        return
      default:
        printUsage()
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
