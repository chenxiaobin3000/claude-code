#!/usr/bin/env bun

import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { bashToolHasPermission } from '../../packages/builtin-tools/src/tools/BashTool/bashPermissions.js'
import { FileWriteTool } from '../../packages/builtin-tools/src/tools/FileWriteTool/FileWriteTool.js'
import { powershellToolHasPermission } from '../../packages/builtin-tools/src/tools/PowerShellTool/powershellPermissions.js'
import {
  getEmptyToolPermissionContext,
  type ToolPermissionContext,
  type ToolUseContext,
} from '../../src/Tool.js'
import { getCwd, runWithCwdOverride } from '../../src/utils/cwd.js'
import {
  execFileNoThrow,
  execFileNoThrowWithCwd,
} from '../../src/utils/execFileNoThrow.js'
import {
  allWorkingDirectories,
  checkWritePermissionForTool,
} from '../../src/utils/permissions/filesystem.js'
import { hasPermissionsToUseTool } from '../../src/utils/permissions/permissions.js'
import {
  classifyWorktreeGitEscape,
  classifyWorktreeShellEscape,
} from '../../src/utils/permissions/worktreeIsolation.js'
import { getCachedPowerShellPath } from '../../src/utils/shell/powershellDetection.js'
import { assert, assertEqual } from './assertions.js'

(globalThis as typeof globalThis & { MACRO: { VERSION: string } }).MACRO = {
  VERSION: 'worktree-isolation-validation',
}

const projectRoot = resolve(import.meta.dir, '../..')
const agentToolSource = await Bun.file(
  join(projectRoot, 'packages/builtin-tools/src/tools/AgentTool/AgentTool.tsx'),
).text()
const runAgentSource = await Bun.file(
  join(projectRoot, 'packages/builtin-tools/src/tools/AgentTool/runAgent.ts'),
).text()
const resumeAgentSource = await Bun.file(
  join(
    projectRoot,
    'packages/builtin-tools/src/tools/AgentTool/resumeAgent.ts',
  ),
).text()
const bashPermissionSource = await Bun.file(
  join(
    projectRoot,
    'packages/builtin-tools/src/tools/BashTool/bashPermissions.ts',
  ),
).text()
const powershellPermissionSource = await Bun.file(
  join(
    projectRoot,
    'packages/builtin-tools/src/tools/PowerShellTool/powershellPermissions.ts',
  ),
).text()
const bashToolSource = await Bun.file(
  join(projectRoot, 'packages/builtin-tools/src/tools/BashTool/BashTool.tsx'),
).text()
const powershellToolSource = await Bun.file(
  join(
    projectRoot,
    'packages/builtin-tools/src/tools/PowerShellTool/PowerShellTool.tsx',
  ),
).text()

for (const [label, source, required] of [
  [
    'Agent worktree cwd selection',
    agentToolSource,
    'const cwdOverridePath = cwd ?? worktreeInfo?.worktreePath',
  ],
  ['async Agent worktree wrapper', agentToolSource, 'wrapWithCwd(() =>'],
  ['sync Agent worktree wrapper', agentToolSource, 'wrapWithCwd(async () =>'],
  [
    'resumed Agent worktree wrapper',
    resumeAgentSource,
    'runWithCwdOverride(resumedWorktreePath, fn)',
  ],
  [
    'Agent hard write boundary propagation',
    runAgentSource,
    'writeIsolationRoot: worktreePath',
  ],
  [
    'Bash Git worktree escape guard',
    bashPermissionSource,
    'classifyWorktreeGitEscape(',
  ],
  [
    'Bash shell worktree escape guard',
    bashPermissionSource,
    'classifyWorktreeShellEscape(',
  ],
  [
    'PowerShell Git worktree escape guard',
    powershellPermissionSource,
    'classifyWorktreeGitEscape(',
  ],
  [
    'PowerShell shell worktree escape guard',
    powershellPermissionSource,
    'classifyWorktreeShellEscape(',
  ],
  [
    'Bash worktree background lifecycle guard',
    bashToolSource,
    'const preventBackgrounding = Boolean(',
  ],
  [
    'PowerShell worktree background lifecycle guard',
    powershellToolSource,
    'const preventBackgrounding = Boolean(',
  ],
] as const) {
  assert(source.includes(required), `${label} was removed`)
}

