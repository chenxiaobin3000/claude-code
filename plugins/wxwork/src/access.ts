import { loadBotState, saveBotState } from './config.js'

export interface WxworkAccessConfig {
  policy: 'pairing' | 'allowlist' | 'disabled'
  allowUsers: string[]
}

interface PendingPairing { userId: string; expiresAt: number }

export function loadAccess(alias: string): WxworkAccessConfig {
  return loadBotState(alias, 'access.json', { policy: 'pairing', allowUsers: [] })
}

export function saveAccess(alias: string, config: WxworkAccessConfig): void {
  saveBotState(alias, 'access.json', config)
}

export function isUserAllowed(alias: string, userId: string): boolean {
  const config = loadAccess(alias)
  return config.policy === 'disabled' || config.allowUsers.includes(userId)
}

export function createPairing(alias: string, userId: string, random = Math.random): string {
  const pending = loadBotState<Record<string, PendingPairing>>(alias, 'pending-pairings.json', {})
  const now = Date.now()
  for (const [code, value] of Object.entries(pending)) {
    if (value.expiresAt <= now) delete pending[code]
    else if (value.userId === userId) return code
  }
  const code = String(Math.floor(100000 + random() * 900000))
  pending[code] = { userId, expiresAt: now + 10 * 60_000 }
  saveBotState(alias, 'pending-pairings.json', pending)
  return code
}

export function confirmPairing(alias: string, code: string): string | null {
  const pending = loadBotState<Record<string, PendingPairing>>(alias, 'pending-pairings.json', {})
  const item = pending[code]
  if (!item || item.expiresAt <= Date.now()) {
    delete pending[code]
    saveBotState(alias, 'pending-pairings.json', pending)
    return null
  }
  delete pending[code]
  saveBotState(alias, 'pending-pairings.json', pending)
  const access = loadAccess(alias)
  if (!access.allowUsers.includes(item.userId)) access.allowUsers.push(item.userId)
  saveAccess(alias, access)
  return item.userId
}
