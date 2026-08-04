import { isSettingSourceEnabled } from '../../utils/settings/constants.js'
import { getSettingsForSource } from '../../utils/settings/settings.js'
import type { SettingsJson } from '../../utils/settings/types.js'

type PersistentChannelSource = 'userSettings' | 'policySettings'
type ChannelSettings = Pick<SettingsJson, 'channels'>

export type ChannelSettingsReader = (
  source: PersistentChannelSource,
) => ChannelSettings | null

function appendUnique(
  destination: string[],
  seen: Set<string>,
  values: readonly string[] | undefined,
): void {
  for (const value of values ?? []) {
    if (seen.has(value)) continue
    seen.add(value)
    destination.push(value)
  }
}

/**
 * Resolve channels for this process. Project and project-local settings are
 * intentionally absent from the reader contract: a repository must not be
 * able to opt itself into receiving external channel messages.
 */
export function resolveChannelSelections(
  cliChannels: readonly string[] | undefined,
  readSettings: ChannelSettingsReader,
  userSettingsEnabled = true,
): string[] {
  const resolved: string[] = []
  const seen = new Set<string>()

  appendUnique(resolved, seen, cliChannels)
  if (userSettingsEnabled) {
    appendUnique(resolved, seen, readSettings('userSettings')?.channels)
  }
  appendUnique(resolved, seen, readSettings('policySettings')?.channels)

  return resolved
}

export function getChannelSelections(
  cliChannels: readonly string[] | undefined,
): string[] {
  return resolveChannelSelections(
    cliChannels,
    source => getSettingsForSource(source),
    isSettingSourceEnabled('userSettings'),
  )
}
