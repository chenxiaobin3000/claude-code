export type DestructiveOperationSeverity = 'mandatory-ask' | 'hard-deny'

export type DestructiveOperation = {
  severity: DestructiveOperationSeverity
  operation: string
  reason: string
}

const GIT_GLOBAL_OPTIONS_WITH_VALUE = new Set([
  '-c',
  '-C',
  '--config-env',
  '--exec-path',
  '--git-dir',
  '--namespace',
  '--shallow-file',
  '--super-prefix',
  '--work-tree',
])

function executableName(value: string): string {
  const normalized = value.replaceAll('\\', '/')
  const basename = normalized
    .slice(normalized.lastIndexOf('/') + 1)
    .toLowerCase()
  return basename.endsWith('.exe') ? basename.slice(0, -4) : basename
}

function operation(operation: string, reason: string): DestructiveOperation {
  return { severity: 'mandatory-ask', operation, reason }
}

export function unwrapCommandArgv(input: readonly string[]): string[] {
  let argv = [...input]
  for (;;) {
    const name = executableName(argv[0] ?? '')
    if (
      name === 'time' ||
      name === 'nohup' ||
      name === 'command' ||
      name === 'builtin' ||
      name === 'exec'
    ) {
      argv = argv.slice(1)
      continue
    }
    if (name === 'timeout') {
      let i = 1
      while (i < argv.length && argv[i]?.startsWith('-')) {
        const flag = argv[i]!
        i +=
          flag === '-k' ||
          flag === '-s' ||
          flag === '--kill-after' ||
          flag === '--signal'
            ? 2
            : 1
      }
      argv = argv.slice(Math.min(i + 1, argv.length))
      continue
    }
    if (name === 'nice') {
      argv =
        argv[1] === '-n'
          ? argv.slice(3)
          : argv[1]?.startsWith('-')
            ? argv.slice(2)
            : argv.slice(1)
      continue
    }
    if (name === 'env') {
      let i = 1
      while (i < argv.length) {
        const arg = argv[i]!
        if (arg.includes('=') || arg === '-i' || arg === '-0' || arg === '-v')
          i++
        else if (arg === '-u') i += 2
        else break
      }
      argv = argv.slice(i)
      continue
    }
    if (name === 'stdbuf') {
      let i = 1
      while (i < argv.length && argv[i]?.startsWith('-')) {
        i += /^-[ioe]$/.test(argv[i]!) ? 2 : 1
      }
      argv = argv.slice(i)
      continue
    }
    if (name === 'sudo' || name === 'doas') {
      let i = 1
      while (i < argv.length && argv[i]?.startsWith('-')) {
        const flag = argv[i]!
        i +=
          flag === '-u' ||
          flag === '-g' ||
          flag === '-h' ||
          flag === '-p' ||
          flag === '-C'
            ? 2
            : 1
      }
      argv = argv.slice(i)
      continue
    }
    return argv
  }
}

function splitGitCommand(
  args: readonly string[],
): { subcommand: string; args: string[] } | null {
  let i = 0
  while (i < args.length) {
    const arg = args[i]!
    if (arg === '--') {
      i++
      break
    }
    if (!arg.startsWith('-')) break
    const option = arg.includes('=') ? arg.slice(0, arg.indexOf('=')) : arg
    if (
      !arg.includes('=') &&
      (GIT_GLOBAL_OPTIONS_WITH_VALUE.has(option) ||
        (arg.length === 2 && (arg === '-c' || arg === '-C')))
    ) {
      i += 2
    } else {
      i++
    }
  }
  const subcommand = args[i]?.toLowerCase()
  return subcommand ? { subcommand, args: [...args.slice(i + 1)] } : null
}

function shortFlagIncludes(arg: string, flag: string): boolean {
  return (
    arg.startsWith('-') && !arg.startsWith('--') && arg.slice(1).includes(flag)
  )
}

