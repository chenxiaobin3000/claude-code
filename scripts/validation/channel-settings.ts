#!/usr/bin/env bun

import {
  resolveChannelSelections,
  type ChannelSettingsReader,
} from '../../src/services/mcp/channelConfiguration.js'
import { SettingsSchema } from '../../src/utils/settings/types.js'
import { assert, assertDeepEqual } from './assertions.js'

const parsed = SettingsSchema().parse({
  channels: [
    {
      plugin: 'plugin:weixin@local',
      reply: 'mcp__plugin_weixin_weixin__reply',
    },
  ],
})
assertDeepEqual(
  parsed.channels,
  [
    {
      plugin: 'plugin:weixin@local',
      reply: 'mcp__plugin_weixin_weixin__reply',
    },
  ],
  'settings schema accepts persistent channels',
)

const requestedSources: string[] = []
const readSettings: ChannelSettingsReader = source => {
  requestedSources.push(source)
  if (source === 'userSettings') {
    return {
      channels: [
        {
          plugin: 'plugin:weixin@local',
          reply: 'mcp__plugin_weixin_weixin__reply',
        },
        {
          plugin: 'plugin:qq@local',
          reply: 'mcp__plugin_qq_qq__reply',
        },
      ],
    }
  }
  return {
    channels: [
      {
        plugin: 'plugin:wxwork@local',
        reply: 'mcp__plugin_wxwork_wxwork__reply',
      },
      {
        plugin: 'plugin:qq@local',
        reply: 'mcp__plugin_qq_qq__reply',
      },
    ],
  }
}

assertDeepEqual(
  resolveChannelSelections(
    ['plugin:telegram@local', 'plugin:weixin@local'],
    readSettings,
  ),
  [
    { plugin: 'plugin:telegram@local' },
    {
      plugin: 'plugin:weixin@local',
      reply: 'mcp__plugin_weixin_weixin__reply',
    },
    {
      plugin: 'plugin:qq@local',
      reply: 'mcp__plugin_qq_qq__reply',
    },
    {
      plugin: 'plugin:wxwork@local',
      reply: 'mcp__plugin_wxwork_wxwork__reply',
    },
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
  [
    {
      plugin: 'plugin:wxwork@local',
      reply: 'mcp__plugin_wxwork_wxwork__reply',
    },
    {
      plugin: 'plugin:qq@local',
      reply: 'mcp__plugin_qq_qq__reply',
    },
  ],
  'disabled user settings leave managed channels active',
)
assertDeepEqual(
  requestedSources,
  ['policySettings'],
  'disabled user source is not read',
)

assert(
  !SettingsSchema().safeParse({ channels: ['plugin:qq@local'] }).success,
  'legacy string channel entries are rejected',
)
assert(
  !SettingsSchema().safeParse({
    channels: [{ plugin: 'plugin:qq@local', reply: 'reply' }],
  }).success,
  'unqualified Channel reply tools are rejected',
)

let conflict = ''
try {
  resolveChannelSelections(undefined, source => ({
    channels: [
      {
        plugin: 'plugin:qq@local',
        reply:
          source === 'userSettings'
            ? 'mcp__plugin_qq_qq__reply'
            : 'mcp__plugin_qq_qq__other',
      },
    ],
  }))
} catch (error) {
  conflict = error instanceof Error ? error.message : String(error)
}
assert(conflict.includes('conflicting reply tools'), 'reply conflicts fail')

console.log('channel settings validation passed')
