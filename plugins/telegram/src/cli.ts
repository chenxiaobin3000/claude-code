import { confirmTelegramPairing } from './access.js'
import { TelegramClient } from './client.js'
import {
  listTelegramBots,
  removeTelegramBot,
  resolveTelegramBot,
  resolveTelegramToken,
  saveTelegramBot,
} from './config.js'
import { runTelegramMcpServer } from './server.js'

function usage(): void {
  process.stdout.write(
    'Usage:\n  telegram-host mcp\n  telegram-host bot add <alias> <token-env>\n  telegram-host bot remove <alias>\n  telegram-host bot list\n  telegram-host bot doctor [alias]\n  telegram-host access pair <alias> <code>\n',
  )
}
export async function handleTelegramCli(
  args: string[],
  version: string,
): Promise<void> {
  try {
    if (args[0] === 'mcp') {
      await runTelegramMcpServer(version)
      return
    }
    if (args[0] === 'bot' && args[1] === 'add') {
      if (!args[2] || !args[3])
        throw new Error('Expected: bot add <alias> <token-env>')
      const bot = saveTelegramBot({ alias: args[2], tokenEnv: args[3] })
      process.stdout.write(
        `Configured Telegram bot ${bot.alias}; token source: ${bot.tokenEnv}.\n`,
      )
      return
    }
    if (args[0] === 'bot' && args[1] === 'remove') {
      if (!args[2]) throw new Error('Bot alias is required.')
      removeTelegramBot(args[2])
      process.stdout.write(`Removed Telegram bot ${args[2]}.\n`)
      return
    }
    if (args[0] === 'bot' && args[1] === 'list') {
      const bots = listTelegramBots()
      process.stdout.write(
        bots.length
          ? `${bots.map(bot => `${bot.alias}\t${bot.tokenEnv}`).join('\n')}\n`
          : 'No Telegram bots configured.\n',
      )
      return
    }
    if (args[0] === 'bot' && args[1] === 'doctor') {
      const bot = resolveTelegramBot(args[2])
      if (!bot) throw new Error('No Telegram bot configured.')
      const client = new TelegramClient(bot.alias, resolveTelegramToken(bot))
      const result = await client.doctor()
      process.stdout.write(
        `Telegram bot ${bot.alias}: @${result.bot.username}, long polling available, pending updates ${result.pendingUpdates}.\n`,
      )
      return
    }
    if (args[0] === 'access' && args[1] === 'pair') {
      if (!args[2] || !args[3])
        throw new Error('Expected: access pair <alias> <code>')
      const user = confirmTelegramPairing(args[2], args[3])
      if (!user) throw new Error('Invalid or expired pairing code.')
      process.stdout.write(
        `Paired Telegram user ${user} with bot ${args[2]}.\n`,
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
