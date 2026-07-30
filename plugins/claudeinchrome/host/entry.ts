#!/usr/bin/env bun

import { runClaudeInChromeMcpServer } from './mcpServer.js'
import { runChromeNativeHost } from './nativeHost.js'
import {
  doctorNativeHost,
  registerNativeHost,
  unregisterNativeHost,
} from './registration.js'
import { ALLOWED_EXTENSION_ORIGIN } from './paths.js'

const VERSION = '1.0.0'

function printHelp(): void {
  console.log(`claudeinchrome Host ${VERSION}

Usage:
  claudeinchrome-host                  Run as Chrome Native Messaging Host
  claudeinchrome-host mcp              Run stdio MCP Server
  claudeinchrome-host register         Register this executable for Chrome
  claudeinchrome-host unregister       Remove this Host registration
  claudeinchrome-host doctor           Validate Host registration
  claudeinchrome-host --version
`)
}

function isChromeNativeInvocation(args: string[]): boolean {
  if (args.length === 0) return true
  if (args[0] !== ALLOWED_EXTENSION_ORIGIN) return false
  return args
    .slice(1)
    .every(argument => /^--parent-window=\d+$/.test(argument))
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  if (isChromeNativeInvocation(args)) {
    await runChromeNativeHost()
    return
  }
  const command = args[0]
  if (command === 'mcp') {
    await runClaudeInChromeMcpServer()
    return
  }
  if (command === 'register') {
    const manifestPath = await registerNativeHost(process.execPath)
    console.log(`Registered claudeinchrome Native Host: ${manifestPath}`)
    return
  }
  if (command === 'unregister') {
    await unregisterNativeHost()
    console.log('Unregistered claudeinchrome Native Host')
    return
  }
  if (command === 'doctor') {
    const result = await doctorNativeHost(process.execPath)
    for (const check of result.checks) {
      console.log(`${check.ok ? 'PASS' : 'FAIL'} ${check.name}: ${check.detail}`)
    }
    if (!result.ok) process.exitCode = 1
    return
  }
  if (command === '--version' || command === '-v') {
    console.log(VERSION)
    return
  }
  if (command === '--help' || command === '-h' || command === 'help') {
    printHelp()
    return
  }
  throw new Error(`Unknown command: ${command}`)
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
