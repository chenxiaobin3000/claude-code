#!/usr/bin/env bun
import pluginPackage from '../package.json'
import { handleTelegramCli } from '../src/cli.js'

const args = process.argv.slice(2)
if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
  process.stdout.write(`Telegram Host ${pluginPackage.version}\n\n`)
  await handleTelegramCli([], pluginPackage.version)
} else if (args[0] === '--version' || args[0] === '-v') {
  process.stdout.write(`${pluginPackage.version}\n`)
} else {
  await handleTelegramCli(args, pluginPackage.version)
}
