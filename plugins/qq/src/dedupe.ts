import { loadQqState, saveQqState } from './config.js'

interface State { messages: Record<string, number> }
export function rememberQqMessage(alias: string, messageId: string, now = Date.now()): boolean {
  const state = loadQqState<State>(alias, 'dedupe.json', { messages: {} })
  const cutoff = now - 10 * 60_000
  for (const [id, timestamp] of Object.entries(state.messages)) if (timestamp < cutoff) delete state.messages[id]
  if (state.messages[messageId]) return false
  state.messages[messageId] = now
  saveQqState(alias, 'dedupe.json', { messages: Object.fromEntries(Object.entries(state.messages).sort((a, b) => b[1] - a[1]).slice(0, 2_000)) })
  return true
}
