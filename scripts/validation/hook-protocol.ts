#!/usr/bin/env bun

import {
  getStopHookMessage,
  hasBlockingResult,
} from '../../src/utils/hooks/blockingMessages.js'
import {
  buildHookDedupKey,
  matchesHookPattern,
} from '../../src/utils/hooks/matcher.js'
import {
  parseHookOutput,
  parseHttpHookOutput,
} from '../../src/utils/hooks/outputParser.js'
import { parseElicitationHookOutput } from '../../src/utils/hooks/elicitationParser.js'
import { processHookJSONOutput } from '../../src/utils/hooks/resultProcessor.js'
import { assert, assertEqual } from './assertions.js'

assert(matchesHookPattern('Read', 'Read|Edit'), 'pipe matcher')
assert(matchesHookPattern('Read', '^R.*$'), 'regex matcher')
assert(!matchesHookPattern('Read', '['), 'invalid regex rejected')
assertEqual(
  buildHookDedupKey('/plugin', 'command'),
  '/plugin\0command',
  'dedup namespace',
)
assertEqual(parseHookOutput('plain').plainText, 'plain', 'plain command output')
assert(
  parseHookOutput('{"continue":true}').json !== undefined,
  'JSON command output',
)
assert(
  parseHttpHookOutput('not-json').validationError !== undefined,
  'HTTP requires JSON',
)
assertEqual(
  getStopHookMessage({ blockingError: 'fix it' }),
  'Stop hook feedback:\nfix it',
  'blocking message',
)
assert(
  hasBlockingResult([{ blocked: false }, { blocked: true }]),
  'blocking aggregation',
)
const elicitation = parseElicitationHookOutput(
  {
    command: 'hook',
    succeeded: true,
    blocked: false,
    output: JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'Elicitation',
        action: 'accept',
        content: { value: 'ok' },
      },
    }),
  },
  'Elicitation',
)
assertEqual(elicitation.response?.action, 'accept', 'elicitation action parsed')

const processed = processHookJSONOutput({
  json: {
    continue: false,
    stopReason: 'stop',
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: 'policy',
    },
  },
  command: 'hook',
  hookName: 'validation',
  toolUseID: 'tool-1',
  hookEvent: 'PreToolUse',
  expectedHookEvent: 'PreToolUse',
})
assert(processed.preventContinuation, 'hook continuation stopped')
assertEqual(processed.permissionBehavior, 'deny', 'hook permission processed')
assertEqual(
  processed.blockingError?.blockingError,
  'policy',
  'hook denial reason',
)

console.log('[hook-protocol] PASS')
