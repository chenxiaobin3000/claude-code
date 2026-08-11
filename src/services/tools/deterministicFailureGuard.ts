import { statSync } from 'node:fs'
import { expandPath } from '../../utils/path.js'

const FILE_TOOL_NAMES = new Set(['Read', 'Edit', 'Write', 'NotebookEdit'])
const MAX_EXECUTIONS_BEFORE_BLOCK = 2
type DeterministicFailureRecord = {
  count: number
  failureClass: string
  filePath: string
  stateFingerprint: string
}

const failuresByTurn = new WeakMap<
  AbortSignal,
  Map<string, DeterministicFailureRecord>
>()

function filePathFromInput(input: unknown): string | undefined {
  if (!input || typeof input !== 'object') return undefined
  const record = input as Record<string, unknown>
  const value = record.file_path ?? record.notebook_path
  return typeof value === 'string' ? value : undefined
}

function filePathFromKey(key: string): string {
  return key.slice(key.indexOf('\0') + 1)
}

function fileStateFingerprint(filePath: string): string {
  try {
    const stat = statSync(filePath, { throwIfNoEntry: false })
    if (!stat) return 'missing'
    const type = stat.isFile()
      ? 'file'
      : stat.isDirectory()
        ? 'directory'
        : stat.isSymbolicLink()
          ? 'symlink'
          : 'other'
    return [
      type,
      stat.size,
      stat.mtimeMs,
      stat.ctimeMs,
      stat.ino,
    ].join(':')
  } catch (error) {
    const code =
      error && typeof error === 'object' && 'code' in error
        ? String((error as { code?: unknown }).code)
        : 'unknown'
    return `inaccessible:${code}`
  }
}

function deterministicFailureClass(error: unknown): string | undefined {
  const message = String(error instanceof Error ? error.message : error)
  if (/File does not exist/i.test(message)) return 'missing'
  if (/Credential protection prevents/i.test(message)) return 'credential'
  if (/denied by your permission settings/i.test(message)) return 'permission'
  if (/Path contains null bytes/i.test(message)) return 'invalid-path'
  if (/Cannot read .+: this device file/i.test(message)) return 'device-file'
  return undefined
}

/**
 * Produces one stable key for equivalent Windows, Git Bash and native paths.
 * The key is deliberately limited to built-in file tools: arbitrary tool
 * inputs can be side-effecting or contain secrets and must not be fingerprinted.
 */
export function deterministicFileFailureKey(
  toolName: string,
  input: unknown,
): string | undefined {
  if (!FILE_TOOL_NAMES.has(toolName)) return undefined
  const filePath = filePathFromInput(input)
  if (!filePath) return undefined
  return `${toolName}\0${expandPath(filePath)}`
}

export function isDeterministicFileFailure(error: unknown): boolean {
  return deterministicFailureClass(error) !== undefined
}

function failuresFor(
  signal: AbortSignal,
): Map<string, DeterministicFailureRecord> {
  let failures = failuresByTurn.get(signal)
  if (!failures) {
    failures = new Map()
    failuresByTurn.set(signal, failures)
  }
  return failures
}

export function shouldBlockRepeatedDeterministicFailure(
  signal: AbortSignal,
  key: string | undefined,
): boolean {
  if (key === undefined) return false
  const failures = failuresFor(signal)
  const record = failures.get(key)
  if (!record) return false
  if (fileStateFingerprint(record.filePath) !== record.stateFingerprint) {
    failures.delete(key)
    return false
  }
  return record.count >= MAX_EXECUTIONS_BEFORE_BLOCK
}

export function recordDeterministicFileFailure(
  signal: AbortSignal,
  key: string | undefined,
  error: unknown,
): number {
  if (key === undefined) return 0
  const failureClass = deterministicFailureClass(error)
  if (failureClass === undefined) return 0
  const failures = failuresFor(signal)
  const filePath = filePathFromKey(key)
  const stateFingerprint = fileStateFingerprint(filePath)
  const existing = failures.get(key)
  const count =
    existing?.failureClass === failureClass &&
    existing.stateFingerprint === stateFingerprint
      ? existing.count + 1
      : 1
  failures.set(key, { count, failureClass, filePath, stateFingerprint })
  return count
}

/** A successful file operation invalidates failures for every tool on that path. */
export function clearDeterministicFileFailures(
  signal: AbortSignal,
  key: string | undefined,
): void {
  if (key === undefined) return
  const filePath = filePathFromKey(key)
  const failures = failuresFor(signal)
  for (const [candidateKey, record] of failures) {
    if (record.filePath === filePath) failures.delete(candidateKey)
  }
}

export const REPEATED_DETERMINISTIC_FAILURE_MESSAGE =
  'The same file tool call already failed twice with a deterministic error. It was not executed again. Stop retrying this exact path; use a different path, inspect the directory first, or ask the user for clarification.'
