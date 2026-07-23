import { basename, isAbsolute, relative, resolve } from 'node:path'

function executableName(value: string): string {
  return basename(value)
    .toLowerCase()
    .replace(/\.exe$/, '')
}

function isInsideRoot(path: string, root: string): boolean {
  const relativePath = relative(resolve(root), resolve(path))
  return (
    relativePath === '' ||
    (!relativePath.startsWith('..') && !isAbsolute(relativePath))
  )
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
      if (!isInsideRoot(gitCwd, isolationRoot)) {
        return `Worktree Agent cannot target Git outside its isolated worktree: ${target}`
      }
      index += 2
      continue
    }

    if (arg.startsWith('-C') && arg.length > 2) {
      const target = arg.slice(2)
      gitCwd = resolveGitPath(target, gitCwd)
      if (!isInsideRoot(gitCwd, isolationRoot)) {
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
      if (!isInsideRoot(resolvedTarget, isolationRoot)) {
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
