import { AsyncLocalStorage } from 'async_hooks'
import {
  getCwdState,
  getOriginalCwd,
  setCwdState,
} from '../bootstrap/state.js'

type CwdOverride = {
  cwd: string
  fallbackCwd: string
}

const cwdOverrideStorage = new AsyncLocalStorage<CwdOverride>()

/**
 * Run a function with an overridden working directory for the current async context.
 * All calls to pwd()/getCwd() within the function (and its async descendants) will
 * return the overridden cwd instead of the global one. This enables concurrent
 * agents to each see their own working directory without affecting each other.
 */
export function runWithCwdOverride<T>(cwd: string, fn: () => T): T {
  const normalized = cwd.normalize('NFC')
  return cwdOverrideStorage.run(
    { cwd: normalized, fallbackCwd: normalized },
    fn,
  )
}

/**
 * Update cwd only for the active async context when one exists. Main-session
 * callers continue to update the bootstrap cwd. This prevents a child agent
 * or worktree-scoped task from writing its cwd back into the main session.
 */
export function setCwdForCurrentContext(cwd: string): void {
  const normalized = cwd.normalize('NFC')
  const override = cwdOverrideStorage.getStore()
  if (override) {
    override.cwd = normalized
    return
  }
  setCwdState(normalized)
}

/**
 * Return the recovery directory for the current cwd scope. Agent/worktree
 * scopes recover to the directory with which they were created; the main
 * session recovers to its stable startup/worktree root.
 */
export function getCwdFallback(): string {
  return cwdOverrideStorage.getStore()?.fallbackCwd ?? getOriginalCwd()
}

/**
 * Get the current working directory
 */
export function pwd(): string {
  return cwdOverrideStorage.getStore()?.cwd ?? getCwdState()
}

/**
 * Get the current working directory or the original working directory if the current one is not available
 */
export function getCwd(): string {
  try {
    return pwd()
  } catch {
    return getOriginalCwd()
  }
}
