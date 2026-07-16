export type StartupMode = 'print' | 'interactive'

export function resolveStartupMode(argv: readonly string[]): StartupMode {
  return argv.includes('-p') || argv.includes('--print')
    ? 'print'
    : 'interactive'
}

export function shouldUsePrintFastPath(argv: readonly string[]): boolean {
  if (resolveStartupMode(argv) !== 'print') return false
  return !argv.some(
    argument =>
      argument.startsWith('cc://') || argument.startsWith('cc+unix://'),
  )
}
