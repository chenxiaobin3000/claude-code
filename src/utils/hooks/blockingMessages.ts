export type BlockingErrorLike = { blockingError: string }

export function getPreToolHookBlockingMessage(
  hookName: string,
  error: BlockingErrorLike,
): string {
  return `${hookName} hook error: ${error.blockingError}`
}

export function getStopHookMessage(error: BlockingErrorLike): string {
  return `Stop hook feedback:\n${error.blockingError}`
}

export function getTeammateIdleHookMessage(error: BlockingErrorLike): string {
  return `TeammateIdle hook feedback:\n${error.blockingError}`
}

export function getTaskCreatedHookMessage(error: BlockingErrorLike): string {
  return `TaskCreated hook feedback:\n${error.blockingError}`
}

export function getTaskCompletedHookMessage(error: BlockingErrorLike): string {
  return `TaskCompleted hook feedback:\n${error.blockingError}`
}

export function getUserPromptSubmitHookBlockingMessage(
  error: BlockingErrorLike,
): string {
  return `UserPromptSubmit operation blocked by hook:\n${error.blockingError}`
}

export function hasBlockingResult(
  results: ReadonlyArray<{ blocked: boolean }>,
): boolean {
  return results.some(result => result.blocked)
}
