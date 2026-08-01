#!/usr/bin/env bun

import {
  chromeTabRouteKey,
  selectChromeEndpointId,
} from '../../plugins/claudeinchrome/mcp/mcpSocketPool.js'
import type { ChromeSocketEndpoint } from '../../plugins/claudeinchrome/protocol/index.js'

const profiles: ChromeSocketEndpoint[] = [
  {
    id: 'endpoint-a',
    host: '127.0.0.1',
    port: 41001,
    token: 'a'.repeat(64),
    pid: 1001,
    profileId: '00000000-0000-4000-8000-000000000001',
    profileName: 'Trading A',
  },
  {
    id: 'endpoint-b',
    host: '127.0.0.1',
    port: 41002,
    token: 'b'.repeat(64),
    pid: 1002,
    profileId: '00000000-0000-4000-8000-000000000002',
    profileName: 'Trading B',
  },
]

function expect(label: string, actual: unknown, expected: unknown): void {
  if (actual !== expected) {
    throw new Error(
      `[claudeinchrome-profiles] ${label}: expected ${String(expected)}, received ${String(actual)}`,
    )
  }
}

function expectFailure(
  label: string,
  action: () => unknown,
  text: string,
): void {
  try {
    action()
  } catch (error) {
    if (error instanceof Error && error.message.includes(text)) return
    throw error
  }
  throw new Error(`[claudeinchrome-profiles] ${label}: expected failure`)
}

expect(
  'single profile automatic selection',
  selectChromeEndpointId({}, profiles.slice(0, 1), new Map()),
  'endpoint-a',
)
expect(
  'explicit profile selection',
  selectChromeEndpointId(
    { profileId: profiles[1]!.profileId },
    profiles,
    new Map(),
  ),
  'endpoint-b',
)
expectFailure(
  'unknown profile refusal',
  () =>
    selectChromeEndpointId(
      { profileId: '00000000-0000-4000-8000-000000000099' },
      profiles,
      new Map(),
    ),
  'is not connected',
)
expectFailure(
  'implicit multi-profile refusal',
  () => selectChromeEndpointId({}, profiles, new Map()),
  'Multiple Chrome profiles',
)
expectFailure(
  'duplicate profile identity refusal',
  () =>
    selectChromeEndpointId(
      { profileId: profiles[0]!.profileId },
      [profiles[0]!, { ...profiles[1]!, profileId: profiles[0]!.profileId }],
      new Map(),
    ),
  'duplicated across multiple extension instances',
)

const uniqueRoute = new Map([
  [chromeTabRouteKey(profiles[0]!.profileId, 77), profiles[0]!.id],
])
expect(
  'unique tab route',
  selectChromeEndpointId({ tabId: 77 }, profiles, uniqueRoute),
  'endpoint-a',
)

const collidingRoutes = new Map([
  [chromeTabRouteKey(profiles[0]!.profileId, 77), profiles[0]!.id],
  [chromeTabRouteKey(profiles[1]!.profileId, 77), profiles[1]!.id],
])
expectFailure(
  'colliding tab route refusal',
  () => selectChromeEndpointId({ tabId: 77 }, profiles, collidingRoutes),
  'exists in multiple Chrome profiles',
)
expect(
  'explicit profile overrides colliding tab IDs',
  selectChromeEndpointId(
    { profileId: profiles[1]!.profileId, tabId: 77 },
    profiles,
    collidingRoutes,
  ),
  'endpoint-b',
)

console.log('[claudeinchrome-profiles] PASS')
