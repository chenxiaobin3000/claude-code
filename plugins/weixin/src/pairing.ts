import { loadStateJson, saveStateJson } from './accounts.js'

export interface AccessConfig {
  policy: 'pairing' | 'allowlist' | 'disabled'
  allowFrom: string[]
}

interface PendingEntry {
  userId: string
  expiresAt: number
}

function loadPending(accountId: string): Record<string, PendingEntry> {
  return loadStateJson<Record<string, PendingEntry>>(
    'pending-pairings.json',
    {},
    accountId,
  )
}

function savePending(accountId: string, data: Record<string, PendingEntry>): void {
  saveStateJson('pending-pairings.json', data, accountId)
}

export function loadAccessConfig(accountId = 'default'): AccessConfig {
  return loadStateJson<AccessConfig>(
    'access.json',
    { policy: 'pairing', allowFrom: [] },
    accountId,
  )
}

export function saveAccessConfig(config: AccessConfig, accountId = 'default'): void {
  saveStateJson('access.json', config, accountId)
}

export function isAllowed(userId: string, accountId = 'default'): boolean {
  const config = loadAccessConfig(accountId)
  if (config.policy === 'disabled') return true
  return config.allowFrom.includes(userId)
}

export function addPendingPairing(userId: string, accountId = 'default'): string {
  const pending = loadPending(accountId)
  const now = Date.now()

  for (const code of Object.keys(pending)) {
    if (pending[code]!.expiresAt < now) {
      delete pending[code]
    }
  }

  for (const [code, entry] of Object.entries(pending)) {
    if (entry.userId === userId) {
      savePending(accountId, pending)
      return code
    }
  }

  const code = String(Math.floor(100000 + Math.random() * 900000))
  pending[code] = { userId, expiresAt: now + 10 * 60 * 1000 }
  savePending(accountId, pending)
  return code
}

export function confirmPairing(code: string, accountId = 'default'): string | null {
  const pending = loadPending(accountId)
  const entry = pending[code]
  if (!entry || entry.expiresAt < Date.now()) {
    delete pending[code]
    savePending(accountId, pending)
    return null
  }

  delete pending[code]
  savePending(accountId, pending)

  const config = loadAccessConfig(accountId)
  if (!config.allowFrom.includes(entry.userId)) {
    config.allowFrom.push(entry.userId)
    saveAccessConfig(config, accountId)
  }

  return entry.userId
}
