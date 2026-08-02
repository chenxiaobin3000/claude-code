const STALE_TOKEN_PAUSE_MS = 60 * 60 * 1000

const pausedUntilByAccount = new Map<string, number>()

export const STALE_TOKEN_ERRCODE = -14

export function pauseSession(now = Date.now(), accountId = 'default'): number {
  const pausedUntil = now + STALE_TOKEN_PAUSE_MS
  pausedUntilByAccount.set(accountId, pausedUntil)
  return pausedUntil
}

export function getSessionPauseRemaining(now = Date.now(), accountId = 'default'): number {
  const pausedUntil = pausedUntilByAccount.get(accountId) ?? 0
  if (pausedUntil <= now) {
    pausedUntilByAccount.delete(accountId)
    return 0
  }
  return pausedUntil - now
}

export function assertSessionActive(now = Date.now(), accountId = 'default'): void {
  const remaining = getSessionPauseRemaining(now, accountId)
  if (remaining > 0) {
    throw new Error(
      `WeChat token is stale; requests are paused for ${Math.ceil(remaining / 60_000)} more minute(s) (errcode ${STALE_TOKEN_ERRCODE}). Reconnect the account to resume immediately.`,
    )
  }
}

export function resetSessionPause(accountId = 'default'): void {
  pausedUntilByAccount.delete(accountId)
}
