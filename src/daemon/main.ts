/**
 * Local background-session commands.
 *
 * The former daemon supervisor only hosted the Anthropic Remote Control
 * worker. That cloud worker has been removed; local background sessions stay
 * available through the existing bg implementation.
 */
export async function daemonMain(args: string[]): Promise<void> {
  const subcommand = args[0] || 'status'

  switch (subcommand) {
    case 'status':
    case 'ps': {
      const bg = await import('../cli/bg.js')
      await bg.psHandler([])
      break
    }
    case 'bg': {
      const bg = await import('../cli/bg.js')
      await bg.handleBgStart(args.slice(1))
      break
    }
    case 'attach': {
      const bg = await import('../cli/bg.js')
      await bg.attachHandler(args[1])
      break
    }
    case 'logs': {
      const bg = await import('../cli/bg.js')
      await bg.logsHandler(args[1])
      break
    }
    case 'kill': {
      const bg = await import('../cli/bg.js')
      await bg.killHandler(args[1])
      break
    }
    case '--help':
    case '-h':
    case 'help':
      printHelp()
      break
    default:
      console.error(`Unknown daemon subcommand: ${subcommand}`)
      printHelp()
      process.exitCode = 1
  }
}

function printHelp(): void {
  console.log(`
Claude Code — local background session management

USAGE
  claude daemon [subcommand]

SUBCOMMANDS
  status      Show local background sessions (default)
  bg          Start a local background session
  attach      Attach to a local background session
  logs        Show local session logs
  kill        Kill a local session
  help        Show this help
`)
}
