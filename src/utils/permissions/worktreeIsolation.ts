import { basename, isAbsolute, relative, resolve } from 'node:path'
import { getPathsForPermissionCheck } from '../fsOperations.js'

export type WorktreeShellCommand = {
  argv: readonly string[]
  redirects?: readonly { target: string; op?: string; isMerging?: boolean }[]
  writeTargets?: readonly string[]
  hasUnprovableWriteTargets?: boolean
}

function executableName(value: string): string {
  return basename(value)
    .toLowerCase()
    .replace(/\.exe$/, '')
}

export function isInsideWorktree(path: string, root: string): boolean {
  const relativePath = relative(resolve(root), resolve(path))
  return (
    relativePath === '' ||
    (!relativePath.startsWith('..') && !isAbsolute(relativePath))
  )
}

function pathEscapesWorktree(
  value: string,
  cwd: string,
  isolationRoot: string,
): boolean {
  const unquoted =
    value.length >= 2 &&
    ((value.startsWith("'") && value.endsWith("'")) ||
      (value.startsWith('"') && value.endsWith('"')))
      ? value.slice(1, -1)
      : value
  const absolutePath = resolve(cwd, unquoted)
  return getPathsForPermissionCheck(absolutePath).some(
    candidate => !isInsideWorktree(candidate, isolationRoot),
  )
}

function directoryTarget(argv: readonly string[]): string | null {
  for (let index = 1; index < argv.length; index++) {
    const arg = argv[index] ?? ''
    if (/^-(?:path|literalpath)$/i.test(arg)) {
      return argv[index + 1] ?? null
    }
    if (/^-(?:path|literalpath):/i.test(arg)) {
      return arg.slice(arg.indexOf(':') + 1)
    }
    if (!arg.startsWith('-')) return arg
  }
  return null
}

const BACKGROUND_COMMANDS = new Set([
  'nohup',
  'start-job',
  'start-threadjob',
  'start-process',
])

const NESTED_SHELL_COMMANDS = new Set([
  'bash',
  'sh',
  'zsh',
  'dash',
  'cmd',
  'powershell',
  'pwsh',
])

/**
 * Enforce directory, redirection, nested-shell and background boundaries for
 * shell commands issued by a worktree Agent.
 */
export function classifyWorktreeShellEscape(
  commands: readonly WorktreeShellCommand[],
  isolationRoot: string,
  initialCwd: string,
  options: {
    runInBackground?: boolean
    hasShellBackgroundOperator?: boolean
    additionalRedirects?: readonly {
      target: string
      op?: string
      isMerging?: boolean
    }[]
  } = {},
): string | null {
  if (options.runInBackground || options.hasShellBackgroundOperator) {
    return 'Worktree Agent cannot run shell commands in the background'
  }

  let cwd = resolve(initialCwd)
  for (const command of commands) {
    const argv = command.argv
    const executable = executableName(argv[0] ?? '')

    if (BACKGROUND_COMMANDS.has(executable)) {
      return `Worktree Agent cannot start detached or background processes with ${argv[0]}`
    }

    if (NESTED_SHELL_COMMANDS.has(executable)) {
      const args = argv.slice(1).map(arg => arg.toLowerCase())
      if (
        args.includes('-c') ||
        args.includes('/c') ||
        args.includes('-command') ||
        args.includes('-encodedcommand') ||
        args.includes('-file')
      ) {
        return `Worktree Agent cannot use nested shell execution with ${argv[0]}`
      }
    }

    if (command.hasUnprovableWriteTargets) {
      return `Worktree Agent cannot prove all write targets for ${argv[0]}`
    }

    if (
      executable === 'popd' ||
      executable === 'pop-location' ||
      executable === 'set-location' ||
      executable === 'push-location' ||
      executable === 'cd' ||
      executable === 'pushd'
    ) {
      if (executable === 'popd' || executable === 'pop-location') {
        return `Worktree Agent cannot use dynamic directory stack command ${argv[0]}`
      }
      const target = directoryTarget(argv)
      if (!target) {
        return `Worktree Agent directory change target cannot be determined: ${argv[0]}`
      }
      const nextCwd = resolve(cwd, target)
      if (
        pathEscapesWorktree(nextCwd, cwd, isolationRoot) ||
        !isInsideWorktree(nextCwd, isolationRoot)
      ) {
        return `Worktree Agent cannot change directory outside its isolated worktree: ${target}`
      }
      cwd = nextCwd
    }

    for (const redirect of command.redirects ?? []) {
      if (redirect.isMerging || redirect.target === '/dev/null') continue
      if (pathEscapesWorktree(redirect.target, cwd, isolationRoot)) {
        return `Worktree Agent cannot redirect output outside its isolated worktree: ${redirect.target}`
      }
    }

    for (const target of command.writeTargets ?? []) {
      if (pathEscapesWorktree(target, cwd, isolationRoot)) {
        return `Worktree Agent cannot write outside its isolated worktree: ${target}`
      }
    }
  }

  for (const redirect of options.additionalRedirects ?? []) {
    if (redirect.isMerging || redirect.target === '/dev/null') continue
    if (pathEscapesWorktree(redirect.target, cwd, isolationRoot)) {
      return `Worktree Agent cannot redirect output outside its isolated worktree: ${redirect.target}`
    }
  }

  return null
}

