import { existsSync } from 'node:fs'
import { delimiter, dirname, join, resolve } from 'node:path'

const forbiddenNames =
  process.platform === 'win32'
    ? [
        'node.exe',
        'node.cmd',
        'node.bat',
        'npm.exe',
        'npm.cmd',
        'npm.bat',
        'npx.exe',
        'npx.cmd',
        'npx.bat',
      ]
    : ['node', 'npm', 'npx']

function pathKey(value: string): string {
  const normalized = resolve(value)
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

function containsForbiddenExecutable(directory: string): boolean {
  return forbiddenNames.some(name => existsSync(join(directory, name)))
}

export interface BunOnlyPath {
  path: string
  removed: string[]
}

export function createBunOnlyPath(
  currentPath: string | undefined,
  bunExecutable = process.execPath,
): BunOnlyPath {
  const bunDirectory = dirname(bunExecutable)
  const candidates = [bunDirectory, ...(currentPath ?? '').split(delimiter)]
    .map(entry => entry.trim())
    .filter(Boolean)
  const seen = new Set<string>()
  const retained: string[] = []
  const removed: string[] = []

  for (const directory of candidates) {
    const key = pathKey(directory)
    if (seen.has(key)) continue
    seen.add(key)

    if (
      key !== pathKey(bunDirectory) &&
      containsForbiddenExecutable(directory)
    ) {
      removed.push(directory)
      continue
    }
    retained.push(directory)
  }

  return { path: retained.join(delimiter), removed }
}

export function assertBunOnlyPath(path: string): void {
  for (const command of ['node', 'node.exe', 'npm', 'npx']) {
    const resolved = Bun.which(command, { PATH: path })
    if (resolved) {
      throw new Error(
        `Bun-only PATH still resolves forbidden executable ${command}: ${resolved}`,
      )
    }
  }
}

export function withBunOnlyPath(
  source: Record<string, string | undefined>,
  path: string,
): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [name, value] of Object.entries(source)) {
    if (value !== undefined && name.toLowerCase() !== 'path') {
      result[name] = value
    }
  }
  result.PATH = path
  return result
}