function classifyGit(args: readonly string[]): DestructiveOperation | null {
  const parsed = splitGitCommand(args)
  if (!parsed) return null
  const { subcommand, args: subArgs } = parsed
  const lower = subArgs.map(arg => arg.toLowerCase())

  if (
    subcommand === 'reset' &&
    lower.some(arg => arg === '--hard' || arg.startsWith('--hard='))
  ) {
    return operation(
      'git.resetHard',
      'git reset --hard may discard uncommitted changes',
    )
  }
  if (subcommand === 'clean') {
    const dryRun = lower.some(
      arg => arg === '--dry-run' || shortFlagIncludes(arg, 'n'),
    )
    const force = lower.some(
      arg => arg === '--force' || shortFlagIncludes(arg, 'f'),
    )
    if (force && !dryRun)
      return operation(
        'git.cleanForce',
        'git clean with force may permanently delete untracked files',
      )
  }
  if (subcommand === 'checkout' || subcommand === 'restore') {
    const separator = lower.indexOf('--')
    if (separator >= 0 && lower.slice(separator + 1).includes('.')) {
      return operation(
        `git.${subcommand}WorkingTree`,
        `git ${subcommand} -- . may discard working tree changes`,
      )
    }
  }
  if (subcommand === 'stash' && (lower[0] === 'drop' || lower[0] === 'clear')) {
    return operation(
      `git.stash${lower[0] === 'drop' ? 'Drop' : 'Clear'}`,
      `git stash ${lower[0]} may permanently remove stashed changes`,
    )
  }
  if (subcommand === 'branch') {
    const forceDelete =
      subArgs.includes('-D') ||
      (lower.includes('--delete') && lower.includes('--force'))
    if (forceDelete)
      return operation(
        'git.branchForceDelete',
        'git branch force-delete may remove an unmerged branch',
      )
  }
  if (subcommand === 'push') {
    const force = lower.some(
      arg =>
        arg === '-f' ||
        arg === '--force' ||
        arg.startsWith('--force=') ||
        arg === '--force-with-lease' ||
        arg.startsWith('--force-with-lease='),
    )
    if (force)
      return operation(
        'git.forcePush',
        'Forced git push may overwrite remote history',
      )
  }
  return null
}

function hasGlob(value: string): boolean {
  return value.includes('*') || value.includes('?') || value.includes('[')
}

function classifyRemoval(
  name: string,
  args: readonly string[],
): DestructiveOperation | null {
  const lower = args.map(arg => arg.toLowerCase())
  const recursive = lower.some(
    arg =>
      arg === '--recursive' ||
      shortFlagIncludes(arg, 'r') ||
      shortFlagIncludes(arg, 'R'),
  )
  const force = lower.some(
    arg => arg === '--force' || shortFlagIncludes(arg, 'f'),
  )
  const broad = args.some(hasGlob)
  if (recursive || force || broad) {
    return operation(
      `${name}.dangerousRemoval`,
      `${name} with recursive, force, or wildcard arguments may cause irreversible data loss`,
    )
  }
  return null
}

function sqlWordStatements(
  sql: string,
): Array<Array<{ word: string; depth: number }>> {
  const statements: Array<Array<{ word: string; depth: number }>> = [[]]
  let depth = 0
  let word = ''
  let quote: "'" | '"' | '`' | null = null
  let lineComment = false
  let blockComment = false
  const flush = (): void => {
    if (!word) return
    statements.at(-1)!.push({ word: word.toUpperCase(), depth })
    word = ''
  }
  for (let i = 0; i < sql.length; i++) {
    const char = sql[i]!
    const next = sql[i + 1]
    if (lineComment) {
      if (char === '\n') lineComment = false
      continue
    }
    if (blockComment) {
      if (char === '*' && next === '/') {
        blockComment = false
        i++
      }
      continue
    }
    if (quote) {
      if (char === quote && next === quote) i++
      else if (char === quote) quote = null
      else if (char === '\\') i++
      continue
    }
    if (char === '-' && next === '-') {
      flush()
      lineComment = true
      i++
      continue
    }
    if (char === '/' && next === '*') {
      flush()
      blockComment = true
      i++
      continue
    }
    if (char === "'" || char === '"' || char === '`') {
      flush()
      quote = char
      continue
    }
    if (char === '(') {
      flush()
      depth++
      continue
    }
    if (char === ')') {
      flush()
      depth = Math.max(0, depth - 1)
      continue
    }
    if (char === ';') {
      flush()
      statements.push([])
      continue
    }
    if (
      (char >= 'A' && char <= 'Z') ||
      (char >= 'a' && char <= 'z') ||
      char === '_'
    ) {
      word += char
    } else {
      flush()
    }
  }
  flush()
  return statements
}

