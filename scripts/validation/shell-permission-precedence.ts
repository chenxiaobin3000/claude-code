#!/usr/bin/env bun

import { BashTool } from '../../packages/builtin-tools/src/tools/BashTool/BashTool.js'
import { bashToolHasPermission } from '../../packages/builtin-tools/src/tools/BashTool/bashPermissions.js'
import { PowerShellTool } from '../../packages/builtin-tools/src/tools/PowerShellTool/PowerShellTool.js'
import { powershellToolHasPermission } from '../../packages/builtin-tools/src/tools/PowerShellTool/powershellPermissions.js'
import type { Tool, ToolUseContext } from '../../src/Tool.js'
import { getEmptyToolPermissionContext } from '../../src/Tool.js'
import type { PermissionResult } from '../../src/types/permissions.js'
import { PARSE_UNAVAILABLE } from '../../src/utils/bash/parser.js'
import { hasPermissionsToUseTool } from '../../src/utils/permissions/permissions.js'
import {
  reduceShellDecisions,
  type ShellDecisionCategory,
} from '../../src/utils/permissions/shellDecision.js'
import { assert, assertEqual } from './assertions.js'

type RuleSet = {
  allow?: string[]
  ask?: string[]
  deny?: string[]
  mode?: 'default' | 'acceptEdits' | 'bypassPermissions'
}

function context(rules: RuleSet = {}): ToolUseContext {
  const toolPermissionContext = {
    ...getEmptyToolPermissionContext(),
    mode: rules.mode ?? 'default',
    alwaysAllowRules: { cliArg: rules.allow ?? [] },
    alwaysAskRules: { cliArg: rules.ask ?? [] },
    alwaysDenyRules: { cliArg: rules.deny ?? [] },
  }
  const appState = { toolPermissionContext }
  return {
    abortController: new AbortController(),
    options: { isNonInteractiveSession: false },
    getAppState: () => appState,
    setAppState: () => {},
  } as unknown as ToolUseContext
}

async function fullDecision(
  tool: Tool,
  command: string,
  rules: RuleSet,
): Promise<PermissionResult> {
  return hasPermissionsToUseTool(
    tool,
    { command },
    context(rules),
    {} as never,
    `precedence-${tool.name}`,
  )
}

function assertBehavior(
  actual: PermissionResult,
  expected: 'allow' | 'ask' | 'deny',
  label: string,
): void {
  assertEqual(actual.behavior, expected, label)
}

const categories: ShellDecisionCategory[] = [
  'default-ask',
  'constrained-allow',
  'exact-allow',
  'explicit-ask',
  'mandatory-ask',
  'explicit-deny',
  'hard-deny',
]
const selected = reduceShellDecisions(
  categories.map(category => ({
    category,
    result:
      category.endsWith('deny')
        ? {
            behavior: 'deny' as const,
            message: category,
            decisionReason: { type: 'other' as const, reason: category },
          }
        : category.endsWith('ask')
          ? { behavior: 'ask' as const, message: category }
          : { behavior: 'allow' as const },
  })),
)
assertEqual(selected?.behavior, 'deny', 'shared reducer behavior')
assertEqual(selected?.message, 'hard-deny', 'shared reducer rank')

assertBehavior(
  await fullDecision(BashTool, 'echo ok && rm -rf ./build', {
    ask: ['Bash'],
    deny: ['Bash(rm:*)'],
  }),
  'deny',
  'Bash tool ask cannot mask later subcommand deny',
)
assertBehavior(
  await fullDecision(BashTool, 'printf ok | rm -rf ./build', {
    ask: ['Bash(printf:*)'],
    deny: ['Bash(rm:*)'],
  }),
  'deny',
  'Bash pipeline ask cannot mask later segment deny',
)
assertBehavior(
  await fullDecision(BashTool, 'echo $(rm -rf ./build)', {
    allow: ['Bash(*)'],
    deny: ['Bash(rm:*)'],
  }),
  'deny',
  'Bash nested command deny',
)
assertBehavior(
  await fullDecision(
    PowerShellTool,
    "Get-Process; Invoke-Expression 'Write-Output bad'",
    {
      ask: ['PowerShell'],
      deny: ['PowerShell(Invoke-Expression:*)'],
    },
  ),
  'deny',
  'PowerShell tool ask cannot mask later statement deny',
)

