import type { SettingsJson } from '../settings/types.js'

/**
 * Matches Claude Code shell-mode semantics: a completed input-box `!` command
 * starts a normal model turn unless the user explicitly opts out in settings.
 */
export function shouldRespondToBashCommand(
  settings: Pick<SettingsJson, 'respondToBashCommands'>,
  interrupted = false,
): boolean {
  return !interrupted && settings.respondToBashCommands !== false
}
