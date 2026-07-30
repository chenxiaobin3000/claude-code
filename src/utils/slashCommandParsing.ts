/**
 * Centralized utilities for parsing slash commands
 */

export type ParsedSlashCommand = {
  commandName: string
  args: string
  isMcp: boolean
}

export type StackableSkillCommand = {
  type: string
  name: string
  aliases?: string[]
  userInvocable?: boolean
  context?: 'inline' | 'fork'
}

export type ParsedStackedSkills<T extends StackableSkillCommand> = {
  commands: T[]
  args: string
}

const MAX_STACKED_SKILLS = 6

/**
 * Parses `/skill-a /skill-b trailing arguments` when every leading token is
 * an inline, user-invocable prompt skill. The shared trailing arguments are
 * passed to every expanded skill. Non-skill, forked, and argument-owning
 * commands stop expansion and remain part of the first skill's arguments.
 */
export function parseStackedSkills<T extends StackableSkillCommand>(
  input: string,
  commands: readonly T[],
): ParsedStackedSkills<T> | null {
  const value = input.trim()
  const stacked: T[] = []
  let cursor = 0

  while (stacked.length < MAX_STACKED_SKILLS && value[cursor] === '/') {
    const match = /^\/(\S+)(?:\s+|$)/.exec(value.slice(cursor))
    const commandName = match?.[1]
    if (!match || !commandName) break
    const command = commands.find(
      candidate =>
        candidate.name === commandName ||
        candidate.aliases?.includes(commandName) === true,
    )
    if (
      !command ||
      command.type !== 'prompt' ||
      command.userInvocable === false ||
      command.context === 'fork' ||
      command.name === 'loop'
    ) {
      break
    }
    stacked.push(command)
    cursor += match[0].length
  }

  if (stacked.length < 2) return null
  return {
    commands: stacked,
    args: value.slice(cursor).trim(),
  }
}

/**
 * Parses a slash command input string into its component parts
 *
 * @param input - The raw input string (should start with '/')
 * @returns Parsed command name, args, and MCP flag, or null if invalid
 *
 * @example
 * parseSlashCommand('/search foo bar')
 * // => { commandName: 'search', args: 'foo bar', isMcp: false }
 *
 * @example
 * parseSlashCommand('/mcp:tool (MCP) arg1 arg2')
 * // => { commandName: 'mcp:tool (MCP)', args: 'arg1 arg2', isMcp: true }
 */
export function parseSlashCommand(input: string): ParsedSlashCommand | null {
  const trimmedInput = input.trim()

  // Check if input starts with '/'
  if (!trimmedInput.startsWith('/')) {
    return null
  }

  // Remove the leading '/' and split by spaces
  const withoutSlash = trimmedInput.slice(1)
  const words = withoutSlash.split(' ')

  if (!words[0]) {
    return null
  }

  let commandName = words[0]
  let isMcp = false
  let argsStartIndex = 1

  // Check for MCP commands (second word is '(MCP)')
  if (words.length > 1 && words[1] === '(MCP)') {
    commandName = commandName + ' (MCP)'
    isMcp = true
    argsStartIndex = 2
  }

  // Extract arguments (everything after command name)
  const args = words.slice(argsStartIndex).join(' ')

  return {
    commandName,
    args,
    isMcp,
  }
}
