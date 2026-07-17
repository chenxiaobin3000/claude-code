#!/usr/bin/env bun

import type { Entry, TranscriptMessage } from '../../src/types/logs.js'
import type { Message } from '../../src/types/message.js'
import { extractAgentIdsFromMessages, extractTeammateTranscriptsFromTasks } from '../../src/utils/sessionStorage/agentTranscripts.js'
import { walkParentChain } from '../../src/utils/sessionStorage/conversationChain.js'
import { isChainParticipant, isTranscriptMessage, removeExtraFields } from '../../src/utils/sessionStorage/entries.js'
import { assert, assertDeepEqual } from './assertions.js'

const user = {
  type: 'user',
  uuid: '00000000-0000-4000-8000-000000000001',
  parentUuid: null,
  isSidechain: false,
  message: { role: 'user', content: 'hello' },
} as unknown as TranscriptMessage
assert(isTranscriptMessage(user as Entry), 'user transcript guard')
assert(!isChainParticipant({ type: 'progress' }), 'progress excluded from chain')
const serialized = removeExtraFields([user])[0] as Record<string, unknown>
assert(!('parentUuid' in serialized) && !('isSidechain' in serialized), 'runtime fields removed')

const progress = (agentId: string) => ({
  type: 'progress',
  data: { type: 'agent_progress', agentId },
}) as unknown as Message
assertDeepEqual(extractAgentIdsFromMessages([progress('a'), progress('a'), progress('b')]), ['a', 'b'], 'agent IDs deduplicated')
assertDeepEqual(Object.keys(extractTeammateTranscriptsFromTasks({ one: { type: 'in_process_teammate', identity: { agentId: 'a' }, messages: [progress('a')] }, two: { type: 'other' } })), ['a'], 'teammate transcript projection')

const root = { uuid: 'root', parentUuid: null }
const leaf = { uuid: 'leaf', parentUuid: 'root' }
assertDeepEqual(walkParentChain(new Map([['root', root], ['leaf', leaf]]), leaf).chain, [root, leaf], 'parent chain order')
const cyclic = { uuid: 'cycle', parentUuid: 'cycle' }
assert(walkParentChain(new Map([['cycle', cyclic]]), cyclic).cycleAt === 'cycle', 'cycle detected')

console.log('[session-transcript] PASS')
