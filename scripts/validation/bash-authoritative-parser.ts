#!/usr/bin/env bun

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import type { ToolUseContext } from '../../src/Tool.js'
import { getEmptyToolPermissionContext } from '../../src/Tool.js'
import {
  checkSemantics,
  parseForSecurity,
  parseForSecurityFromAst,
} from '../../src/utils/bash/ast.js'
import { parseBashForTesting } from '../../src/utils/bash/bashParser.js'
import {
  MAX_BASH_COMMAND_LENGTH,
  PARSE_ABORTED,
  PARSE_UNAVAILABLE,
  type Node,
} from '../../src/utils/bash/parser.js'
import { bashToolHasPermission } from '../../packages/builtin-tools/src/tools/BashTool/bashPermissions.js'
import { assert, assertDeepEqual, assertEqual } from './assertions.js'
import {
  findGitBashPathOrNull,
  findGitBashPathOrNullWithDeps,
  type GitBashDiscoveryDeps,
} from '../../src/utils/windowsPaths.js'

function discoveryDeps({
  existing,
  whereBash = '',
  whereGit = '',
  usable,
  override = '',
  probeCalls,
}: {
  existing: string[]
  whereBash?: string
  whereGit?: string
  usable: string[]
  override?: string
  probeCalls?: string[]
}): GitBashDiscoveryDeps {
  const existingSet = new Set(existing.map(path => path.toLowerCase()))
  const usableSet = new Set(usable.map(path => path.toLowerCase()))
  return {
    checkExists: path => existingSet.has(path.toLowerCase()),
    execCommand: command => {
      if (command === 'where.exe bash') return whereBash
      if (command === 'where.exe git') return whereGit
      throw new Error(`Unexpected discovery command: ${command}`)
    },
    probeShell: path => {
      probeCalls?.push(path)
      return usableSet.has(path.toLowerCase())
    },
    cwdFn: () => 'D:\\work',
    userProfile: 'C:\\Users\\test',
    envOverride: override,
  }
}

const systemBash = 'C:\\Windows\\System32\\bash.exe'
const pathBash = 'D:\\Tools\\Git\\bin\\bash.exe'
const probeCalls: string[] = []
assertEqual(
  findGitBashPathOrNullWithDeps(
    discoveryDeps({
      existing: [systemBash, pathBash],
      whereBash: `${systemBash}\n${pathBash}`,
      usable: [pathBash],
      probeCalls,
    }),
  ),
  pathBash,
  'Bash discovery skips an unusable higher-priority PATH candidate',
)
assertDeepEqual(
  probeCalls,
  [systemBash, pathBash],
  'Bash discovery preserves PATH candidate probe order',
)

const gitExe = 'D:\\PortableGit\\cmd\\git.exe'
const gitDerivedBash = 'D:\\PortableGit\\bin\\bash.exe'
assertEqual(
  findGitBashPathOrNullWithDeps(
    discoveryDeps({
      existing: [systemBash, gitExe, gitDerivedBash],
      whereBash: systemBash,
      whereGit: gitExe,
      usable: [gitDerivedBash],
    }),
  ),
  gitDerivedBash,
  'Bash discovery falls through from PATH to a usable git-derived candidate',
)

assertEqual(
  findGitBashPathOrNullWithDeps(
    discoveryDeps({
      existing: ['D:\\invalid\\bash.exe', pathBash],
      whereBash: pathBash,
      usable: [pathBash],
      override: 'D:\\invalid\\bash.exe',
    }),
  ),
  pathBash,
  'Bash discovery falls through from an unusable explicit override',
)

assertEqual(
  findGitBashPathOrNullWithDeps(
    discoveryDeps({
      existing: [systemBash],
      whereBash: systemBash,
      usable: [],
    }),
  ),
  null,
  'Bash discovery returns null when every candidate is unusable',
)

function findBash(): string {
  if (process.platform === 'win32') {
    const productionBash = findGitBashPathOrNull()
    if (productionBash) return productionBash
    throw new Error('A usable Windows Bash executable is required')
  }

  const configured = process.env.CLAUDE_CODE_VERIFY_BASH
  const candidates = configured
    ? [configured]
    : ['/bin/bash', '/usr/bin/bash', 'bash']
  for (const candidate of candidates) {
    if (
      (candidate.includes('\\') || candidate.includes('/')) &&
      !existsSync(candidate)
    ) {
      continue
    }
    const result = spawnSync(
      candidate,
      ['--noprofile', '--norc', '-c', 'printf BASH_PROBE_OK'],
      { encoding: 'utf8' },
    )
    if (result.status === 0 && result.stdout === 'BASH_PROBE_OK') return candidate
  }
  throw new Error('A real Bash or Git Bash executable is required')
}