async function git(cwd: string, args: string[]): Promise<string> {
  const result = await execFileNoThrowWithCwd('git', args, {
    cwd,
    timeout: 30_000,
    preserveOutputOnError: true,
  })
  assertEqual(
    result.code,
    0,
    `git ${args.join(' ')} in ${cwd}: ${result.stderr || result.error || ''}`,
  )
  return result.stdout.trim()
}

function permissionContext(
  worktreePath: string,
  mainPath: string,
  mode: ToolPermissionContext['mode'] = 'acceptEdits',
): ToolPermissionContext {
  return {
    ...getEmptyToolPermissionContext(),
    mode,
    writeIsolationRoot: worktreePath,
    additionalWorkingDirectories: new Map([
      [mainPath, { path: mainPath, source: 'session' }],
    ]),
    alwaysAllowRules: {
      cliArg: ['Edit', 'Write', 'Bash(*)', 'PowerShell(*)'],
    },
  } as unknown as ToolPermissionContext
}

function toolUseContext(permissions: ToolPermissionContext): ToolUseContext {
  return {
    abortController: new AbortController(),
    options: {
      isNonInteractiveSession: true,
      tools: [FileWriteTool],
    },
    getAppState: () => ({ toolPermissionContext: permissions }),
    setAppState: () => {},
  } as unknown as ToolUseContext
}

const parentCwd = getCwd()
const tempRoot = await mkdtemp(join(tmpdir(), 'claude-worktree-isolation-'))
const mainPath = join(tempRoot, 'main')
const worktreePath = join(tempRoot, 'agent-worktree')
const siblingA = join(tempRoot, 'agent-a')
const siblingB = join(tempRoot, 'agent-b')
const branchName = 'validation-agent-isolation'

