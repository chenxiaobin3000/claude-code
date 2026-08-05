#!/usr/bin/env bun
import pluginPackage from '../package.json'
import { handleXCli } from '../src/cli.js'

const args = process.argv.slice(2)
if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
  process.stdout.write(`X Host ${pluginPackage.version}\n\n`)
  await handleXCli([], pluginPackage.version)
} else if (args[0] === '--version' || args[0] === '-v') {
  process.stdout.write(`${pluginPackage.version}\n`)
} else {
  await handleXCli(args, pluginPackage.version)
}
