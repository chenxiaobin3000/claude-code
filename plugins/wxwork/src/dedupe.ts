import { loadBotState, saveBotState } from './config.js'

interface DedupeState {
  messages: Record<string, number>
}

export function rememberWxworkMessage(
  alias: string,
  messageId: string,
  now = Date.now(),
): boolean {
  const state = loadBotState<DedupeState>(alias, 'dedupe.json', { messages: {} })
  const cutoff = now - 5 * 60_000
  for (const [id, timestamp] of Object.entries(state.messages)) {
    if (timestamp < cutoff) delete state.messages[id]
  }
  if (state.messages[messageId]) return false
  state.messages[messageId] = now
  const newest = Object.entries(state.messages)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 1_000)
  saveBotState(alias, 'dedupe.json', { messages: Object.fromEntries(newest) })
  return true
}
