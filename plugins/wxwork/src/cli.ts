import { confirmPairing } from './access.js'
import { WxworkClient } from './client.js'
import {
  DEFAULT_WXWORK_WS_URL,
  listBots,
  removeBot,
  resolveBot,
  resolveBotSecret,
  saveBot,
} from './config.js'
import { runWxworkMcpServer } from './server.js'

function usage(): void {
  process.stdout.write(`Usage:
  wxwork-host mcp
  wxwork-host bot add <alias> <bot-id> <secret-env> [wss-url]
  wxwork-host bot remove <alias>
  wxwork-host bot list
  wxwork-host bot doctor [alias]
  wxwork-host access pair <alias> <code>
`)
}

async function runBot(args: string[]): Promise<void> {
  const [action, ...rest] = args
  if (action === 'add') {
    const [alias, botId, secretEnv, wsUrl] = rest
    if (!alias || !botId || !secretEnv)
      throw new Error(
        'Expected: bot add <alias> <bot-id> <secret-env> [wss-url]',
      )
    const bot = saveBot({
      alias,
      botId,
      secretEnv,
      wsUrl: wsUrl || DEFAULT_WXWORK_WS_URL,
    })
    process.stdout.write(
      `Configured wxwork bot ${bot.alias}; secret source: ${bot.secretEnv}.\n`,
    )
    return
  }
  if (action === 'remove') {
    if (!rest[0]) throw new Error('Bot alias is required.')
    removeBot(rest[0])
    process.stdout.write(`Removed wxwork bot ${rest[0]}.\n`)
    return
  }
  if (action === 'list') {
    const bots = listBots()
    process.stdout.write(
      bots.length
        ? `${bots.map(bot => `${bot.alias}\t${bot.botId}\t${bot.secretEnv}\t${bot.wsUrl}`).join('\n')}\n`
        : 'No wxwork bots configured.\n',
    )
    return
  }
  if (action === 'doctor') {
    const bot = resolveBot(rest[0])
    if (!bot) throw new Error('No wxwork bot configured.')
    const client = new WxworkClient({
      botId: bot.botId,
      secret: resolveBotSecret(bot),
      wsUrl: bot.wsUrl,
      maxReconnectAttempts: 0,
    })
    try {
      client.connect()
      await client.waitForAuthentication()
      process.stdout.write(
        `wxwork bot ${bot.alias}: authenticated at ${new URL(bot.wsUrl).origin}.\n`,
      )
    } finally {
      client.disconnect()
    }
    return
  }
  throw new Error(
    'Expected `bot add`, `bot remove`, `bot list`, or `bot doctor`.',
  )
}

export async function handleWxworkCli(
  args: string[],
  version: string,
): Promise<void> {
  try {
    if (args[0] === 'mcp') await runWxworkMcpServer(version)
    else if (args[0] === 'bot') await runBot(args.slice(1))
    else if (args[0] === 'access' && args[1] === 'pair') {
      if (!args[2] || !args[3])
        throw new Error('Expected: access pair <alias> <code>')
      const user = confirmPairing(args[2], args[3])
      if (!user) throw new Error('Invalid or expired pairing code.')
      process.stdout.write(`Paired wxwork user ${user} with bot ${args[2]}.\n`)
    } else usage()
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    )
    process.exitCode = 1
  }
}
