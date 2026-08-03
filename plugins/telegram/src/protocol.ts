export const TELEGRAM_TEXT_LIMIT = 4096

export function splitTelegramText(text: string, limit = TELEGRAM_TEXT_LIMIT): string[] {
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('Telegram text limit is invalid.')
  const characters = [...text]
  if (!characters.length) return []
  const chunks: string[] = []
  for (let offset = 0; offset < characters.length; offset += limit) chunks.push(characters.slice(offset, offset + limit).join(''))
  return chunks
}

export function telegramRetryAfter(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null
  const candidate = error as { error_code?: unknown; parameters?: { retry_after?: unknown } }
  if (candidate.error_code !== 429 || typeof candidate.parameters?.retry_after !== 'number') return null
  return Math.max(0, Math.min(candidate.parameters.retry_after * 1000, 30_000))
}

export function classifyTelegramError(error: unknown): 'conflict' | 'api' | 'network' | 'unknown' {
  if (!error || typeof error !== 'object') return 'unknown'
  const candidate = error as { error_code?: unknown; name?: unknown }
  if (candidate.error_code === 409) return 'conflict'
  if (typeof candidate.error_code === 'number') return 'api'
  if (candidate.name === 'HttpError') return 'network'
  return 'unknown'
}