const powerShellHardDeny = await fullDecision(
  PowerShellTool,
  'Remove-Item / -Recurse -Force',
  {
    allow: ['PowerShell(*)'],
    deny: ['PowerShell(Remove-Item:*)'],
  },
)
assertBehavior(
  powerShellHardDeny,
  'deny',
  'PowerShell hard safety deny behavior',
)
assertEqual(
  powerShellHardDeny.decisionReason?.type,
  'destructiveOperation',
  'PowerShell hard safety deny beats explicit deny',
)
if (powerShellHardDeny.decisionReason?.type === 'destructiveOperation') {
  assertEqual(
    powerShellHardDeny.decisionReason.severity,
    'hard-deny',
    'PowerShell hard safety severity',
  )
}

for (const [label, tool, command, allowRule] of [
  [
    'Bash broad allow cannot bypass mandatory destructive ask',
    BashTool,
    'git reset --hard HEAD~1',
    'Bash(*)',
  ],
  [
    'PowerShell broad allow cannot bypass mandatory destructive ask',
    PowerShellTool,
    'Clear-Disk -Number 1',
    'PowerShell(*)',
  ],
] as const) {
  const result = await fullDecision(tool, command, {
    allow: [allowRule],
    mode: 'bypassPermissions',
  })
  assertBehavior(result, 'ask', label)
  assertEqual(
    result.decisionReason?.type,
    'destructiveOperation',
    `${label} reason`,
  )
}

assertBehavior(
  await fullDecision(BashTool, 'printf ok', {
    allow: ['Bash(printf ok)'],
    ask: ['Bash(printf ok)'],
  }),
  'ask',
  'Bash explicit ask beats exact allow',
)
assertBehavior(
  await fullDecision(PowerShellTool, 'Get-Process', {
    allow: ['PowerShell(Get-Process)'],
    ask: ['PowerShell(Get-Process)'],
  }),
  'ask',
  'PowerShell explicit ask beats exact allow',
)
assertBehavior(
  await fullDecision(PowerShellTool, 'Get-Process; Get-Service', {
    allow: ['PowerShell(*)'],
    deny: ['PowerShell(Get-Process; Get-Service)'],
  }),
  'deny',
  'PowerShell whole-command exact deny beats read-only and broad allow',
)

for (const [label, command] of [
  ['Bash env wrapper deny', 'FOO=bar timeout 30 rm -rf ./build'],
  ['Bash command wrapper deny', 'command rm -rf ./build'],
] as const) {
  assertBehavior(
    await bashToolHasPermission(
      { command },
      context({ allow: ['Bash(*)'], deny: ['Bash(rm:*)'] }),
    ),
    'deny',
    label,
  )
}

for (const [label, command] of [
  ['PowerShell alias deny', 'rm ./build -Recurse -Force'],
  [
    'PowerShell module-qualified deny',
    'Microsoft.PowerShell.Management\\Remove-Item ./build -Recurse -Force',
  ],
  [
    'PowerShell invocation operator deny',
    "& 'Invoke-Expression' 'Write-Output bad'",
  ],
  [
    'PowerShell nested command deny',
    "if ($true) { Invoke-Expression 'Write-Output bad' }",
  ],
] as const) {
  const denyRule = command.includes('Invoke')
    ? 'PowerShell(Invoke-Expression:*)'
    : 'PowerShell(Remove-Item:*)'
  assertBehavior(
    await powershellToolHasPermission(
      { command },
      context({ allow: ['PowerShell(*)'], deny: [denyRule] }),
    ),
    'deny',
    label,
  )
}

assertBehavior(
  await fullDecision(PowerShellTool, '.\\Remove-Item.ps1 ./build', {
    allow: ['PowerShell(Remove-Item:*)'],
  }),
  'ask',
  'PowerShell path executable cannot masquerade as allowed cmdlet',
)

assertBehavior(
  await powershellToolHasPermission(
    { command: 'if (' },
    context({ allow: ['PowerShell(*)'] }),
  ),
  'ask',
  'PowerShell parse failure cannot be broadly allowed',
)

const bashParseFailure = await bashToolHasPermission(
  { command: 'echo ok' },
  context({ allow: ['Bash(*)'] }),
  undefined,
  async () => PARSE_UNAVAILABLE,
)
assertBehavior(
  bashParseFailure,
  'ask',
  'Bash parse failure cannot be broadly allowed',
)
assert(
  !('pendingClassifierCheck' in bashParseFailure) ||
    bashParseFailure.pendingClassifierCheck === undefined,
  'Bash parse failure scheduled classifier auto-approval',
)

console.log('[shell-permission-precedence] PASS')
