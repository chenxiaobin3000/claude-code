import { useCallback } from 'react'

export type VerificationStatus =
  | 'loading'
  | 'valid'
  | 'invalid'
  | 'missing'
  | 'error'

export type ApiKeyVerificationResult = {
  status: VerificationStatus
  reverify: () => Promise<void>
  error: Error | null
}

/**
 * Credentials are validated by the configured OpenAI-compatible endpoint when
 * a request is made. There is no separate Anthropic key approval or probe.
 */
export function useApiKeyVerification(): ApiKeyVerificationResult {
  const reverify = useCallback(async (): Promise<void> => {}, [])
  return { status: 'valid', reverify, error: null }
}
