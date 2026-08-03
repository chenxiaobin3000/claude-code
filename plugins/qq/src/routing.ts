import { validateQqAlias } from './config.js'
import type { QqChatScope } from './types.js'

export interface QqRoute { botAlias: string; scope: QqChatScope; targetId: string }
export function formatQqChatId(botAlias: string, scope: QqChatScope, targetId: string): string {
  if (!targetId) throw new Error('QQ route target is empty.')
  return `${validateQqAlias(botAlias)}::${scope}::${targetId}`
}
export function parseQqChatId(value: string): QqRoute | null {
  const parts = value.split('::')
  if (parts.length !== 3 || (parts[1] !== 'c2c' && parts[1] !== 'group') || !parts[2]) return null
  try { return { botAlias: validateQqAlias(parts[0]!), scope: parts[1], targetId: parts[2] } } catch { return null }
}
