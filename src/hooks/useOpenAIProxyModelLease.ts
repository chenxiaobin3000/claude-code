import { randomUUID } from 'node:crypto'
import { useEffect, useRef } from 'react'
import { resolveOpenAIProxyUsageTarget } from '../services/providerUsage/openaiProxy.js'
import { useMainLoopModel } from './useMainLoopModel.js'

const MODEL_LEASE_HEARTBEAT_MS = 5_000
const CLIENT_OWNER_HEADER = 'x-openai-proxy-client-id'

export function useOpenAIProxyModelLease(): void {
  const model = useMainLoopModel()
  const ownerId = useRef(randomUUID()).current

  useEffect(() => {
    const target = resolveOpenAIProxyUsageTarget(model)
    if (!target) return
    let active = true
    let request: AbortController | undefined

    const retain = async (): Promise<void> => {
      request?.abort()
      request = new AbortController()
      try {
        await fetch(target.retainEndpoint, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${target.token}`,
            [CLIENT_OWNER_HEADER]: ownerId,
          },
          signal: request.signal,
        })
      } catch {
        // The MCP Host may still be starting. The next heartbeat retries.
      }
    }

    void retain()
    const timer = setInterval(() => {
      if (active) void retain()
    }, MODEL_LEASE_HEARTBEAT_MS)
    return () => {
      active = false
      clearInterval(timer)
      request?.abort()
      void fetch(target.releaseEndpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${target.token}`,
          [CLIENT_OWNER_HEADER]: ownerId,
        },
      }).catch(() => undefined)
    }
  }, [model, ownerId])
}
