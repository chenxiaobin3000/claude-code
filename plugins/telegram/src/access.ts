import { loadTelegramState, saveTelegramState } from './config.js'

export interface TelegramAccessConfig { policy: 'pairing' | 'allowlist' | 'disabled'; allowUsers: string[] }
interface PendingPairing { userId: string; expiresAt: number }

export function loadTelegramAccess(alias: string): TelegramAccessConfig { return loadTelegramState(alias, 'access.json', { policy: 'pairing', allowUsers: [] }) }
export function isTelegramUserAllowed(alias: string, userId: string): boolean {
  const config = loadTelegramAccess(alias)
  return config.policy === 'disabled' || config.allowUsers.includes(userId)
}
export function createTelegramPairing(alias: string, userId: string, random = Math.random): string {
  const pending = loadTelegramState<Record<string, PendingPairing>>(alias, 'pending-pairings.json', {})
  const now = Date.now()
  for (const [code, value] of Object.entries(pending)) {
    if (value.expiresAt <= now) delete pending[code]
    else if (value.userId === userId) return code
  }
  const code = String(Math.floor(100000 + random() * 900000))
  pending[code] = { userId, expiresAt: now + 10 * 60_000 }
  saveTelegramState(alias, 'pending-pairings.json', pending)
  return code
}
export function confirmTelegramPairing(alias: string, code: string): string | null {
  const pending = loadTelegramState<Record<string, PendingPairing>>(alias, 'pending-pairings.json', {})
  const item = pending[code]
  if (!item || item.expiresAt <= Date.now()) return null
  delete pending[code]
  saveTelegramState(alias, 'pending-pairings.json', pending)
  const access = loadTelegramAccess(alias)
  if (!access.allowUsers.includes(item.userId)) access.allowUsers.push(item.userId)
  saveTelegramState(alias, 'access.json', access)
  return item.userId
}
