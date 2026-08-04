export const TELEGRAM_USER_TEXT_LIMIT = 4096
export const TELEGRAM_USER_MEDIA_LIMIT = 20 * 1024 * 1024
export function splitTelegramUserText(text: string, limit = TELEGRAM_USER_TEXT_LIMIT): string[] {
  if (!text) return []
  const characters = [...text]; const chunks: string[] = []
  for (let offset = 0; offset < characters.length; offset += limit) chunks.push(characters.slice(offset, offset + limit).join(''))
  return chunks
}
export function redactTelegramUserError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  return raw.replace(/\+\d{6,15}/g, '[phone]').replace(/[A-Fa-f0-9]{32}/g, '[secret]').replace(/1[A-Za-z0-9_-]{40,}/g, '[session]').slice(0, 500)
}

