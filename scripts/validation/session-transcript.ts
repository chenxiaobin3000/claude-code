#!/usr/bin/env bun

import type { Entry, TranscriptMessage } from '../../src/types/logs.js'
import type { Message } from '../../src/types/message.js'
import {
  extractAgentIdsFromMessages,
  extractTeammateTranscriptsFromTasks,
} from '../../src/utils/sessionStorage/agentTranscripts.js'
import { walkParentChain } from '../../src/utils/sessionStorage/conversationChain.js'
import {
  isChainParticipant,
  isTranscriptMessage,
  removeExtraFields,
} from '../../src/utils/sessionStorage/entries.js'
import {
  applySnipRemovals,
  buildConversationChain,
} from '../../src/utils/sessionStorage/recovery.js'
import { assert, assertDeepEqual, assertEqual } from './assertions.js'

const user = {
  type: 'user',
  uuid: '00000000-0000-4000-8000-000000000001',
  parentUuid: null,
  isSidechain: false,
  message: { role: 'user', content: 'hello' },
} as unknown as TranscriptMessage
assert(isTranscriptMessage(user as Entry), 'user transcript guard')
assert(
  !isChainParticipant({ type: 'progress' }),
  'progress excluded from chain',
)
const serialized = removeExtraFields([user])[0] as Record<string, unknown>
assert(
  !('parentUuid' in serialized) && !('isSidechain' in serialized),
  'runtime fields removed',
)

const progress = (agentId: string) =>
  ({
    type: 'progress',
    data: { type: 'agent_progress', agentId },
  }) as unknown as Message
assertDeepEqual(
  extractAgentIdsFromMessages([progress('a'), progress('a'), progress('b')]),
  ['a', 'b'],
  'agent IDs deduplicated',
)
assertDeepEqual(
  Object.keys(
    extractTeammateTranscriptsFromTasks({
      one: {
        type: 'in_process_teammate',
        identity: { agentId: 'a' },
        messages: [progress('a')],
      },
      two: { type: 'other' },
    }),
  ),
  ['a'],
  'teammate transcript projection',
)

const root = { uuid: 'root', parentUuid: null }
const leaf = { uuid: 'leaf', parentUuid: 'root' }
assertDeepEqual(
  walkParentChain(
    new Map([
      ['root', root],
      ['leaf', leaf],
    ]),
    leaf,
  ).chain,
  [root, leaf],
  'parent chain order',
)
const cyclic = { uuid: 'cycle', parentUuid: 'cycle' }
assert(
  walkParentChain(new Map([['cycle', cyclic]]), cyclic).cycleAt === 'cycle',
  'cycle detected',
)

const removed = {
  ...user,
  uuid: '00000000-0000-4000-8000-000000000002',
  parentUuid: user.uuid,
}
const survivor = {
  ...user,
  uuid: '00000000-0000-4000-8000-000000000003',
  parentUuid: removed.uuid,
}
const snipBoundary = {
  type: 'system',
  subtype: 'microcompact_boundary',
  uuid: '00000000-0000-4000-8000-000000000004',
  parentUuid: survivor.uuid,
  timestamp: new Date().toISOString(),
  snipMetadata: { removedUuids: [removed.uuid] },
} as unknown as TranscriptMessage
const transcriptMap = new Map([
  [user.uuid, user],
  [removed.uuid, removed],
  [survivor.uuid, survivor],
  [snipBoundary.uuid, snipBoundary],
])
applySnipRemovals(transcriptMap)
assert(!transcriptMap.has(removed.uuid), 'snipped message removed')
assertEqual(
  transcriptMap.get(survivor.uuid)?.parentUuid,
  user.uuid,
  'snip gap relinked',
)
assertDeepEqual(
  buildConversationChain(transcriptMap, snipBoundary).map(
    message => message.uuid,
  ),
  [user.uuid, survivor.uuid, snipBoundary.uuid],
  'recovered conversation chain',
)

console.log('[session-transcript] PASS')
