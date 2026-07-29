#!/usr/bin/env bun

import { assert } from './assertions.js'

const root = new URL('../../', import.meta.url)
const commands = await Bun.file(new URL('src/commands.ts', root)).text()
const branch = await Bun.file(
  new URL('src/commands/branch/branch.ts', root),
).text()
const fork = await Bun.file(
  new URL('src/commands/fork/fork.tsx', root),
).text()
const subtask = await Bun.file(
  new URL('src/commands/subtask/subtask.tsx', root),
).text()

assert(
  commands.includes("import fork from './commands/fork/index.js'") &&
    commands.includes("import subtask from './commands/subtask/index.js'"),
  '/fork and /subtask must both be stable registered commands',
)
assert(
  branch.includes('export async function createNamedSessionFork'),
  'conversation fork creation must be reusable without switching the foreground session',
)
assert(
  fork.includes('createNamedSessionFork') &&
    fork.includes('startBackgroundSession') &&
    fork.includes("'--resume'") &&
    !fork.includes('AgentTool.call'),
  '/fork must create and launch an independent resumable Session',
)
assert(
  subtask.includes('AgentTool.call') &&
    subtask.includes('run_in_background: true') &&
    !subtask.includes('startBackgroundSession'),
  '/subtask must remain an in-session background Agent delegation',
)
assert(
  fork.includes('Session ID:') &&
    fork.includes('claude daemon attach') &&
    fork.includes('claude daemon kill'),
  '/fork must return stable management handles',
)

console.log('agent fork/subtask validation passed')
