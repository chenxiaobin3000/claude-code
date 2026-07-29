#!/usr/bin/env bun

import {
  resolveAgentBackgroundDecision,
  type AgentBackgroundDecision,
} from '../../src/utils/agentExecutionPolicy.js'
import { assertEqual } from './assertions.js'

function check(
  name: string,
  input: Parameters<typeof resolveAgentBackgroundDecision>[0],
  expected: AgentBackgroundDecision,
): void {
  const actual = resolveAgentBackgroundDecision(input)
  assertEqual(actual.runInBackground, expected.runInBackground, `${name} mode`)
  assertEqual(actual.reason, expected.reason, `${name} reason`)
}

check(
  'disable overrides explicit background',
  { backgroundTasksDisabled: true, explicit: true },
  {
    runInBackground: false,
    reason: 'background_tasks_disabled',
  },
)
check(
  'unsupported context remains foreground',
  {
    backgroundTasksDisabled: false,
    backgroundSupported: false,
    explicit: false,
    forced: true,
  },
  { runInBackground: false, reason: 'background_unsupported' },
)
check(
  'forced context overrides explicit and definition foreground',
  {
    backgroundTasksDisabled: false,
    explicit: false,
    agentDefault: false,
    forced: true,
  },
  { runInBackground: true, reason: 'forced_context' },
)
check(
  'explicit foreground',
  { backgroundTasksDisabled: false, explicit: false },
  { runInBackground: false, reason: 'explicit_input' },
)
check(
  'explicit background',
  { backgroundTasksDisabled: false, explicit: true },
  { runInBackground: true, reason: 'explicit_input' },
)
check(
  'agent definition foreground',
  { backgroundTasksDisabled: false, agentDefault: false },
  { runInBackground: false, reason: 'agent_definition' },
)
check(
  'agent definition background',
  { backgroundTasksDisabled: false, agentDefault: true },
  { runInBackground: true, reason: 'agent_definition' },
)
check(
  'forced context',
  { backgroundTasksDisabled: false, forced: true },
  { runInBackground: true, reason: 'forced_context' },
)
check(
  'official default background',
  { backgroundTasksDisabled: false },
  { runInBackground: true, reason: 'default_background' },
)

const projectRoot = new URL('../../', import.meta.url)
const agentLoaderSource = await Bun.file(
  new URL(
    'packages/builtin-tools/src/tools/AgentTool/loadAgentsDir.ts',
    projectRoot,
  ),
).text()
const promptSource = await Bun.file(
  new URL(
    'packages/builtin-tools/src/tools/AgentTool/prompt.ts',
    projectRoot,
  ),
).text()

assertEqual(
  agentLoaderSource.includes('background !== undefined ? { background }'),
  true,
  'agent frontmatter preserves background false',
)
assertEqual(
  promptSource.includes('Agents run in the background by default'),
  true,
  'Agent prompt advertises background default',
)
assertEqual(
  promptSource.includes('Use foreground (default)'),
  false,
  'stale foreground-default wording removed',
)

console.log('agent background policy validation passed')
