import type { ProviderBalance } from '../types.js'
import type { BalanceProvider } from './types.js'
import { getConfiguredModels } from '../../../utils/model/modelRegistry.js'

/**
 * DeepSeek exposes balance at `GET /user/balance`.
 *
 * Enabled when a configured model points at api.deepseek.com.
 *
 * Response shape:
 *   { is_available: true, balance_infos: [{ currency:"USD", total_balance:"5.00", ... }, ...] }
 */

function getDeepSeekTarget(): { baseUrl: string; apiKey: string } | null {
  try {
    const entry = getConfiguredModels().find(model =>
      /\bapi\.deepseek\.com\b/i.test(model.baseUrl),
    )
    if (!entry) return null
    const apiKey = process.env[entry.apiKeyEnv ?? 'OPENAI_API_KEY'] ?? ''
    return apiKey
      ? { baseUrl: entry.baseUrl.replace(/\/+$/, ''), apiKey }
      : null
  } catch {
    return null
  }
}

export const deepseekBalanceProvider: BalanceProvider = {
  providerId: 'deepseek',

  isEnabled(): boolean {
    return getDeepSeekTarget() !== null
  },

  async fetchBalance(signal?: AbortSignal): Promise<ProviderBalance | null> {
    const target = getDeepSeekTarget()
    if (!target) return null

    let res: Response
    try {
      res = await fetch(`${target.baseUrl}/user/balance`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${target.apiKey}`,
          Accept: 'application/json',
        },
        signal,
      })
    } catch {
      return null
    }
    if (!res.ok) return null

    let data: unknown
    try {
      data = await res.json()
    } catch {
      return null
    }

    const infos = (data as { balance_infos?: unknown })?.balance_infos
    if (!Array.isArray(infos)) return null

    // Prefer USD; fall back to the first entry.
    const usd = infos.find(
      (e: unknown) =>
        typeof e === 'object' &&
        e !== null &&
        (e as { currency?: unknown }).currency === 'USD',
    ) as Record<string, unknown> | undefined
    const pick = usd ?? (infos[0] as Record<string, unknown>) ?? null
    if (!pick) return null

    const currency = typeof pick.currency === 'string' ? pick.currency : 'USD'
    const remainingRaw = pick.total_balance
    const remaining =
      typeof remainingRaw === 'number' ? remainingRaw : Number(remainingRaw)
    if (!Number.isFinite(remaining)) return null

    return {
      currency,
      remaining,
      updatedAt: Math.floor(Date.now() / 1000),
    }
  },
}
