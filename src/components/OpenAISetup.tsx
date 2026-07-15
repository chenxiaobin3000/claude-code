import React, { useState } from 'react'
import { Box, Text } from '@anthropic/ink'
import { useTerminalSize } from '../hooks/useTerminalSize.js'
import { clearOpenAIClientCache } from '../services/api/openai/client.js'
import {
  DEFAULT_OPENAI_BASE_URL,
  DEFAULT_OPENAI_MODEL,
  getEffectiveOpenAIConfig,
  openAIEndpointRequiresKey,
} from '../utils/openAIConfig.js'
import { updateSettingsForSource } from '../utils/settings/settings.js'
import TextInput from './TextInput.js'

type Props = {
  onDone(): void
}

type Step = 'baseURL' | 'apiKey' | 'model'

export function OpenAISetup({ onDone }: Props): React.ReactNode {
  const initial = getEffectiveOpenAIConfig()
  const [step, setStep] = useState<Step>('baseURL')
  const [baseURL, setBaseURL] = useState(initial.baseURL)
  const [apiKey, setApiKey] = useState(initial.apiKey)
  const [model, setModel] = useState(initial.model || DEFAULT_OPENAI_MODEL)
  const [baseURLCursor, setBaseURLCursor] = useState(initial.baseURL.length)
  const [apiKeyCursor, setApiKeyCursor] = useState(initial.apiKey.length)
  const [modelCursor, setModelCursor] = useState(
    (initial.model || DEFAULT_OPENAI_MODEL).length,
  )
  const [error, setError] = useState<string | null>(null)
  const { columns } = useTerminalSize()
  const inputColumns = Math.max(24, Math.min(88, columns - 6))

  function submitBaseURL(value: string): void {
    const normalized = value.trim().replace(/\/+$/, '')
    try {
      const url = new URL(normalized)
      if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error()
    } catch {
      setError('Enter a valid HTTP(S) OpenAI-compatible base URL.')
      return
    }
    setBaseURL(normalized)
    setError(null)
    setStep('apiKey')
  }

  function submitApiKey(value: string): void {
    const normalized = value.trim()
    if (openAIEndpointRequiresKey(baseURL) && !normalized) {
      setError('The OpenAI endpoint requires an API key.')
      return
    }
    setApiKey(normalized)
    setError(null)
    setStep('model')
  }

  function submitModel(value: string): void {
    const normalized = value.trim()
    if (!normalized) {
      setError('Enter the model ID exposed by this endpoint.')
      return
    }

    const env: Record<string, string> = {
      OPENAI_BASE_URL: baseURL,
      OPENAI_MODEL: normalized,
    }
    if (apiKey) env.OPENAI_API_KEY = apiKey

    const { error: saveError } = updateSettingsForSource('userSettings', {
      modelType: 'openai',
      env,
    })
    if (saveError) {
      setError(`Unable to save OpenAI configuration: ${saveError.message}`)
      return
    }

    process.env.OPENAI_BASE_URL = baseURL
    process.env.OPENAI_MODEL = normalized
    if (apiKey) process.env.OPENAI_API_KEY = apiKey
    clearOpenAIClientCache()
    setError(null)
    onDone()
  }

  return (
    <Box flexDirection="column" gap={1} paddingLeft={1}>
      <Text bold>Configure OpenAI-compatible API</Text>
      <Text dimColor>
        This is required before running /init or sending a model request.
      </Text>

      {step === 'baseURL' && (
        <>
          <Text>Base URL</Text>
          <TextInput
            value={baseURL}
            onChange={setBaseURL}
            onSubmit={submitBaseURL}
            placeholder={DEFAULT_OPENAI_BASE_URL}
            columns={inputColumns}
            cursorOffset={baseURLCursor}
            onChangeCursorOffset={setBaseURLCursor}
            focus
            showCursor
          />
        </>
      )}

      {step === 'apiKey' && (
        <>
          <Text>API key</Text>
          <TextInput
            value={apiKey}
            onChange={setApiKey}
            onPaste={setApiKey}
            onSubmit={submitApiKey}
            placeholder={
              openAIEndpointRequiresKey(baseURL)
                ? 'Required for api.openai.com'
                : 'Optional for endpoints without authentication'
            }
            mask="*"
            columns={inputColumns}
            cursorOffset={apiKeyCursor}
            onChangeCursorOffset={setApiKeyCursor}
            focus
            showCursor
          />
          <Text dimColor>
            Saved to your user settings. Project settings are never used for this step.
          </Text>
        </>
      )}

      {step === 'model' && (
        <>
          <Text>Model ID</Text>
          <TextInput
            value={model}
            onChange={setModel}
            onSubmit={submitModel}
            placeholder={DEFAULT_OPENAI_MODEL}
            columns={inputColumns}
            cursorOffset={modelCursor}
            onChangeCursorOffset={setModelCursor}
            focus
            showCursor
          />
        </>
      )}

      {error && <Text color="error">{error}</Text>}
      <Text dimColor>Enter to continue · Ctrl+C to exit</Text>
    </Box>
  )
}