try {
  await mkdir(mainPath, { recursive: true })
  await git(mainPath, ['init'])
  await git(mainPath, ['config', 'user.email', 'validation@example.invalid'])
  await git(mainPath, ['config', 'user.name', 'Worktree Validation'])
  await writeFile(join(mainPath, 'tracked.txt'), 'main checkout\n')
  await mkdir(join(mainPath, 'protected'), { recursive: true })
  await writeFile(join(mainPath, 'protected', 'main-only.txt'), 'protected\n')
  await git(mainPath, ['add', '.'])
  await git(mainPath, ['commit', '-m', 'initial'])

  const mainHeadBefore = await git(mainPath, ['rev-parse', 'HEAD'])
  const mainStatusBefore = await git(mainPath, [
    'status',
    '--porcelain',
    '--untracked-files=all',
  ])
  assertEqual(mainStatusBefore, '', 'main checkout did not start clean')

  await git(mainPath, [
    'worktree',
    'add',
    '-b',
    branchName,
    worktreePath,
    'HEAD',
  ])

  const permissions = permissionContext(worktreePath, mainPath)
  assertEqual(
    [...allWorkingDirectories(permissions)].join('|'),
    worktreePath,
    'worktree permissions retained the parent checkout as a working directory',
  )

  for (const argv of [
    ['git', '-C', mainPath, 'status'],
    ['git', `--work-tree=${mainPath}`, 'status'],
    ['git', '--git-dir', join(mainPath, '.git'), 'status'],
    ['git', 'worktree', 'remove', mainPath],
  ]) {
    assert(
      classifyWorktreeGitEscape(argv, worktreePath) !== null,
      `Git worktree escape was not classified: ${argv.join(' ')}`,
    )
  }
  for (const argv of [
    ['git', 'status'],
    ['git', 'add', '.'],
    ['git', 'commit', '-m', 'local'],
    ['git', '-C', '.', 'status'],
  ]) {
    assertEqual(
      classifyWorktreeGitEscape(argv, worktreePath),
      null,
      `worktree-local Git command was rejected: ${argv.join(' ')}`,
    )
  }

  const insideDecision = checkWritePermissionForTool(
    FileWriteTool,
    {
      file_path: join(worktreePath, 'inside.txt'),
      content: 'inside\n',
    },
    permissions,
  )
  assertEqual(
    insideDecision.behavior,
    'allow',
    'worktree-local file write was not allowed',
  )

  const outsidePermissions = permissionContext(
    worktreePath,
    mainPath,
    'bypassPermissions',
  )
  const outsideInput = {
    file_path: join(mainPath, 'must-not-change.txt'),
    content: 'escape\n',
  }
  const outsideDecision = await hasPermissionsToUseTool(
    FileWriteTool,
    outsideInput,
    toolUseContext(outsidePermissions),
  )
  assertEqual(
    outsideDecision.behavior,
    'deny',
    'bypass or inherited broad allow escaped the worktree write boundary',
  )

  const bashEscape = await bashToolHasPermission(
    {
      command: `git -C '${mainPath.replaceAll("'", "'\\''")}' status`,
    },
    toolUseContext(outsidePermissions),
  )
  assertEqual(
    bashEscape.behavior,
    'deny',
    'Bash(*) allowed Git to retarget the main checkout',
  )
  assertEqual(
    bashEscape.decisionReason?.type,
    'destructiveOperation',
    'Bash Git escape was not a bypass-immune hard deny',
  )

  if (await getCachedPowerShellPath()) {
    const powershellEscape = await powershellToolHasPermission(
      {
        command: `git -C '${mainPath.replaceAll("'", "''")}' status`,
      },
      toolUseContext(outsidePermissions),
    )
    assertEqual(
      powershellEscape.behavior,
      'deny',
      'PowerShell(*) allowed Git to retarget the main checkout',
    )
    assertEqual(
      powershellEscape.decisionReason?.type,
      'destructiveOperation',
      'PowerShell Git escape was not a bypass-immune hard deny',
    )
  }

  const linkPath = join(worktreePath, 'main-link')
  await symlink(
    join(mainPath, 'protected'),
    linkPath,
    process.platform === 'win32' ? 'junction' : 'dir',
  )
  const symlinkDecision = checkWritePermissionForTool(
    FileWriteTool,
    {
      file_path: join(linkPath, 'escaped.txt'),
      content: 'escape\n',
    },
    permissions,
  )
  assertEqual(
    symlinkDecision.behavior,
    'deny',
    'symlink escaped the worktree write boundary',
  )

  assertEqual(
    classifyWorktreeShellEscape(
      [
        { argv: ['cd', 'protected-local'] },
        {
          argv: ['touch', 'inside.txt'],
          writeTargets: ['inside.txt'],
        },
      ],
      worktreePath,
      worktreePath,
    ),
    null,
    'worktree-local directory change and write were rejected',
  )
  assert(
    classifyWorktreeShellEscape(
      [
        { argv: ['cd', mainPath] },
        {
          argv: ['touch', 'escaped.txt'],
          writeTargets: ['escaped.txt'],
        },
      ],
      worktreePath,
      worktreePath,
    ) !== null,
    'directory change escaped the worktree classifier',
  )
  assert(
    classifyWorktreeShellEscape(
      [
        {
          argv: ['touch', join(linkPath, 'classifier-escaped.txt')],
          writeTargets: [join(linkPath, 'classifier-escaped.txt')],
        },
      ],
      worktreePath,
      worktreePath,
    ) !== null,
    'symlink write escaped the worktree classifier',
  )
  assert(
    classifyWorktreeShellEscape(
      [{ argv: ['printf', 'local'] }],
      worktreePath,
      worktreePath,
      { runInBackground: true },
    ) !== null,
    'background option escaped the worktree classifier',
  )

  const bashMain = mainPath.replaceAll('\\', '/').replaceAll("'", "'\\''")
  const bashLink = linkPath.replaceAll('\\', '/').replaceAll("'", "'\\''")
  const bashEscapeCases: Array<{
    label: string
    input: Parameters<typeof bashToolHasPermission>[0]
  }> = [
    {
      label: 'directory change',
      input: {
        command: `cd '${bashMain}' && printf escape > cwd-escaped.txt`,
      },
    },
    {
      label: 'absolute redirection',
      input: {
        command: `printf escape > '${bashMain}/redirect-escaped.txt'`,
      },
    },
    {
      label: 'symlink redirection',
      input: {
        command: `printf escape > '${bashLink}/symlink-escaped.txt'`,
      },
    },
    {
      label: 'direct symlink write',
      input: {
        command: `touch '${bashLink}/touch-escaped.txt'`,
      },
    },
    {
      label: 'shell background operator',
      input: {
        command: `touch '${bashMain}/background-escaped.txt' &`,
      },
    },
    {
      label: 'nested shell',
      input: {
        command: `bash -c 'touch "${bashMain}/nested-escaped.txt"'`,
      },
    },
    {
      label: 'tool background option',
      input: {
        command: 'printf local',
        run_in_background: true,
      } as unknown as Parameters<typeof bashToolHasPermission>[0],
    },
  ]

  await runWithCwdOverride(worktreePath, async () => {
    for (const testCase of bashEscapeCases) {
      const decision = await bashToolHasPermission(
        testCase.input,
        toolUseContext(outsidePermissions),
      )
      assertEqual(
        decision.behavior,
        'deny',
        `Bash ${testCase.label} was not hard-denied`,
      )
      assertEqual(
        decision.decisionReason?.type,
        'destructiveOperation',
        `Bash ${testCase.label} was not bypass-immune`,
      )
    }
  })

  if (await getCachedPowerShellPath()) {
    const quotePS = (value: string) => value.replaceAll("'", "''")
    const powershellEscapeCases: Array<{
      label: string
      input: Parameters<typeof powershellToolHasPermission>[0]
    }> = [
      {
        label: 'directory change',
        input: {
          command: `Set-Location '${quotePS(mainPath)}'; Set-Content -Path cwd-escaped-ps.txt -Value escape`,
        },
      },
      {
        label: 'absolute redirection',
        input: {
          command: `'escape' > '${quotePS(join(mainPath, 'redirect-escaped-ps.txt'))}'`,
        },
      },
      {
        label: 'symlink write',
        input: {
          command: `Set-Content -Path '${quotePS(join(linkPath, 'symlink-escaped-ps.txt'))}' -Value escape`,
        },
      },
      {
        label: 'background job',
        input: {
          command: `Start-Job -ScriptBlock { Set-Content '${quotePS(join(mainPath, 'job-escaped.txt'))}' escape }`,
        },
      },
      {
        label: 'detached process',
        input: {
          command: `Start-Process pwsh -ArgumentList '-Command','Set-Content escaped.txt escape'`,
        },
      },
      {
        label: 'nested shell',
        input: {
          command: `pwsh -Command "Set-Content '${quotePS(join(mainPath, 'nested-escaped-ps.txt'))}' escape"`,
        },
      },
      {
        label: 'tool background option',
        input: {
          command: "Write-Output 'local'",
          run_in_background: true,
        } as unknown as Parameters<typeof powershellToolHasPermission>[0],
      },
    ]

    await runWithCwdOverride(worktreePath, async () => {
      for (const testCase of powershellEscapeCases) {
        const decision = await powershellToolHasPermission(
          testCase.input,
          toolUseContext(outsidePermissions),
        )
        assertEqual(
          decision.behavior,
          'deny',
          `PowerShell ${testCase.label} was not hard-denied`,
        )
        assertEqual(
          decision.decisionReason?.type,
          'destructiveOperation',
          `PowerShell ${testCase.label} was not bypass-immune`,
        )
      }
    })
  }

  for (const escapedPath of [
    'cwd-escaped.txt',
    'redirect-escaped.txt',
    'background-escaped.txt',
    'nested-escaped.txt',
    'cwd-escaped-ps.txt',
    'redirect-escaped-ps.txt',
    'job-escaped.txt',
    'nested-escaped-ps.txt',
  ]) {
    assert(
      !(await Bun.file(join(mainPath, escapedPath)).exists()),
      `permission validation executed an escaped write: ${escapedPath}`,
    )
  }
  for (const escapedPath of [
    'symlink-escaped.txt',
    'touch-escaped.txt',
    'symlink-escaped-ps.txt',
  ]) {
    assert(
      !(await Bun.file(join(mainPath, 'protected', escapedPath)).exists()),
      `symlink validation executed an escaped write: ${escapedPath}`,
    )
  }

  await runWithCwdOverride(worktreePath, async () => {
    assertEqual(getCwd(), worktreePath, 'Agent cwd override')
    await writeFile(join(getCwd(), 'tracked.txt'), 'agent checkout\n')
    await writeFile(join(getCwd(), 'agent-only.txt'), 'agent branch\n')

    const addResult = await execFileNoThrow('git', ['add', '.'])
    assertEqual(addResult.code, 0, 'Agent git add did not use worktree cwd')
    const commitResult = await execFileNoThrow('git', [
      'commit',
      '-m',
      'agent change',
    ])
    assertEqual(
      commitResult.code,
      0,
      `Agent git commit did not use worktree cwd: ${commitResult.stderr}`,
    )
  })

  assertEqual(getCwd(), parentCwd, 'Agent cwd override leaked to parent')
  assertEqual(
    await readFile(join(mainPath, 'tracked.txt'), 'utf8'),
    'main checkout\n',
    'Agent changed a tracked file in the main checkout',
  )
  assertEqual(
    await git(mainPath, ['rev-parse', 'HEAD']),
    mainHeadBefore,
    'Agent moved the main checkout HEAD',
  )
  assertEqual(
    await git(mainPath, ['status', '--porcelain', '--untracked-files=all']),
    mainStatusBefore,
    'Agent dirtied the main checkout',
  )
  assertEqual(
    await readFile(join(worktreePath, 'tracked.txt'), 'utf8'),
    'agent checkout\n',
    'Agent change did not stay in its worktree',
  )
  assert(
    (await git(worktreePath, ['rev-parse', 'HEAD'])) !== mainHeadBefore,
    'Agent commit did not stay on its isolated branch',
  )

  await Promise.all([mkdir(siblingA), mkdir(siblingB)])
  await Promise.all([
    runWithCwdOverride(siblingA, async () => {
      await Promise.resolve()
      assertEqual(getCwd(), siblingA, 'concurrent Agent A cwd')
      await writeFile(join(getCwd(), 'owner.txt'), 'A')
    }),
    runWithCwdOverride(siblingB, async () => {
      await Promise.resolve()
      assertEqual(getCwd(), siblingB, 'concurrent Agent B cwd')
      await writeFile(join(getCwd(), 'owner.txt'), 'B')
    }),
  ])
  assertEqual(
    await readFile(join(siblingA, 'owner.txt'), 'utf8'),
    'A',
    'concurrent Agent B wrote into Agent A directory',
  )
  assertEqual(
    await readFile(join(siblingB, 'owner.txt'), 'utf8'),
    'B',
    'concurrent Agent A wrote into Agent B directory',
  )
  assertEqual(getCwd(), parentCwd, 'concurrent Agent cwd leaked to parent')

  console.log('[worktree-agent-isolation] PASS')
} finally {
  if (await Bun.file(join(worktreePath, '.git')).exists()) {
    await git(mainPath, ['worktree', 'remove', '--force', worktreePath])
  }
  await execFileNoThrowWithCwd('git', ['branch', '-D', branchName], {
    cwd: mainPath,
    timeout: 30_000,
    preserveOutputOnError: false,
  })
  await rm(tempRoot, { recursive: true, force: true })
}
