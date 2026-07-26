import { expandPath } from '../../utils/path.js'

const FILE_TOOL_NAMES = new Set(['Read', 'Edit', 'Write', 'NotebookEdit'])
const MAX_EXECUTIONS_BEFORE_BLOCK = 2
const failuresByTurn = new WeakMap<AbortSignal, Map<string, number>>()

function filePathFromInput(input: unknown): string | undefined {
  if (!input || typeof input !== 'object') return undefined
  const value = (input as Record<string, unknown>).file_path
  return typeof value === 'string' ? value : undefined
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
  const message = String(error instanceof Error ? error.message : error)
  return /File does not exist|Credential protection prevents|denied by your permission settings|Path contains null bytes|Cannot read .+: this device file/i.test(
    message,
  )
}

function failuresFor(signal: AbortSignal): Map<string, number> {
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
  return key !== undefined && (failuresFor(signal).get(key) ?? 0) >= MAX_EXECUTIONS_BEFORE_BLOCK
}

export function recordDeterministicFileFailure(
  signal: AbortSignal,
  key: string | undefined,
): number {
  if (key === undefined) return 0
  const failures = failuresFor(signal)
  const count = (failures.get(key) ?? 0) + 1
  failures.set(key, count)
  return count
}

export const REPEATED_DETERMINISTIC_FAILURE_MESSAGE =
  'The same file tool call already failed twice with a deterministic error. It was not executed again. Stop retrying this exact path; use a different path, inspect the directory first, or ask the user for clarification.'