const bash = findBash()
const root = resolve(import.meta.dir, '../..')

for (const [path, forbidden] of [
  [
    'packages/builtin-tools/src/tools/BashTool/bashPermissions.ts',
    [
      'TREE_SITTER_BASH_SHADOW',
      'tengu_birch_trellis',
      'CLAUDE_CODE_DISABLE_COMMAND_INJECTION_CHECK',
      'tengu_tree_sitter_shadow',
    ],
  ],
  [
    'scripts/feature-policy.ts',
    ['TREE_SITTER_BASH', 'TREE_SITTER_BASH_SHADOW', 'tengu_birch_trellis'],
  ],
] as const) {
  const source = readFileSync(resolve(root, path), 'utf8')
  for (const marker of forbidden) {
    assert(!source.includes(marker), `${path} restored ${marker}`)
  }
}

for (const [path, forbidden] of [
  [
    'packages/builtin-tools/src/tools/BashTool/bashPermissions.ts',
    ['bashCommandIsSafeAsync_DEPRECATED', 'RegexParsedCommand_DEPRECATED'],
  ],
  [
    'packages/builtin-tools/src/tools/BashTool/bashCommandHelpers.ts',
    ['bashCommandIsSafeAsync_DEPRECATED', 'RegexParsedCommand_DEPRECATED'],
  ],
  [
    'packages/builtin-tools/src/tools/BashTool/readOnlyValidation.ts',
    [
      "from 'src/utils/bash/shellQuote.js'",
      "from 'src/utils/bash/commands.js'",
    ],
  ],
  [
    'packages/builtin-tools/src/tools/BashTool/modeValidation.ts',
    ["from 'src/utils/bash/commands.js'"],
  ],
  [
    'packages/builtin-tools/src/tools/BashTool/shouldUseSandbox.ts',
    ["from 'src/utils/bash/commands.js'"],
  ],
  ['src/utils/bash/ParsedCommand.ts', ['RegexParsedCommand_DEPRECATED']],
] as const) {
  const source = readFileSync(resolve(root, path), 'utf8')
  for (const marker of forbidden) {
    assert(
      !source.includes(marker),
      `${path} restored legacy authority ${marker}`,
    )
  }
}

for (const [path, required] of [
  [
    'packages/builtin-tools/src/tools/BashTool/bashPermissions.ts',
    [
      'shouldUseSandbox(input, astCommands)',
      'astCommand ? [astCommand] : undefined',
    ],
  ],
  [
    'packages/builtin-tools/src/tools/BashTool/sedValidation.ts',
    ['command.argv', 'authoritativeArgv'],
  ],
  [
    'packages/builtin-tools/src/tools/BashTool/pathValidation.ts',
    ['validateSinglePathCommandArgv', 'astRedirectsToOutputRedirections'],
  ],
] as const) {
  const source = readFileSync(resolve(root, path), 'utf8')
  for (const marker of required) {
    assert(
      source.includes(marker),
      `${path} lost authoritative boundary ${marker}`,
    )
  }
}

function assertRealBashSyntax(command: string, valid: boolean): void {
  const result = spawnSync(
    bash,
    ['--noprofile', '--norc', '-n', '-c', command],
    { stdio: 'ignore' },
  )
  assertEqual(result.status === 0, valid, `real Bash syntax: ${command}`)
}

for (const command of [
  'printf "%s\\n" "a|b"',
  'cat input | grep needle && echo ok',
  "cat <<'EOF'\nhello\nEOF",
  'for value in one two; do printf "%s\\n" "$value"; done',
]) {
  assertRealBashSyntax(command, true)
}
for (const command of ['echo "unterminated', 'if true; then echo x']) {
  assertRealBashSyntax(command, false)
}

async function assertArgv(command: string, expected: string[]): Promise<void> {
  const result = await parseForSecurity(command)
  assertEqual(result.kind, 'simple', `authoritative parse: ${command}`)
  if (result.kind !== 'simple') return
  assertEqual(result.commands.length, 1, `simple command count: ${command}`)
  assertDeepEqual(
    result.commands[0]?.argv.slice(1),
    expected,
    `AST argv: ${command}`,
  )

  const probe = `probe(){ printf '%s\\0' "$@"; }; ${command}`
  const actual = spawnSync(bash, ['--noprofile', '--norc', '-c', probe], {
    encoding: 'buffer',
  })
  assertEqual(actual.status, 0, `real Bash argv probe: ${command}`)
  const argv = actual.stdout.toString('utf8').split('\0').slice(0, -1)
  assertDeepEqual(argv, expected, `real Bash argv: ${command}`)
}

