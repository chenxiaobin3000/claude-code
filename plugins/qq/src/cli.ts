import { confirmQqPairing } from './access.js'
import { QqApiClient } from './api.js'
import {
  listQqBots,
  removeQqBot,
  resolveQqBot,
  resolveQqSecret,
  saveQqBot,
} from './config.js'
import { findUserSettingsEnvName } from '../../userSettingsEnv.js'
import { QqGateway } from './gateway.js'
import { runQqMcpServer } from './server.js'

function usage(): void {
  process.stdout.write(
    'Usage:\n  qq-host mcp\n  qq-host bot add <alias> <app-id> <secret-env>\n  qq-host bot add-local <alias> <app-id> <app-secret>\n  qq-host bot remove <alias>\n  qq-host bot list\n  qq-host bot doctor [alias]\n  qq-host access pair <alias> <code>\n',
  )
}
export async function handleQqCli(
  args: string[],
  version: string,
): Promise<void> {
  try {
    if (args[0] === 'mcp') {
      await runQqMcpServer(version)
      return
    }
    if (args[0] === 'bot' && args[1] === 'add') {
      if (!args[2] || !args[3] || !args[4])
        throw new Error('Expected: bot add <alias> <app-id> <secret-env>')
      const bot = saveQqBot({
        alias: args[2],
        appId: args[3],
        secretEnv: args[4],
      })
      process.stdout.write(
        `Configured QQ bot ${bot.alias}; secret source: ${bot.secretEnv}.\n`,
      )
      return
    }
    if (args[0] === 'bot' && args[1] === 'add-local') {
      if (!args[2] || !args[3] || !args[4])
        throw new Error('Expected: bot add-local <alias> <app-id> <app-secret>')
      process.stderr.write(
        'Warning: credentials supplied as command-line arguments may be retained in shell history; the value is only matched against user settings and is not stored by this command.\n',
      )
      const bot = saveQqBot({
        alias: args[2],
        appId: args[3],
        secretEnv: findUserSettingsEnvName(args[4], 'QQ AppSecret'),
      })
      process.stdout.write(
        `Configured QQ bot ${bot.alias}; secret source: ${bot.secretEnv}.\n`,
      )
      return
    }
    if (args[0] === 'bot' && args[1] === 'remove') {
      if (!args[2]) throw new Error('Bot alias is required.')
      removeQqBot(args[2])
      process.stdout.write(`Removed QQ bot ${args[2]}.\n`)
      return
    }
    if (args[0] === 'bot' && args[1] === 'list') {
      const bots = listQqBots()
      process.stdout.write(
        bots.length
          ? `${bots.map(bot => `${bot.alias}\t${bot.appId}\t${bot.secretEnv}`).join('\n')}\n`
          : 'No QQ bots configured.\n',
      )
      return
    }
    if (args[0] === 'bot' && args[1] === 'doctor') {
      const bot = resolveQqBot(args[2])
      if (!bot) throw new Error('No QQ bot configured.')
      const secret = resolveQqSecret(bot)
      const api = new QqApiClient(bot, secret)
      const gateway = new QqGateway({
        alias: bot.alias,
        api,
        maxReconnectAttempts: 0,
      })
      try {
        gateway.start()
        await gateway.waitUntilReady(15_000)
        process.stdout.write(
          `QQ bot ${bot.alias}: token and Gateway authenticated.\n`,
        )
      } finally {
        gateway.stop()
      }
      return
    }
    if (args[0] === 'access' && args[1] === 'pair') {
      if (!args[2] || !args[3])
        throw new Error('Expected: access pair <alias> <code>')
      const user = confirmQqPairing(args[2], args[3])
      if (!user) throw new Error('Invalid or expired pairing code.')
      process.stdout.write(`Paired QQ user ${user} with bot ${args[2]}.\n`)
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
