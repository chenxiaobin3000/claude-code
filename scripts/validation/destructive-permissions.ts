#!/usr/bin/env bun

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { BashTool } from '../../packages/builtin-tools/src/tools/BashTool/BashTool.js'
import { bashToolHasPermission } from '../../packages/builtin-tools/src/tools/BashTool/bashPermissions.js'
import {
  classifyDestructiveArgv,
  type DestructiveOperation,
} from '../../packages/builtin-tools/src/tools/destructiveOperations.js'
import { PowerShellTool } from '../../packages/builtin-tools/src/tools/PowerShellTool/PowerShellTool.js'
import { powershellToolHasPermission } from '../../packages/builtin-tools/src/tools/PowerShellTool/powershellPermissions.js'
import type { ToolUseContext } from '../../src/Tool.js'
import { getEmptyToolPermissionContext } from '../../src/Tool.js'
import type { PermissionMode } from '../../src/types/permissions.js'
import { hasPermissionsToUseTool } from '../../src/utils/permissions/permissions.js'
import { assert, assertEqual } from './assertions.js'

const root = resolve(import.meta.dir, '../..')
assert(
  !existsSync(
    resolve(
      root,
      'packages/builtin-tools/src/tools/BashTool/destructiveCommandWarning.ts',
    ),
  ),
  'Bash raw-string destructive warning layer was restored',
)
assert(
  !existsSync(
    resolve(
      root,
      'packages/builtin-tools/src/tools/PowerShellTool/destructiveCommandWarning.ts',
    ),
  ),
  'PowerShell raw-string destructive warning layer was restored',
)

for (const [path, required] of [
  [
    'packages/builtin-tools/src/tools/BashTool/bashPermissions.ts',
    ['classifyDestructiveArgv', "type: 'destructiveOperation'"],
  ],
  [
    'packages/builtin-tools/src/tools/PowerShellTool/powershellPermissions.ts',
    ['classifyDestructiveArgv', "type: 'destructiveOperation'"],
  ],
  [
    'src/utils/permissions/permissions.ts',
    ["decisionReason?.type === 'destructiveOperation'"],
  ],
  [
    'src/components/permissions/BashPermissionRequest/bashToolUseOptions.tsx',
    ["decisionReason?.type !== 'destructiveOperation'"],
  ],
] as const) {
  const source = readFileSync(resolve(root, path), 'utf8')
  for (const marker of required) {
    assert(
      source.includes(marker),
      `${path} lost destructive boundary ${marker}`,
    )
  }
}

const destructiveArgv: Array<[string, string[]]> = [
  ['git reset --hard', ['git', 'reset', '--hard', 'HEAD~1']],
  ['git clean -fdx', ['git', 'clean', '-fdx']],
  ['git checkout -- .', ['git', 'checkout', '--', '.']],
  ['git restore -- .', ['git', 'restore', '--', '.']],
  ['git stash drop', ['git', 'stash', 'drop', 'stash@{0}']],
  ['git stash clear', ['git', 'stash', 'clear']],
  ['git branch -D', ['git', 'branch', '-D', 'topic']],
  ['git force push', ['git', 'push', '--force-with-lease=main']],
  ['wrapped git reset', ['timeout', '30', 'git', '-C', '.', 'reset', '--hard']],
  ['recursive rm', ['rm', '-rf', './build']],
  ['Remove-Item', ['Remove-Item', './build', '-Recurse', '-Force']],
  ['Clear-Disk', ['Clear-Disk', '-Number', '1']],
  ['Format-Volume', ['Format-Volume', '-DriveLetter', 'Z']],
  ['terraform destroy', ['terraform', 'destroy', '-auto-approve']],
  ['terraform apply -destroy', ['terraform', 'apply', '-destroy']],
  ['kubectl delete', ['kubectl', 'delete', 'deployment', 'web']],
  ['PostgreSQL DROP', ['psql', '-c', 'DROP TABLE users']],
  ['MySQL TRUNCATE', ['mysql', '-e', 'TRUNCATE TABLE users']],
  ['SQLite unconditional DELETE', ['sqlite3', 'app.db', 'DELETE FROM users']],
  [
    'Invoke-Sqlcmd unconditional DELETE',
    ['Invoke-Sqlcmd', '-Query', 'DELETE FROM users'],
  ],
  [
    'CTE unconditional DELETE',
    ['psql', '-c', 'WITH old AS (SELECT 1) DELETE FROM users'],
  ],
]

