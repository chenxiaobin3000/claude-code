import { loadQqState, saveQqState } from './config.js'

export interface QqAccessConfig { policy: 'pairing' | 'allowlist' | 'disabled'; allowUsers: string[] }
interface PendingPairing { userId: string; expiresAt: number }
export function loadQqAccess(alias: string): QqAccessConfig { return loadQqState(alias, 'access.json', { policy: 'pairing', allowUsers: [] }) }
export function isQqUserAllowed(alias: string, userId: string): boolean {
  const config = loadQqAccess(alias)
  return config.policy === 'disabled' || config.allowUsers.includes(userId)
}
export function createQqPairing(alias: string, userId: string, random = Math.random): string {
  const pending = loadQqState<Record<string, PendingPairing>>(alias, 'pending-pairings.json', {})
  const now = Date.now()
  for (const [code, value] of Object.entries(pending)) {
    if (value.expiresAt <= now) delete pending[code]
    else if (value.userId === userId) return code
  }
  const code = String(Math.floor(100000 + random() * 900000))
  pending[code] = { userId, expiresAt: now + 10 * 60_000 }
  saveQqState(alias, 'pending-pairings.json', pending)
  return code
}
export function confirmQqPairing(alias: string, code: string): string | null {
  const pending = loadQqState<Record<string, PendingPairing>>(alias, 'pending-pairings.json', {})
  const item = pending[code]
  if (!item || item.expiresAt <= Date.now()) return null
  delete pending[code]
  saveQqState(alias, 'pending-pairings.json', pending)
  const access = loadQqAccess(alias)
  if (!access.allowUsers.includes(item.userId)) access.allowUsers.push(item.userId)
  saveQqState(alias, 'access.json', access)
  return item.userId
}
