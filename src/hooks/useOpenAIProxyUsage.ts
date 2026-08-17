import { useEffect, useState } from 'react'
import { useMainLoopModel } from './useMainLoopModel.js'
import {
  parseOpenAIProxyQuotaSnapshot,
  resolveOpenAIProxyUsageTarget,
  type OpenAIProxyQuotaSnapshot,
} from '../services/providerUsage/openaiProxy.js'

const REFRESH_INTERVAL_MS = 3 * 60_000

export function useOpenAIProxyUsage(): OpenAIProxyQuotaSnapshot | null {
  const model = useMainLoopModel()
  const [usage, setUsage] = useState<OpenAIProxyQuotaSnapshot | null>(null)

  useEffect(() => {
    const target = resolveOpenAIProxyUsageTarget(model)
    setUsage(null)
    if (!target) return
    const activeTarget = target

    let active = true
    let request: AbortController | null = null

    async function refresh(): Promise<void> {
      request?.abort()
      request = new AbortController()
      try {
        const response = await fetch(activeTarget.endpoint, {
          method: 'GET',
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${activeTarget.token}`,
          },
          cache: 'no-store',
          signal: request.signal,
        })
        if (!response.ok) return
        const snapshot = parseOpenAIProxyQuotaSnapshot(await response.json())
        if (active && snapshot) setUsage(snapshot)
      } catch {
        // Quota display is optional and must never affect the model session.
      }
    }

    void refresh()
    const timer = setInterval(() => void refresh(), REFRESH_INTERVAL_MS)
    return () => {
      active = false
      request?.abort()
      clearInterval(timer)
    }
  }, [model])

  return usage
}
