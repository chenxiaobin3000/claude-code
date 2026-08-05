import { XReadOnlyClient } from './client.js'
import {
  listXApps,
  removeXApp,
  resolveXApp,
  saveXApp,
  X_BEARER_TOKEN_ENV,
} from './config.js'
import { runXMcpServer } from './server.js'

function usage(): void {
  process.stdout.write(
    'Usage:\n  x-host mcp\n  x-host app add <alias>\n  x-host app remove <alias>\n  x-host app list\n  x-host app doctor [alias]\n',
  )
}

export async function handleXCli(
  args: string[],
  version: string,
): Promise<void> {
  try {
    if (args[0] === 'mcp') {
      await runXMcpServer(version)
      return
    }
    if (args[0] === 'app' && args[1] === 'add') {
      if (!args[2]) throw new Error('X App alias is required.')
      const app = saveXApp(args[2])
      process.stdout.write(
        `Configured X App ${app.alias}; Bearer Token source: ${X_BEARER_TOKEN_ENV}.\n`,
      )
      return
    }
    if (args[0] === 'app' && args[1] === 'remove') {
      if (!args[2]) throw new Error('X App alias is required.')
      removeXApp(args[2])
      process.stdout.write(`Removed X App ${args[2]}.\n`)
      return
    }
    if (args[0] === 'app' && args[1] === 'list') {
      const apps = listXApps()
      process.stdout.write(
        apps.length
          ? `${apps.map(app => `${app.alias}\t${X_BEARER_TOKEN_ENV}`).join('\n')}\n`
          : 'No X Apps configured.\n',
      )
      return
    }
    if (args[0] === 'app' && args[1] === 'doctor') {
      const app = resolveXApp(args[2])
      if (!app) throw new Error('No X App configured.')
      const client = new XReadOnlyClient(app)
      const result = await client.doctor()
      process.stdout.write(
        `X App ${app.alias}: authenticated; proxy=${client.proxyMode} (${client.proxyDisplay}); rate-limit remaining=${result.rateLimit.remaining ?? 'unknown'}.\n`,
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