for (const [label, argv] of destructiveArgv) {
  assert(classifyDestructiveArgv(argv) !== null, `${label} was not classified`)
}

const safeArgv: Array<[string, string[]]> = [
  ['git clean dry-run', ['git', 'clean', '-nfdx']],
  ['git branch normal delete', ['git', 'branch', '-d', 'merged-topic']],
  ['normal git push', ['git', 'push', 'origin', 'topic']],
  ['single-file rm', ['rm', './temporary.txt']],
  ['kubectl dry-run', ['kubectl', 'delete', 'pod', 'web', '--dry-run=client']],
  ['terraform destroy plan', ['terraform', 'plan', '-destroy']],
  ['conditional SQL delete', ['psql', '-c', 'DELETE FROM users WHERE id = 1']],
  ['SQL keyword in a literal', ['psql', '-c', "SELECT 'DROP TABLE users'"]],
]

for (const [label, argv] of safeArgv) {
  assertEqual(classifyDestructiveArgv(argv), null, `${label} false positive`)
}

function permissionContext(
  toolName: 'Bash' | 'PowerShell',
  command: string,
  options: { mode?: PermissionMode; broadAllow?: boolean; deny?: boolean } = {},
): ToolUseContext {
  const exactRule = `${toolName}(${command})`
  const allowRule = options.broadAllow ? `${toolName}(*)` : exactRule
  const toolPermissionContext = {
    ...getEmptyToolPermissionContext(),
    mode: options.mode ?? 'default',
    alwaysAllowRules: { cliArg: options.deny ? [] : [allowRule] },
    alwaysDenyRules: { cliArg: options.deny ? [exactRule] : [] },
  }
  const appState = { toolPermissionContext }
  return {
    abortController: new AbortController(),
    options: { isNonInteractiveSession: false },
    getAppState: () => appState,
    setAppState: () => {},
  } as unknown as ToolUseContext
}

function assertDestructiveAsk(
  label: string,
  result: Awaited<ReturnType<typeof bashToolHasPermission>>,
): void {
  assertEqual(result.behavior, 'ask', label)
  assertEqual(
    result.decisionReason?.type,
    'destructiveOperation',
    `${label} decision reason`,
  )
  assert(
    !('suggestions' in result) || result.suggestions?.length === 0,
    `${label} offered a persistent rule`,
  )
  assert(
    !('pendingClassifierCheck' in result) ||
      result.pendingClassifierCheck === undefined,
    `${label} scheduled classifier auto-approval`,
  )
}

const bashCommands = [
  'git reset --hard HEAD~1',
  'git clean -fdx',
  'git checkout -- .',
  'git restore -- .',
  'git stash drop',
  'git stash clear',
  'git branch -D topic',
  'git push --force-with-lease origin topic',
  'rm -rf ./build',
  'terraform destroy -auto-approve',
  'terraform apply -destroy',
  'kubectl delete deployment web',
  `psql -c 'DROP TABLE users'`,
  `mysql -e 'TRUNCATE TABLE users'`,
  `sqlite3 app.db 'DELETE FROM users'`,
  'echo ok && git clean -fd',
]

for (const command of bashCommands) {
  assertDestructiveAsk(
    `Bash exact allow: ${command}`,
    await bashToolHasPermission(
      { command },
      permissionContext('Bash', command),
    ),
  )
}

const broadBash = 'git push --force origin main'
assertDestructiveAsk(
  'Bash broad allow',
  await bashToolHasPermission(
    { command: broadBash },
    permissionContext('Bash', broadBash, { broadAllow: true }),
  ),
)

