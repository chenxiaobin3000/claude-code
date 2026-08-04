import { createInterface } from 'node:readline/promises'
import {
  loadTelegramUserAccess,
  setTelegramUserRouteAllowed,
} from './access.js'
import {
  loginTelegramUserAccount,
  TelegramUserRuntimeClient,
} from './client.js'
import {
  clearTelegramUserSession,
  listTelegramUserAccounts,
  loadTelegramUserSession,
  removeTelegramUserAccount,
  resolveTelegramUserAccount,
  resolveTelegramUserCredentials,
  saveLocalTelegramUserAccount,
  saveTelegramUserAccount,
} from './config.js'
import { runTelegramUserMcpServer } from './server.js'
import type { TelegramUserPeerType } from './types.js'

function usage(): void {
  process.stdout.write(
    'Usage:\n  telegram-user-host mcp\n  telegram-user-host account add <alias> <api-id-env> <api-hash-env> <phone-env>\n  telegram-user-host account add-local <alias> <api-id> <api-hash> <phone>\n  telegram-user-host account login [alias]\n  telegram-user-host account logout [alias]\n  telegram-user-host account remove <alias>\n  telegram-user-host account list\n  telegram-user-host account doctor [alias]\n  telegram-user-host access allow|deny <alias> <user|group|channel> <peer-id> [topic-id]\n  telegram-user-host access list <alias>\n',
  )
}
async function promptLine(label: string): Promise<string> {
  const reader = createInterface({
    input: process.stdin,
    output: process.stderr,
  })
  try {
    return (await reader.question(label)).trim()
  } finally {
    reader.close()
  }
}
async function promptSecret(label: string): Promise<string> {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== 'function')
    return promptLine(label)
  process.stderr.write(label)
  process.stdin.setRawMode(true)
  process.stdin.resume()
  return new Promise((resolve, reject) => {
    let value = ''
    const done = (error?: Error): void => {
      process.stdin.off('data', onData)
      process.stdin.setRawMode?.(false)
      process.stderr.write('\n')
      error ? reject(error) : resolve(value)
    }
    const onData = (data: Buffer): void => {
      for (const byte of data) {
        if (byte === 3) {
          done(new Error('Login cancelled.'))
          return
        }
        if (byte === 13 || byte === 10) {
          done()
          return
        }
        if (byte === 8 || byte === 127) value = value.slice(0, -1)
        else if (byte >= 32) value += String.fromCharCode(byte)
      }
    }
    process.stdin.on('data', onData)
  })
}
function accountOrThrow(alias?: string) {
  const account = resolveTelegramUserAccount(alias)
  if (!account) throw new Error('No Telegram user account configured.')
  return account
}
export async function handleTelegramUserCli(
  args: string[],
  version: string,
): Promise<void> {
  try {
    if (args[0] === 'mcp') {
      await runTelegramUserMcpServer(version)
      return
    }
    if (args[0] === 'account' && args[1] === 'add') {
      if (!args[2] || !args[3] || !args[4] || !args[5])
        throw new Error(
          'Expected: account add <alias> <api-id-env> <api-hash-env> <phone-env>',
        )
      const account = saveTelegramUserAccount({
        alias: args[2],
        apiIdEnv: args[3],
        apiHashEnv: args[4],
        phoneEnv: args[5],
      })
      process.stdout.write(
        `Configured Telegram user account ${account.alias}; secret values remain in the named environment variables.\n`,
      )
      return
    }
    if (args[0] === 'account' && args[1] === 'add-local') {
      if (!args[2] || !args[3] || !args[4] || !args[5])
        throw new Error(
          'Expected: account add-local <alias> <api-id> <api-hash> <phone>',
        )
      process.stderr.write(
        'Warning: credentials supplied as command-line arguments may be retained in shell history.\n',
      )
      const account = saveLocalTelegramUserAccount({
        alias: args[2],
        apiId: args[3],
        apiHash: args[4],
        phone: args[5],
      })
      process.stdout.write(
        `Configured Telegram user account ${account.alias}; credential source: local.\n`,
      )
      return
    }
    if (args[0] === 'account' && args[1] === 'list') {
      const accounts = listTelegramUserAccounts()
      process.stdout.write(
        accounts.length
          ? `${accounts.map(account => `${account.alias}\t${loadTelegramUserSession(account.alias) ? 'logged-in' : 'login-required'}\t${account.credentialSource === 'local' ? 'local' : `${account.apiIdEnv}\t${account.apiHashEnv}\t${account.phoneEnv}`}`).join('\n')}\n`
          : 'No Telegram user accounts configured.\n',
      )
      return
    }
    if (args[0] === 'account' && args[1] === 'remove') {
      if (!args[2]) throw new Error('Account alias is required.')
      removeTelegramUserAccount(args[2])
      process.stdout.write(
        `Removed Telegram user account ${args[2]} and its local session.\n`,
      )
      return
    }
    if (args[0] === 'account' && args[1] === 'login') {
      const account = accountOrThrow(args[2])
      const result = await loginTelegramUserAccount(
        account,
        resolveTelegramUserCredentials(account),
        {
          code: viaApp =>
            promptLine(
              `Telegram one-time code${viaApp ? ' (sent in Telegram)' : ''}: `,
            ),
          password: hint =>
            promptSecret(`Telegram 2FA password${hint ? ` (${hint})` : ''}: `),
        },
      )
      process.stdout.write(
        `Telegram user account ${account.alias} logged in as ${result.username ? `@${result.username}` : result.userId}.\n`,
      )
      return
    }
    if (args[0] === 'account' && args[1] === 'doctor') {
      const account = accountOrThrow(args[2])
      const client = new TelegramUserRuntimeClient(
        account,
        resolveTelegramUserCredentials(account),
      )
      try {
        const result = await client.doctor()
        process.stdout.write(
          `Telegram user account ${account.alias}: authorized as ${result.username ? `@${result.username}` : result.userId}.\n`,
        )
      } finally {
        await client.stop()
      }
      return
    }
    if (args[0] === 'account' && args[1] === 'logout') {
      const account = accountOrThrow(args[2])
      const client = new TelegramUserRuntimeClient(
        account,
        resolveTelegramUserCredentials(account),
      )
      try {
        await client.logout()
      } finally {
        await client.stop()
        clearTelegramUserSession(account.alias)
      }
      process.stdout.write(
        `Telegram user account ${account.alias} logged out and local session removed.\n`,
      )
      return
    }
    if (args[0] === 'access' && (args[1] === 'allow' || args[1] === 'deny')) {
      if (!args[2] || !args[3] || !args[4])
        throw new Error(
          'Expected: access allow|deny <alias> <user|group|channel> <peer-id> [topic-id]',
        )
      const peerType = args[3] as TelegramUserPeerType
      const topicId = args[5] === undefined ? undefined : Number(args[5])
      setTelegramUserRouteAllowed(
        args[2],
        {
          peerType,
          peerId: args[4],
          ...(topicId !== undefined ? { topicId } : {}),
        },
        args[1] === 'allow',
      )
      process.stdout.write(
        `${args[1] === 'allow' ? 'Allowed' : 'Denied'} ${peerType} ${args[4]} for Telegram user account ${args[2]}.\n`,
      )
      return
    }
    if (args[0] === 'access' && args[1] === 'list') {
      if (!args[2]) throw new Error('Account alias is required.')
      const entries = loadTelegramUserAccess(args[2]).allowPeers
      process.stdout.write(
        entries.length
          ? `${entries.map(entry => `${entry.peerType}\t${entry.peerId}${entry.topicId ? `\ttopic ${entry.topicId}` : ''}`).join('\n')}\n`
          : 'No Telegram user Peers are allowlisted.\n',
      )
      return
    }
    usage()
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    )
    process.exitCode = 1
  }
}
