import { isEnvTruthy } from '../../utils/envUtils.js'

export function initializeEntrypoint(
  isNonInteractive: boolean,
  argv: readonly string[] = process.argv,
): void {
  if (process.env.CLAUDE_CODE_ENTRYPOINT) return

  const cliArgs = argv.slice(2)
  const mcpIndex = cliArgs.indexOf('mcp')
  if (mcpIndex !== -1 && cliArgs[mcpIndex + 1] === 'serve') {
    process.env.CLAUDE_CODE_ENTRYPOINT = 'mcp'
    return
  }
  if (isEnvTruthy(process.env.CLAUDE_CODE_ACTION)) {
    process.env.CLAUDE_CODE_ENTRYPOINT = 'claude-code-github-action'
    return
  }
  process.env.CLAUDE_CODE_ENTRYPOINT = isNonInteractive ? 'sdk-cli' : 'cli'
}