function classifySql(sql: string): DestructiveOperation | null {
  for (const tokens of sqlWordStatements(sql)) {
    const top = tokens
      .filter(token => token.depth === 0)
      .map(token => token.word)
    const drop = top.indexOf('DROP')
    if (
      drop >= 0 &&
      ['DATABASE', 'SCHEMA', 'TABLE'].includes(top[drop + 1] ?? '')
    ) {
      return operation(
        'database.drop',
        `SQL ${top.slice(drop, drop + 2).join(' ')} may permanently delete database objects`,
      )
    }
    if (top.includes('TRUNCATE')) {
      return operation(
        'database.truncate',
        'SQL TRUNCATE may permanently delete all rows',
      )
    }
    const deleteIndex = top.indexOf('DELETE')
    if (
      deleteIndex >= 0 &&
      top[deleteIndex + 1] === 'FROM' &&
      !top.slice(deleteIndex + 2).includes('WHERE')
    ) {
      return operation(
        'database.unconditionalDelete',
        'SQL DELETE without a top-level WHERE clause may delete all rows',
      )
    }
  }
  return null
}

function sqlArguments(name: string, args: readonly string[]): string[] {
  const result: string[] = []
  if (name === 'psql') {
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '-c' || args[i] === '--command')
        result.push(args[++i] ?? '')
      else if (args[i]?.startsWith('-c') && args[i]!.length > 2)
        result.push(args[i]!.slice(2))
      else if (args[i]?.startsWith('--command='))
        result.push(args[i]!.slice('--command='.length))
    }
  } else if (name === 'mysql' || name === 'mariadb') {
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '-e' || args[i] === '--execute')
        result.push(args[++i] ?? '')
      else if (args[i]?.startsWith('-e') && args[i]!.length > 2)
        result.push(args[i]!.slice(2))
      else if (args[i]?.startsWith('--execute='))
        result.push(args[i]!.slice('--execute='.length))
    }
  } else if (name === 'sqlite3') {
    const positional = args.filter(arg => !arg.startsWith('-'))
    if (positional.length > 1) result.push(...positional.slice(1))
  } else if (name === 'sqlcmd') {
    for (let i = 0; i < args.length; i++) {
      if (args[i]?.toLowerCase() === '-q') result.push(args[++i] ?? '')
    }
  } else if (name === 'invoke-sqlcmd') {
    for (let i = 0; i < args.length; i++) {
      const arg = args[i]?.toLowerCase()
      if (arg === '-query' || arg === '-q') result.push(args[++i] ?? '')
    }
  }
  return result
}

export function classifyDestructiveArgv(
  input: readonly string[],
): DestructiveOperation | null {
  const argv = unwrapCommandArgv(input)
  const name = executableName(argv[0] ?? '')
  const args = argv.slice(1)
  if (!name) return null

  if (name === 'git') return classifyGit(args)
  if (name === 'rm' || name === 'rmdir') return classifyRemoval(name, args)
  if (name === 'remove-item') {
    const lower = args.map(arg => arg.toLowerCase())
    if (
      lower.some(arg => arg === '-recurse' || arg === '-force') ||
      args.some(hasGlob)
    ) {
      return operation(
        'powershell.removeItem',
        'Remove-Item with recurse, force, or wildcard arguments may cause irreversible data loss',
      )
    }
  }
  if (name === 'clear-disk')
    return operation(
      'powershell.clearDisk',
      'Clear-Disk may erase disk partition data',
    )
  if (name === 'format-volume')
    return operation(
      'powershell.formatVolume',
      'Format-Volume may destroy all data on a volume',
    )
  if (
    name === 'terraform' &&
    (args[0]?.toLowerCase() === 'destroy' ||
      (args[0]?.toLowerCase() === 'apply' &&
        args.some(arg => arg.toLowerCase() === '-destroy')))
  ) {
    return operation(
      'terraform.destroy',
      'Terraform destroy may remove managed infrastructure',
    )
  }
  if (name === 'kubectl') {
    const lower = args.map(arg => arg.toLowerCase())
    if (
      lower.includes('delete') &&
      !lower.some(arg => arg === '--dry-run' || arg.startsWith('--dry-run='))
    ) {
      return operation(
        'kubectl.delete',
        'kubectl delete may remove Kubernetes resources',
      )
    }
  }
  for (const sql of sqlArguments(name, args)) {
    const result = classifySql(sql)
    if (result) return result
  }
  return null
}

export function getDestructiveOperationWarning(
  reason: { type?: string; reason?: string } | undefined,
): string | null {
  return reason?.type === 'destructiveOperation' && reason.reason
    ? `Note: ${reason.reason}`
    : null
}
