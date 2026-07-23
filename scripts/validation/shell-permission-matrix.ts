#!/usr/bin/env bun

import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { BashTool } from '../../packages/builtin-tools/src/tools/BashTool/BashTool.js'
import { bashToolHasPermission } from '../../packages/builtin-tools/src/tools/BashTool/bashPermissions.js'
import { PowerShellTool } from '../../packages/builtin-tools/src/tools/PowerShellTool/PowerShellTool.js'
import { powershellToolHasPermission } from '../../packages/builtin-tools/src/tools/PowerShellTool/powershellPermissions.js'
import type { Tool, ToolUseContext } from '../../src/Tool.js'
import { getEmptyToolPermissionContext } from '../../src/Tool.js'
import type { PermissionResult } from '../../src/types/permissions.js'
import { PARSE_UNAVAILABLE } from '../../src/utils/bash/parser.js'
import { runWithCwdOverride } from '../../src/utils/cwd.js'
import { hasPermissionsToUseTool } from '../../src/utils/permissions/permissions.js'
import {
  reduceShellDecisions,
  type ShellDecisionCategory,
} from '../../src/utils/permissions/shellDecision.js'
import {
  getCachedPowerShellPath,
  resetPowerShellCache,
} from '../../src/utils/shell/powershellDetection.js'
import { assert, assertEqual } from './assertions.js'

type ExpectedBehavior = 'allow' | 'ask' | 'deny'
type RuleSet = {
  allow?: string[]
  ask?: string[]
  deny?: string[]
  mode?: 'default' | 'acceptEdits' | 'bypassPermissions'
}
type PermissionCase = {
  label: string
  command: string
  expected: ExpectedBehavior
  rules?: RuleSet
  reasonType?: string
}

const projectRoot = resolve(import.meta.dir, '../..')
const fixtureCwd = join(projectRoot, 'scripts', 'validation')
const childMode = process.env.CLAUDE_CODE_PERMISSION_PS_MODE

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

function decisionBehavior(result: PermissionResult): ExpectedBehavior {
  return result.behavior === 'passthrough' ? 'ask' : result.behavior
}

function assertDecision(
  result: PermissionResult,
  test: Pick<PermissionCase, 'label' | 'expected' | 'reasonType'>,
): void {
  assertEqual(decisionBehavior(result), test.expected, test.label)
  if (test.reasonType) {
    assertEqual(
      result.decisionReason?.type,
      test.reasonType,
      `${test.label} reason`,
    )
  }
}

async function fullDecision(
  tool: Tool,
  command: string,
  rules: RuleSet = {},
): Promise<PermissionResult> {
  return hasPermissionsToUseTool(
    tool,
    { command },
    context(rules),
    {} as never,
    `matrix-${tool.name}`,
  )
}

async function runBashMatrix(): Promise<void> {
  const longCompound = Array.from(
    { length: 51 },
    (_, index) => `printf ${index}`,
  ).join(' && ')
  const cases: PermissionCase[] = [
    {
      label: 'wrapper cannot hide deny',
      command: 'FOO=bar timeout 30 command rm -rf ./build',
      expected: 'deny',
      rules: { allow: ['Bash(*)'], deny: ['Bash(rm:*)'] },
    },
    {
      label: 'pipeline later deny wins',
      command: 'printf ok | rm -rf ./build',
      expected: 'deny',
      rules: { ask: ['Bash(printf:*)'], deny: ['Bash(rm:*)'] },
    },
    {
      label: 'control-flow later deny wins',
      command: 'printf ok && rm -rf ./build',
      expected: 'deny',
      rules: { allow: ['Bash(printf:*)'], deny: ['Bash(rm:*)'] },
    },
    {
      label: 'command substitution deny',
      command: 'echo $(rm -rf ./build)',
      expected: 'deny',
      rules: { allow: ['Bash(*)'], deny: ['Bash(rm:*)'] },
    },
    {
      label: 'process substitution is not broadly allowed',
      command: 'cat <(printf secret)',
      expected: 'ask',
      rules: { allow: ['Bash(*)'] },
    },
    {
      label: 'variable command is not broadly allowed',
      command: '$COMMAND ./build',
      expected: 'ask',
      rules: { allow: ['Bash(*)'] },
    },
    {
      label: 'eval is not broadly allowed',
      command: "eval 'printf ok'",
      expected: 'ask',
      rules: { allow: ['Bash(*)'] },
    },
    {
      label: 'source is not broadly allowed',
      command: 'source ./setup.sh',
      expected: 'ask',
      rules: { allow: ['Bash(*)'] },
    },
    {
      label: 'nested shell is not broadly allowed',
      command: "bash -c 'printf ok'",
      expected: 'ask',
      rules: { allow: ['Bash(*)'] },
    },
    {
      label: 'heredoc follows explicit broad allow',
      command: "cat <<'EOF'\nhello\nEOF",
      expected: 'allow',
      rules: { allow: ['Bash(*)'] },
    },
    {
      label: 'redirection requires approval',
      command: 'printf ok > ./permission-matrix.out',
      expected: 'ask',
      rules: { allow: ['Bash(printf:*)'] },
    },
    {
      label: 'control character fails closed',
      command: 'printf ok\u0000rm -rf ./build',
      expected: 'ask',
      rules: { allow: ['Bash(*)'] },
    },
    {
      label: 'Unicode exact rule remains deterministic',
      command: "printf '你好'",
      expected: 'allow',
      rules: { allow: ["Bash(printf '你好')"] },
    },
    {
      label: 'more than 50 subcommands fails closed',
      command: longCompound,
      expected: 'ask',
      rules: { allow: ['Bash(*)'] },
    },
    {
      label: 'cwd change cannot hide deny',
      command: 'cd .. && rm -rf ./build',
      expected: 'deny',
      rules: { allow: ['Bash(*)'], deny: ['Bash(rm:*)'] },
    },
    {
      label: 'symbolic link creation requires approval',
      command: 'ln -s ./target ./link',
      expected: 'ask',
      rules: { allow: ['Bash(*)'] },
    },
  ]

  for (const test of cases) {
    const result = await runWithCwdOverride(fixtureCwd, () =>
      bashToolHasPermission({ command: test.command }, context(test.rules)),
    )
    assertDecision(result, test)
  }

  const unavailable = await bashToolHasPermission(
    { command: 'printf ok' },
    context({ allow: ['Bash(*)'], mode: 'bypassPermissions' }),
    undefined,
    async () => PARSE_UNAVAILABLE,
  )
  assertDecision(unavailable, {
    label: 'Bash parser unavailable fails closed',
    expected: 'ask',
  })
  assert(
    !('pendingClassifierCheck' in unavailable) ||
      unavailable.pendingClassifierCheck === undefined,
    'Bash parser unavailable scheduled classifier auto-approval',
  )
}

