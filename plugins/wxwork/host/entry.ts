#!/usr/bin/env bun

import pluginPackage from '../package.json'
import { handleWxworkCli } from '../src/cli.js'

const args = process.argv.slice(2)
if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
  process.stdout.write(`wxwork Host ${pluginPackage.version}\n\n`)
  await handleWxworkCli([], pluginPackage.version)
} else if (args[0] === '--version' || args[0] === '-v') {
  process.stdout.write(`${pluginPackage.version}\n`)
} else {
  await handleWxworkCli(args, pluginPackage.version)
}
