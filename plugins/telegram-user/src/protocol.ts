export function redactTelegramUserError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  return redactTelegramUserProxySecret(raw)
    .replace(/\+\d{6,15}/g, '[phone]')
    .replace(/[A-Fa-f0-9]{32}/g, '[secret]')
    .replace(/1[A-Za-z0-9_-]{40,}/g, '[session]')
    .slice(0, 500)
}

import { redactTelegramUserProxySecret } from './transport.js'