async function runPowerShellMatrix(): Promise<void> {
  const cases: PermissionCase[] = [
    {
      label: 'alias deny',
      command: 'rm ./build -Recurse -Force',
      expected: 'deny',
      rules: { allow: ['PowerShell(*)'], deny: ['PowerShell(Remove-Item:*)'] },
    },
    {
      label: 'module-qualified deny',
      command:
        'Microsoft.PowerShell.Management\\Remove-Item ./build -Recurse -Force',
      expected: 'deny',
      rules: { allow: ['PowerShell(*)'], deny: ['PowerShell(Remove-Item:*)'] },
    },
    {
      label: 'dynamic invocation is not broadly allowed',
      command: "$command = 'Get-Process'; & $command",
      expected: 'ask',
      rules: { allow: ['PowerShell(*)'] },
    },
    {
      label: 'EncodedCommand is not broadly allowed',
      command: 'pwsh -EncodedCommand VwByAGkAdABlAC0ATwB1AHQAcAB1AHQAIABvAGsA',
      expected: 'ask',
      rules: { allow: ['PowerShell(*)'] },
    },
    {
      label: 'Invoke-Expression deny',
      command: "Invoke-Expression 'Write-Output bad'",
      expected: 'deny',
      rules: {
        allow: ['PowerShell(*)'],
        deny: ['PowerShell(Invoke-Expression:*)'],
      },
    },
    {
      label: 'Start-Process nested PowerShell is not broadly allowed',
      command: "Start-Process pwsh -ArgumentList '-Command', 'Get-Process'",
      expected: 'ask',
      rules: { allow: ['PowerShell(*)'] },
    },
    {
      label: 'script block is not broadly allowed',
      command: 'Get-ChildItem | Where-Object { $_.Length -gt 0 }',
      expected: 'ask',
      rules: { allow: ['PowerShell(*)'] },
    },
    {
      label: 'splatting is not broadly allowed',
      command: '$params = @{Path = "."}; Get-ChildItem @params',
      expected: 'ask',
      rules: { allow: ['PowerShell(*)'] },
    },
    {
      label: 'provider path is not broadly allowed',
      command: 'Get-ChildItem Env:',
      expected: 'ask',
      rules: { allow: ['PowerShell(*)'] },
    },
    {
      label: 'UNC path is not broadly allowed',
      command: 'Get-ChildItem \\\\server\\share',
      expected: 'ask',
      rules: { allow: ['PowerShell(*)'] },
    },
    {
      label: 'Unicode dash cannot bypass destructive approval',
      command: 'Remove-Item ./build –Recurse –Force',
      expected: 'ask',
      rules: { allow: ['PowerShell(*)'], mode: 'bypassPermissions' },
    },
    {
      label: 'stop parsing token is not broadly allowed',
      command: 'cmd.exe --% /c echo ok & del important.txt',
      expected: 'ask',
      rules: { allow: ['PowerShell(*)'] },
    },
    {
      label: 'variable path is not broadly allowed',
      command: '$path = "."; Get-ChildItem $path',
      expected: 'ask',
      rules: { allow: ['PowerShell(*)'] },
    },
    {
      label: 'cwd change cannot hide deny',
      command: 'Set-Location ..; Remove-Item ./build -Recurse -Force',
      expected: 'deny',
      rules: { allow: ['PowerShell(*)'], deny: ['PowerShell(Remove-Item:*)'] },
    },
    {
      label: 'link creation is not broadly allowed',
      command: 'New-Item -ItemType SymbolicLink -Path ./link -Target ./target',
      expected: 'ask',
      rules: { allow: ['PowerShell(*)'] },
    },
  ]

  for (const test of cases) {
    const result = await runWithCwdOverride(fixtureCwd, () =>
      powershellToolHasPermission(
        { command: test.command },
        context(test.rules),
      ),
    )
    assertDecision(result, test)
  }

  assertDecision(
    await fullDecision(
      PowerShellTool,
      "Get-Process; Invoke-Expression 'Write-Output bad'",
      {
        ask: ['PowerShell'],
        deny: ['PowerShell(Invoke-Expression:*)'],
      },
    ),
    {
      label: 'tool-level ask cannot mask later statement deny',
      expected: 'deny',
    },
  )
}