const acceptEditsBash = 'rm -rf ./generated'
assertDestructiveAsk(
  'Bash acceptEdits',
  await bashToolHasPermission(
    { command: acceptEditsBash },
    permissionContext('Bash', acceptEditsBash, { mode: 'acceptEdits' }),
  ),
)

const deniedBash = await bashToolHasPermission(
  { command: 'git reset --hard' },
  permissionContext('Bash', 'git reset --hard', { deny: true }),
)
assertEqual(deniedBash.behavior, 'deny', 'Bash explicit deny precedence')

const powershellCommands = [
  'git reset --hard HEAD~1',
  'git clean -fdx',
  'git checkout -- .',
  'git restore -- .',
  'git stash drop',
  'git stash clear',
  'git branch -D topic',
  'git push --force origin topic',
  'Remove-Item ./build -Recurse -Force',
  'rm ./build -Recurse -Force',
  'Clear-Disk -Number 1',
  'Format-Volume -DriveLetter Z',
  'terraform destroy -auto-approve',
  'kubectl delete deployment web',
  `psql -c 'DROP TABLE users'`,
  `Invoke-Sqlcmd -Query 'DELETE FROM users'`,
  'if ($true) { Clear-Disk -Number 1 }',
  'Remove-Item ./build –Recurse –Force',
]

for (const command of powershellCommands) {
  assertDestructiveAsk(
    `PowerShell exact allow: ${command}`,
    await powershellToolHasPermission(
      { command },
      permissionContext('PowerShell', command),
    ),
  )
}

const broadPowerShell = 'Clear-Disk -Number 1'
assertDestructiveAsk(
  'PowerShell broad allow',
  await powershellToolHasPermission(
    { command: broadPowerShell },
    permissionContext('PowerShell', broadPowerShell, { broadAllow: true }),
  ),
)

const acceptEditsPowerShell = 'Remove-Item ./generated -Recurse -Force'
assertDestructiveAsk(
  'PowerShell acceptEdits',
  await powershellToolHasPermission(
    { command: acceptEditsPowerShell },
    permissionContext('PowerShell', acceptEditsPowerShell, {
      mode: 'acceptEdits',
    }),
  ),
)

const deniedPowerShell = await powershellToolHasPermission(
  { command: 'git reset --hard' },
  permissionContext('PowerShell', 'git reset --hard', { deny: true }),
)
assertEqual(
  deniedPowerShell.behavior,
  'deny',
  'PowerShell explicit deny precedence',
)

async function assertBypassImmune(
  label: string,
  tool: typeof BashTool | typeof PowerShellTool,
  command: string,
): Promise<void> {
  const result = await hasPermissionsToUseTool(
    tool,
    { command },
    permissionContext(tool.name as 'Bash' | 'PowerShell', command, {
      mode: 'bypassPermissions',
      broadAllow: true,
    }),
    {} as never,
    `${label}-tool-use`,
  )
  assertEqual(result.behavior, 'ask', `${label} bypass immunity`)
  assertEqual(
    result.decisionReason?.type,
    'destructiveOperation',
    `${label} bypass decision reason`,
  )
}

await assertBypassImmune('Bash', BashTool, 'git reset --hard')
await assertBypassImmune('PowerShell', PowerShellTool, 'Clear-Disk -Number 1')

const protectedBash = await bashToolHasPermission(
  { command: 'rm -rf /' },
  permissionContext('Bash', 'rm -rf /'),
)
assertDestructiveAsk('Bash protected path is non-persistable', protectedBash)

const protectedPowerShell = await powershellToolHasPermission(
  { command: 'Remove-Item / -Recurse -Force' },
  permissionContext('PowerShell', 'Remove-Item / -Recurse -Force'),
)
assertEqual(
  protectedPowerShell.behavior,
  'deny',
  'PowerShell protected path hard deny',
)

const classified = classifyDestructiveArgv([
  'git',
  'push',
  '--force-with-lease',
]) as DestructiveOperation
assertEqual(classified.severity, 'mandatory-ask', 'destructive severity')

console.log('[destructive-permissions] PASS')