await assertArgv(`probe alpha "two words" 'three words'`, [
  'alpha',
  'two words',
  'three words',
])
await assertArgv(`probe 'a|b' "semi;colon" plain`, [
  'a|b',
  'semi;colon',
  'plain',
])
await assertArgv(`probe --path=/tmp/x 'C:\\work\\file' /c/work`, [
  '--path=/tmp/x',
  'C:\\work\\file',
  '/c/work',
])
await assertArgv(`probe "" "日本語"`, ['', '日本語'])

const unavailable = parseForSecurityFromAst('echo ok', PARSE_UNAVAILABLE)
assertEqual(
  unavailable.kind,
  'too-complex',
  'parser unavailable must fail closed',
)

const overlong = await parseForSecurity(
  `echo ${'x'.repeat(MAX_BASH_COMMAND_LENGTH)}`,
)
assertEqual(overlong.kind, 'too-complex', 'overlong command must fail closed')

assertEqual(
  parseBashForTesting('echo one two three', { maxNodes: 1 }),
  null,
  'node budget must abort parsing',
)
assertEqual(
  parseBashForTesting(
    `echo ${Array.from({ length: 400 }, (_, i) => `word${i}`).join(' ')}`,
    { timeoutMs: -1 },
  ),
  null,
  'parser timeout must abort parsing',
)
assertEqual(
  parseForSecurityFromAst('echo ok', PARSE_ABORTED).kind,
  'too-complex',
  'parser abort must fail closed',
)

const unknownRoot: Node = {
  type: 'future_unknown_node',
  text: 'echo ok',
  startIndex: 0,
  endIndex: 7,
  children: [],
}
assertEqual(
  parseForSecurityFromAst('echo ok', unknownRoot).kind,
  'too-complex',
  'unknown AST node must fail closed',
)

const semantic = await parseForSecurity('eval "echo ok"')
assertEqual(semantic.kind, 'simple', 'semantic rejection fixture must parse')
if (semantic.kind === 'simple') {
  assert(
    !checkSemantics(semantic.commands).ok,
    'eval must fail semantic checks',
  )
}

function permissionContext(
  rules: { allow?: string[]; deny?: string[]; ask?: string[] } = {},
): ToolUseContext {
  const toolPermissionContext = {
    ...getEmptyToolPermissionContext(),
    alwaysAllowRules: { cliArg: rules.allow ?? [] },
    alwaysDenyRules: { cliArg: rules.deny ?? [] },
    alwaysAskRules: { cliArg: rules.ask ?? [] },
  }
  return {
    abortController: new AbortController(),
    options: { isNonInteractiveSession: true },
    getAppState: () => ({ toolPermissionContext }),
  } as unknown as ToolUseContext
}

async function assertPermissionAsk(
  label: string,
  command: string,
  parser?: Parameters<typeof bashToolHasPermission>[3],
): Promise<void> {
  const result = await bashToolHasPermission(
    { command },
    permissionContext({ allow: [`Bash(${command})`] }),
    undefined,
    parser,
  )
  assertEqual(result.behavior, 'ask', label)
  assert(
    !('pendingClassifierCheck' in result) ||
      result.pendingClassifierCheck === undefined,
    `${label} must not schedule classifier auto-approval`,
  )
  assert(
    !('suggestions' in result) || result.suggestions?.length === 0,
    `${label} must not suggest a persistent allow rule`,
  )
}

await assertPermissionAsk(
  'permission parser unavailable',
  'echo ok',
  async () => PARSE_UNAVAILABLE,
)
await assertPermissionAsk(
  'permission parser timeout',
  'echo ok',
  async () => PARSE_ABORTED,
)
await assertPermissionAsk(
  'permission parser node budget',
  'echo ok',
  async () => PARSE_ABORTED,
)
await assertPermissionAsk(
  'permission unknown AST node',
  'echo ok',
  async () => unknownRoot,
)
await assertPermissionAsk(
  'permission overlong input',
  `echo ${'x'.repeat(MAX_BASH_COMMAND_LENGTH)}`,
)
await assertPermissionAsk('permission semantic rejection', 'eval "echo ok"')

const denied = await bashToolHasPermission(
  { command: 'echo ok' },
  permissionContext({ deny: ['Bash(echo ok)'] }),
  undefined,
  async () => PARSE_UNAVAILABLE,
)
assertEqual(denied.behavior, 'deny', 'explicit deny must beat parser failure')

console.log(`[bash-authoritative-parser] PASS (${bash})`)