function resolveGitPath(value: string, cwd: string): string {
  return resolve(cwd, value)
}

/**
 * Reject Git invocations that retarget an isolated worktree Agent at another
 * checkout or manipulate the repository's linked-worktree registry.
 *
 * Normal Git operations inherit the shell cwd and remain valid. This only
 * classifies explicit escape hatches that would override that cwd.
 */
export function classifyWorktreeGitEscape(
  argv: readonly string[],
  isolationRoot: string,
): string | null {
  if (argv.length === 0 || executableName(argv[0] ?? '') !== 'git') {
    return null
  }

  let gitCwd = resolve(isolationRoot)
  let index = 1
  let subcommand: string | undefined

  while (index < argv.length) {
    const arg = argv[index] ?? ''

    if (arg === '--') {
      subcommand = argv[index + 1]
      break
    }

    if (arg === '-C') {
      const target = argv[index + 1]
      if (!target) {
        return 'Worktree Agent Git -C target is missing'
      }
      gitCwd = resolveGitPath(target, gitCwd)
      if (!isInsideWorktree(gitCwd, isolationRoot)) {
        return `Worktree Agent cannot target Git outside its isolated worktree: ${target}`
      }
      index += 2
      continue
    }

    if (arg.startsWith('-C') && arg.length > 2) {
      const target = arg.slice(2)
      gitCwd = resolveGitPath(target, gitCwd)
      if (!isInsideWorktree(gitCwd, isolationRoot)) {
        return `Worktree Agent cannot target Git outside its isolated worktree: ${target}`
      }
      index++
      continue
    }

    const pathOption = ['--work-tree', '--git-dir'].find(
      option => arg === option || arg.startsWith(`${option}=`),
    )
    if (pathOption) {
      const inlineValue = arg.startsWith(`${pathOption}=`)
        ? arg.slice(pathOption.length + 1)
        : undefined
      const target = inlineValue ?? argv[index + 1]
      if (!target) {
        return `Worktree Agent Git ${pathOption} target is missing`
      }
      const resolvedTarget = resolveGitPath(target, gitCwd)
      if (!isInsideWorktree(resolvedTarget, isolationRoot)) {
        return `Worktree Agent cannot use Git ${pathOption} outside its isolated worktree: ${target}`
      }
      index += inlineValue === undefined ? 2 : 1
      continue
    }

    // Global options whose next value is not a subcommand.
    if (
      arg === '-c' ||
      arg === '--config-env' ||
      arg === '--exec-path' ||
      arg === '--namespace' ||
      arg === '--super-prefix'
    ) {
      index += 2
      continue
    }
    if (
      arg.startsWith('--config-env=') ||
      arg.startsWith('--exec-path=') ||
      arg.startsWith('--namespace=') ||
      arg.startsWith('--super-prefix=')
    ) {
      index++
      continue
    }
    if (arg.startsWith('-')) {
      index++
      continue
    }

    subcommand = arg
    break
  }

  if (subcommand?.toLowerCase() === 'worktree') {
    return 'Worktree Agent cannot manage linked Git worktrees'
  }

  return null
}
