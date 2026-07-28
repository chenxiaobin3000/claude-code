#!/usr/bin/env bun

import { readFileSync } from 'node:fs'
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
import { BashTool } from '../../packages/builtin-tools/src/tools/BashTool/BashTool.js'
import { HookCommandSchema } from '../../src/schemas/hooks.js'
import { deduplicateMatchedHooks } from '../../src/utils/hooks/selection.js'
import { createMcpHookInvoker } from '../../src/services/tools/mcpHookInvoker.js'
import type { Tool, ToolUseContext } from '../../src/Tool.js'
import type { CanUseToolFn } from '../../src/hooks/useCanUseTool.js'
import type { AssistantMessage } from '../../src/types/message.js'
import { z } from 'zod/v4'
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

const compoundBashMatcher = await BashTool.preparePermissionMatcher?.({
  command: 'ls && FOO=bar git push origin main',
})
assert(
  compoundBashMatcher?.('git *') === true,
  'Hook if did not match a nested Bash subcommand',
)
assert(
  compoundBashMatcher?.('npm *') === false,
  'Hook if matched an unrelated nested Bash subcommand',
)

const mcpHook = HookCommandSchema().parse({
  type: 'mcp',
  tool: 'mcp__local__validate',
  input: { strict: true },
  timeout: 2,
})
assertEqual(mcpHook.type, 'mcp', 'MCP hook schema')
assertEqual(
  deduplicateMatchedHooks([
    { hook: mcpHook, pluginRoot: '/one' },
    { hook: mcpHook, pluginRoot: '/one' },
    { hook: mcpHook, pluginRoot: '/two' },
  ]).length,
  2,
  'MCP hook dedup respects local source boundary',
)
let mcpCallReached = false
const guardedMcpTool = {
  name: 'mcp__local__validate',
  isMcp: true,
  inputSchema: z.object({ strict: z.boolean() }),
  call: async () => {
    mcpCallReached = true
    return { data: 'unexpected' }
  },
} as unknown as Tool
const denyMcp = (async () => ({
  behavior: 'deny',
  message: 'validation denial',
  decisionReason: { type: 'mode', mode: 'default' },
})) as CanUseToolFn
const invokeMcp = createMcpHookInvoker(
  { options: { tools: [guardedMcpTool] } } as unknown as ToolUseContext,
  denyMcp,
  {} as AssistantMessage,
)
let mcpDenied = false
try {
  await invokeMcp({
    toolName: guardedMcpTool.name,
    input: { strict: true },
    toolUseId: 'hook-tool-1',
    signal: new AbortController().signal,
  })
} catch (error) {
  mcpDenied = String(error).includes('validation denial')
}
assert(mcpDenied, 'MCP hook permission denial did not propagate')
assert(!mcpCallReached, 'MCP hook bypassed permission denial')

const hookRuntimeSource = readFileSync(
  new URL('../../src/utils/hooksRuntime.ts', import.meta.url),
  'utf8',
)
assert(
  hookRuntimeSource.includes('Failed to sandbox direct argv hook'),
  'direct argv Hook no longer fails closed when Sandbox wrapping is unavailable',
)
const mcpCommandSource = readFileSync(
  new URL('../../src/commands/mcp/mcp.tsx', import.meta.url),
  'utf8',
)
assert(
  mcpCommandSource.includes('performMCPOAuthFlow('),
  '/mcp login no longer starts the OAuth flow',
)
assert(
  mcpCommandSource.includes('disconnectMcpServerForLogout(target)'),
  '/mcp logout no longer uses the managed disconnect lifecycle',
)

console.log('[hook-protocol] PASS')
