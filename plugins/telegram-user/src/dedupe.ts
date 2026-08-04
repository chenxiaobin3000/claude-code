import { loadTelegramUserState, saveTelegramUserState } from './config.js'
interface DedupeState { updates: Record<string, number>; sent: Record<string, number> }
function load(alias: string): DedupeState { return loadTelegramUserState(alias, 'dedupe.json', { updates: {}, sent: {} }) }
function prune(values: Record<string, number>, now: number): Record<string, number> { return Object.fromEntries(Object.entries(values).filter(([, timestamp]) => timestamp >= now - 24 * 60 * 60_000).sort((a, b) => b[1] - a[1]).slice(0, 5_000)) }
export function rememberTelegramUserUpdate(alias: string, key: string, now = Date.now()): boolean {
  const state = load(alias); state.updates = prune(state.updates, now); state.sent = prune(state.sent, now)
  if (state.updates[key] || state.sent[key]) return false
  state.updates[key] = now; saveTelegramUserState(alias, 'dedupe.json', state); return true
}
export function rememberTelegramUserSentMessage(alias: string, peerId: string, messageId: number, now = Date.now()): void {
  const state = load(alias); state.updates = prune(state.updates, now); state.sent = prune(state.sent, now); state.sent[`${peerId}:${messageId}`] = now; saveTelegramUserState(alias, 'dedupe.json', state)
}