async function runUnavailablePowerShellChecks(): Promise<void> {
  resetPowerShellCache(null)
  assertEqual(
    await getCachedPowerShellPath(),
    null,
    'isolated PATH unexpectedly found PowerShell',
  )
  for (const rules of [
    { allow: ['PowerShell(*)'] },
    { allow: ['PowerShell(*)'], mode: 'bypassPermissions' as const },
  ]) {
    const result = await powershellToolHasPermission(
      { command: 'Get-Process' },
      context(rules),
    )
    assertDecision(result, {
      label: `PowerShell unavailable fails closed (${rules.mode ?? 'default'})`,
      expected: 'ask',
    })
    assert(
      !result.suggestions || result.suggestions.length === 0,
      'PowerShell unavailable generated a persistent allow suggestion',
    )
  }
}

async function spawnIsolated(mode: string, pathValue: string): Promise<void> {
  const isolatedEnv = { ...process.env }
  for (const key of Object.keys(isolatedEnv)) {
    if (key.toLowerCase() === 'path') {
      delete isolatedEnv[key]
    }
  }
  isolatedEnv.PATH = pathValue
  isolatedEnv.CLAUDE_CODE_PERMISSION_PS_MODE = mode

  const proc = Bun.spawn([process.execPath, import.meta.path], {
    cwd: projectRoot,
    env: isolatedEnv,
    stdin: 'ignore',
    stdout: 'inherit',
    stderr: 'inherit',
  })
  const exitCode = await proc.exited
  assertEqual(exitCode, 0, `PowerShell ${mode} isolated validation`)
}

async function runPowerShellEnvironments(): Promise<void> {
  if (process.platform === 'win32') {
    const windowsDir = process.env.WINDIR ?? 'C:\\Windows'
    const desktop = join(
      windowsDir,
      'System32',
      'WindowsPowerShell',
      'v1.0',
      'powershell.exe',
    )
    const core =
      Bun.which('pwsh') ?? 'C:\\Program Files\\PowerShell\\7\\pwsh.exe'
    for (const [mode, executable] of [
      ['desktop', desktop],
      ['core', core],
    ] as const) {
      if (!existsSync(executable)) {
        if (process.env.CI) {
          throw new Error(
            `Windows CI requires PowerShell ${mode}: ${executable}`,
          )
        }
        console.log(
          `[shell-permission-matrix] SKIP missing ${mode}: ${executable}`,
        )
        continue
      }
      await spawnIsolated(mode, dirname(executable))
    }
    return
  }

  await spawnIsolated('unavailable', '')
}

async function main(): Promise<void> {
  if (childMode === 'unavailable') {
    await runUnavailablePowerShellChecks()
    console.log('[shell-permission-matrix] PASS PowerShell unavailable')
    return
  }
  if (childMode === 'desktop' || childMode === 'core') {
    resetPowerShellCache()
    const executable = await getCachedPowerShellPath()
    assert(executable, `PowerShell ${childMode} was not discovered`)
    assertEqual(
      executable.toLowerCase().includes('pwsh'),
      childMode === 'core',
      `PowerShell ${childMode} executable`,
    )
    await runPowerShellMatrix()
    console.log(`[shell-permission-matrix] PASS PowerShell ${childMode}`)
    return
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
      result: category.endsWith('deny')
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
  assertEqual(selected?.message, 'hard-deny', 'shared decision precedence')

  await runBashMatrix()
  await runPowerShellEnvironments()
  console.log('[shell-permission-matrix] PASS')
}

await main()
