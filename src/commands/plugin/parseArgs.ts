export type ParsedCommand =
  | { type: 'menu' }
  | { type: 'help' }
  | { type: 'validate'; path?: string }

export function parsePluginArgs(args?: string): ParsedCommand {
  const parts = args?.trim().split(/\s+/) ?? []
  const command = parts[0]?.toLowerCase()
  if (command === 'help' || command === '--help' || command === '-h') {
    return { type: 'help' }
  }
  if (command === 'validate') {
    const path = parts.slice(1).join(' ').trim()
    return { type: 'validate', path: path || undefined }
  }
  return { type: 'menu' }
}
