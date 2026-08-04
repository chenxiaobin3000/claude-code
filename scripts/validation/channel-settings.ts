#!/usr/bin/env bun

import {
  resolveChannelSelections,
  type ChannelSettingsReader,
} from '../../src/services/mcp/channelConfiguration.js'
import { SettingsSchema } from '../../src/utils/settings/types.js'
import { assert, assertDeepEqual } from './assertions.js'

const parsed = SettingsSchema().parse({
  channels: ['plugin:weixin@local', 'server:notifications'],
})
assertDeepEqual(
  parsed.channels,
  ['plugin:weixin@local', 'server:notifications'],
  'settings schema accepts persistent channels',
)

const requestedSources: string[] = []
const readSettings: ChannelSettingsReader = source => {
  requestedSources.push(source)
  if (source === 'userSettings') {
    return {
      channels: ['plugin:weixin@local', 'plugin:qq@local'],
    }
  }
  return {
    channels: ['plugin:wxwork@local', 'plugin:qq@local'],
  }
}

assertDeepEqual(
  resolveChannelSelections(
    ['plugin:telegram@local', 'plugin:weixin@local'],
    readSettings,
  ),
  [
    'plugin:telegram@local',
    'plugin:weixin@local',
    'plugin:qq@local',
    'plugin:wxwork@local',
  ],
  'CLI, user, and managed channels merge in priority order without duplicates',
)
assertDeepEqual(
  requestedSources,
  ['userSettings', 'policySettings'],
  'channel startup reads no project-level settings sources',
)

requestedSources.length = 0
assertDeepEqual(
  resolveChannelSelections(undefined, readSettings, false),
  ['plugin:wxwork@local', 'plugin:qq@local'],
  'disabled user settings leave managed channels active',
)
assertDeepEqual(
  requestedSources,
  ['policySettings'],
  'disabled user source is not read',
)

assert(
  !SettingsSchema().safeParse({ channels: [''] }).success,
  'empty channel entries are rejected',
)

console.log('channel settings validation passed')
