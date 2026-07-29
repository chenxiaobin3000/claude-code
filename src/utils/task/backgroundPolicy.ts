/**
 * Shared timing contract for foreground Shell tools.
 *
 * Bash and PowerShell register progress at the same threshold and, in
 * assistant mode, move eligible long-running commands to the background
 * after the same blocking budget.
 */
export const SHELL_PROGRESS_THRESHOLD_MS = 2_000
export const ASSISTANT_SHELL_BLOCKING_BUDGET_MS = 15_000
