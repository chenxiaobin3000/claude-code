import { loadTelegramState, saveTelegramState } from './config.js'

interface State { updates: Record<string, number> }
export function rememberTelegramUpdate(alias: string, updateId: number, now = Date.now()): boolean {
  const state = loadTelegramState<State>(alias, 'dedupe.json', { updates: {} })
  const cutoff = now - 24 * 60 * 60_000
  for (const [id, timestamp] of Object.entries(state.updates)) if (timestamp < cutoff) delete state.updates[id]
  const key = String(updateId)
  if (state.updates[key]) return false
  state.updates[key] = now
  saveTelegramState(alias, 'dedupe.json', { updates: Object.fromEntries(Object.entries(state.updates).sort((a, b) => b[1] - a[1]).slice(0, 5_000)) })
  return true
}
