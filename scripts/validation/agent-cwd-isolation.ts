#!/usr/bin/env bun

import {
  access,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { getOriginalCwd } from '../../src/bootstrap/state.js'
import type { ToolPermissionContext } from '../../src/Tool.js'
import {
  getCwd,
  runWithCwdOverride,
} from '../../src/utils/cwd.js'
import { pathInAllowedWorkingPath } from '../../src/utils/permissions/filesystem.js'
import { getPlatform } from '../../src/utils/platform.js'
import { exec, setCwd } from '../../src/utils/Shell.js'
import {
  createShellCwdPolicy,
  formatShellCwdResetMessage,
} from '../../packages/builtin-tools/src/tools/BashTool/utils.js'
import { assert, assertEqual } from './assertions.js'

const startupCwd = getCwd()
const projectRoot = await realpath(getOriginalCwd())
const projectFixture = await mkdtemp(join(projectRoot, '.cwd-validation-'))
const projectChild = join(projectFixture, 'project-child')
const externalRoot = await mkdtemp(join(tmpdir(), 'claude-cwd-external-'))
const externalAllowed = join(externalRoot, 'allowed')
const externalDenied = join(externalRoot, 'denied')
const linkToDenied = join(projectFixture, 'link-to-denied')
const vanishingCwd = join(projectFixture, 'vanishing')

await mkdir(projectChild, { recursive: true })
await mkdir(vanishingCwd, { recursive: true })
await mkdir(externalAllowed, { recursive: true })
await mkdir(externalDenied, { recursive: true })

const permissionContext: ToolPermissionContext = {
  mode: 'default',
  additionalWorkingDirectories: new Map([
    [
      externalAllowed,
      {
        path: externalAllowed,
        source: 'cliArg',
      },
    ],
  ]),
  alwaysAllowRules: {},
  alwaysDenyRules: {},
  alwaysAskRules: {},
  isBypassPermissionsModeAvailable: true,
}
const cwdPolicy = createShellCwdPolicy(permissionContext)

async function configureRunnableWindowsBash(): Promise<void> {
  if (getPlatform() !== 'windows' || process.env.CLAUDE_CODE_SHELL) return
  const gitPath = Bun.which('git')
  const candidates = [
    gitPath
      ? join(dirname(dirname(gitPath)), 'bin', 'bash.exe')
      : undefined,
    process.env.ProgramFiles
      ? join(process.env.ProgramFiles, 'Git', 'bin', 'bash.exe')
      : undefined,
    'D:\\AI\\Git\\bin\\bash.exe',
  ].filter((path): path is string => path !== undefined)
  for (const candidate of candidates) {
    try {
      await access(candidate)
      process.env.CLAUDE_CODE_SHELL = candidate
      return
    } catch {
      // Probe the next candidate.
    }
  }
}

await configureRunnableWindowsBash()

function bashQuote(path: string): string {
  return `'${path.replaceAll('\\', '/').replaceAll("'", "'\\''")}'`
}

function powershellQuote(path: string): string {
  return `'${path.replaceAll("'", "''")}'`
}

async function executeAndWait(
  command: string,
  shell: 'bash' | 'powershell',
  options: Parameters<typeof exec>[3],
) {
  const controller = new AbortController()
  const shellCommand = await exec(command, controller.signal, shell, options)
  const result = await shellCommand.result
  shellCommand.cleanup()
  return result
}

try {
  assert(
    pathInAllowedWorkingPath(projectChild, permissionContext),
    'project descendants are authorized cwd targets',
  )
  assert(
    pathInAllowedWorkingPath(externalAllowed, permissionContext),
    'additionalDirectories entries are authorized cwd targets',
  )
  assert(
    !pathInAllowedWorkingPath(externalDenied, permissionContext),
    'unlisted external directories are rejected',
  )

  if (getPlatform() === 'windows') {
    assert(
      pathInAllowedWorkingPath(
        projectChild.replace(/^([a-z]):/i, (_, drive: string) =>
          `${drive.toLowerCase()}:`,
        ),
        permissionContext,
      ),
      'Windows drive-letter case does not change cwd authorization',
    )
    assert(
      !pathInAllowedWorkingPath(
        '\\\\cwd-validation-invalid\\share\\directory',
        permissionContext,
      ),
      'unlisted UNC paths are rejected',
    )
  }

  try {
    await symlink(
      externalDenied,
      linkToDenied,
      getPlatform() === 'windows' ? 'junction' : 'dir',
    )
    assert(
      !cwdPolicy.isAllowed(await realpath(linkToDenied)),
      'symlink or junction targets cannot escape authorized cwd roots',
    )
  } catch (error) {
    if (getPlatform() !== 'windows') throw error
    // Some managed Windows environments disable junction creation. The
    // canonical target assertion above remains covered wherever creation is
    // available; Windows CI still exercises drive and UNC handling.
  }

  setCwd(projectRoot)
  const bashAllowed = await executeAndWait(
    `cd ${bashQuote(externalAllowed)}`,
    'bash',
    { cwdPolicy },
  )
  assertEqual(
    bashAllowed.code,
    0,
    `Bash allowed cd exit code (${JSON.stringify(bashAllowed)})`,
  )
  assertEqual(
    await realpath(getCwd()),
    await realpath(externalAllowed),
    `Bash persists an authorized additional directory (${JSON.stringify(bashAllowed)})`,
  )
  assertEqual(
    bashAllowed.cwdReset,
    undefined,
    'authorized Bash cd is not marked as reset',
  )

  const bashDenied = await executeAndWait(
    `cd ${bashQuote(externalDenied)}`,
    'bash',
    { cwdPolicy },
  )
  assertEqual(bashDenied.code, 0, 'Bash denied-persistence command still ran')
  assertEqual(
    await realpath(getCwd()),
    projectRoot,
    'Bash unauthorized cwd is reset to the stable root',
  )
  assertEqual(
    bashDenied.cwdReset?.reason,
    'outside_authorized_directories',
    'Bash reports the cwd policy rejection',
  )
  assert(
    formatShellCwdResetMessage(bashDenied.cwdReset!).includes(
      'outside the authorized working directories',
    ),
    'Bash reset result has a clear user-facing explanation',
  )

  if (getPlatform() === 'windows') {
    const powershellAllowed = await executeAndWait(
      `Set-Location -LiteralPath ${powershellQuote(externalAllowed)}`,
      'powershell',
      { cwdPolicy },
    )
    assertEqual(
      powershellAllowed.code,
      0,
      'PowerShell allowed cd exit code',
    )
    assertEqual(
      await realpath(getCwd()),
      await realpath(externalAllowed),
      'PowerShell persists an authorized additional directory',
    )

    const powershellDenied = await executeAndWait(
      `Set-Location -LiteralPath ${powershellQuote(externalDenied)}`,
      'powershell',
      { cwdPolicy },
    )
    assertEqual(
      powershellDenied.code,
      0,
      'PowerShell denied-persistence command still ran',
    )
    assertEqual(
      await realpath(getCwd()),
      projectRoot,
      'PowerShell unauthorized cwd is reset to the stable root',
    )
    assertEqual(
      powershellDenied.cwdReset?.reason,
      'outside_authorized_directories',
      'PowerShell reports the cwd policy rejection',
    )
  }

  setCwd(vanishingCwd)
  await rm(vanishingCwd, { recursive: true, force: true })
  const recovered = await executeAndWait('echo cwd-recovered', 'bash', {
    cwdPolicy,
  })
  assertEqual(recovered.code, 0, 'command runs after deleted cwd recovery')
  assertEqual(
    await realpath(getCwd()),
    projectRoot,
    'deleted main cwd recovers to stable root',
  )
  assertEqual(
    recovered.cwdReset?.reason,
    'cwd_unavailable',
    'deleted cwd recovery is visible in the result',
  )
  assert(
    formatShellCwdResetMessage(recovered.cwdReset!).includes(
      'was unavailable',
    ),
    'deleted cwd recovery has a clear user-facing explanation',
  )

  setCwd(externalDenied)
  const preSpawnReset = await executeAndWait('echo pre-spawn-reset', 'bash', {
    cwdPolicy,
  })
  assertEqual(preSpawnReset.code, 0, 'command runs after pre-spawn cwd reset')
  assertEqual(
    await realpath(getCwd()),
    projectRoot,
    'Shell does not start from a temporary /cd outside authorized roots',
  )
  assertEqual(
    preSpawnReset.cwdReset?.reason,
    'outside_authorized_directories',
    'pre-spawn unauthorized cwd reset is visible in the result',
  )

  // `/cd` changes the main logical cwd, but a new Agent receives its own
  // stable scope. Mutations inside that scope cannot write back to the main
  // session.
  setCwd(externalAllowed)
  await runWithCwdOverride(projectRoot, async () => {
    assertEqual(getCwd(), projectRoot, 'Agent starts at stable project cwd')
    setCwd(projectChild)
    assertEqual(
      await realpath(getCwd()),
      await realpath(projectChild),
      'Agent cwd can change inside its own async context',
    )
    await Promise.resolve()
    assertEqual(
      await realpath(getCwd()),
      await realpath(projectChild),
      'Agent cwd override survives async boundaries',
    )
  })
  assertEqual(
    await realpath(getCwd()),
    await realpath(externalAllowed),
    'Agent cwd changes do not write back to main temporary cwd',
  )

  await runWithCwdOverride(projectRoot, async () => {
    const result = await executeAndWait(
      `cd ${bashQuote(projectChild)}`,
      'bash',
      { preventCwdChanges: true, cwdPolicy },
    )
    assertEqual(result.code, 0, 'subagent Bash cd command executes')
    assertEqual(
      getCwd(),
      projectRoot,
      'subagent Shell cd does not persist between tool calls',
    )
  })
  assertEqual(
    await realpath(getCwd()),
    await realpath(externalAllowed),
    'subagent Shell execution leaves main cwd unchanged',
  )

  const [firstCwd, secondCwd] = await Promise.all([
    runWithCwdOverride(projectRoot, async () => {
      await Promise.resolve()
      setCwd(projectChild)
      await Promise.resolve()
      return getCwd()
    }),
    runWithCwdOverride(externalAllowed, async () => {
      await Promise.resolve()
      return getCwd()
    }),
  ])
  assertEqual(
    await realpath(firstCwd),
    await realpath(projectChild),
    'parallel Agent cwd scope one remains isolated',
  )
  assertEqual(
    await realpath(secondCwd),
    await realpath(externalAllowed),
    'parallel Agent cwd scope two remains isolated',
  )

  const shellSource = await Bun.file(
    join(import.meta.dir, '../../src/utils/Shell.ts'),
  ).text()
  assert(
    shellSource.indexOf('cwdPolicy.isAllowed') <
      shellSource.indexOf('onCwdChangedForHooks(cwd, normalizedNewCwd)'),
    'cwd authorization runs before an accepted CwdChanged Hook',
  )

  const agentSource = await Bun.file(
    join(
      import.meta.dir,
      '../../packages/builtin-tools/src/tools/AgentTool/AgentTool.tsx',
    ),
  ).text()
  assert(
    agentSource.includes(
      'appState.toolPermissionContext.writeIsolationRoot ??',
    ) &&
      agentSource.includes('getOriginalCwd();') &&
      agentSource.includes('runWithCwdOverride(cwdOverridePath, fn)'),
    'new Agents use a stable isolated cwd scope instead of inheriting /cd',
  )
} finally {
  setCwd(startupCwd)
  await rm(projectFixture, { recursive: true, force: true })
  await rm(externalRoot, { recursive: true, force: true })
}

console.log('[agent-cwd-isolation] PASS')
