import { isSettingSourceEnabled } from '../../utils/settings/constants.js'
import { getSettingsForSource } from '../../utils/settings/settings.js'
import type { SettingsJson } from '../../utils/settings/types.js'

type PersistentChannelSource = 'userSettings' | 'policySettings'
type ChannelSettings = Pick<SettingsJson, 'channels'>

export type ChannelSelection = {
  plugin: string
  reply?: string
}

export type ChannelSettingsReader = (
  source: PersistentChannelSource,
) => ChannelSettings | null

function appendSelections(
  destination: ChannelSelection[],
  indexes: Map<string, number>,
  values: readonly ChannelSelection[],
): void {
  for (const value of values) {
    const existingIndex = indexes.get(value.plugin)
    if (existingIndex === undefined) {
      indexes.set(value.plugin, destination.length)
      destination.push(value)
      continue
    }
    const existing = destination[existingIndex]!
    if (existing.reply && value.reply && existing.reply !== value.reply) {
      throw new Error(
        `Channel ${value.plugin} configures conflicting reply tools: ${existing.reply} and ${value.reply}.`,
      )
    }
    if (!existing.reply && value.reply) {
      destination[existingIndex] = { ...existing, reply: value.reply }
    }
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
): ChannelSelection[] {
  const resolved: ChannelSelection[] = []
  const indexes = new Map<string, number>()

  appendSelections(
    resolved,
    indexes,
    (cliChannels ?? []).map(plugin => ({ plugin })),
  )
  if (userSettingsEnabled) {
    appendSelections(
      resolved,
      indexes,
      readSettings('userSettings')?.channels ?? [],
    )
  }
  appendSelections(
    resolved,
    indexes,
    readSettings('policySettings')?.channels ?? [],
  )

  return resolved
}

export function getChannelSelections(
  cliChannels: readonly string[] | undefined,
): ChannelSelection[] {
  return resolveChannelSelections(
    cliChannels,
    source => getSettingsForSource(source),
    isSettingSourceEnabled('userSettings'),
  )
}
