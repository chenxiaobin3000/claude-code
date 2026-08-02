#!/usr/bin/env bun

import pluginPackage from '../package.json'
import { handleWeixinCli } from '../src/cli.js'

function printHelp(): void {
  process.stdout.write(`weixin Host ${pluginPackage.version}

Usage:
  weixin-host mcp
  weixin-host login
  weixin-host login clear
  weixin-host access pair <code>
  weixin-host --version
`)
}

const args = process.argv.slice(2)
if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
  printHelp()
} else if (args[0] === '--version' || args[0] === '-v') {
  process.stdout.write(`${pluginPackage.version}\n`)
} else {
  await handleWeixinCli(args, pluginPackage.version)
}
