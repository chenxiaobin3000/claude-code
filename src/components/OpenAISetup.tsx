import React, { useState } from 'react';
import { Box, Text } from '@anthropic/ink';
import { useTerminalSize } from '../hooks/useTerminalSize.js';
import { clearOpenAIClientCache } from '../services/api/openai/client.js';
import { getModelsConfigPath, saveSingleModelRegistry } from '../utils/model/modelRegistry.js';
import { updateSettingsForSource } from '../utils/settings/settings.js';
import TextInput from './TextInput.js';

type Props = {
  onDone(): void;
};

type Step = 'baseUrl' | 'apiKey' | 'model';

const DEFAULT_BASE_URL = 'http://127.0.0.1:8080/v1';

function endpointRequiresKey(baseUrl: string): boolean {
  try {
    return new URL(baseUrl).hostname.toLowerCase() === 'api.openai.com';
  } catch {
    return true;
  }
}

export function OpenAISetup({ onDone }: Props): React.ReactNode {
  const [step, setStep] = useState<Step>('baseUrl');
  const [baseUrl, setBaseUrl] = useState(DEFAULT_BASE_URL);
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [baseUrlCursor, setBaseUrlCursor] = useState(DEFAULT_BASE_URL.length);
  const [apiKeyCursor, setApiKeyCursor] = useState(0);
  const [modelCursor, setModelCursor] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const { columns } = useTerminalSize();
  const inputColumns = Math.max(24, Math.min(88, columns - 6));

  function submitBaseUrl(value: string): void {
    const normalized = value.trim().replace(/\/+$/, '');
    try {
      const url = new URL(normalized);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new Error('unsupported protocol');
      }
    } catch {
      setError('Enter a valid HTTP(S) OpenAI-compatible base URL.');
      return;
    }
    setBaseUrl(normalized);
    setError(null);
    setStep('apiKey');
  }

  function submitApiKey(value: string): void {
    const normalized = value.trim();
    if (endpointRequiresKey(baseUrl) && !normalized) {
      setError('The OpenAI endpoint requires an API key.');
      return;
    }
    setApiKey(normalized);
    setError(null);
    setStep('model');
  }

  function submitModel(value: string): void {
    const normalized = value.trim();
    if (!normalized) {
      setError('Enter the model ID exposed by this endpoint.');
      return;
    }

    try {
      saveSingleModelRegistry({
        model: normalized,
        baseUrl,
        apiKeyEnv: 'OPENAI_API_KEY',
      });
      const envPatch = {
        OPENAI_BASE_URL: undefined,
        OPENAI_MODEL: undefined,
        OPENAI_API_KEY: apiKey || undefined,
      } as unknown as Record<string, string>;
      const { error: saveError } = updateSettingsForSource('userSettings', {
        env: envPatch,
      });
      if (saveError) throw saveError;

      delete process.env.OPENAI_BASE_URL;
      delete process.env.OPENAI_MODEL;
      if (apiKey) process.env.OPENAI_API_KEY = apiKey;
      else delete process.env.OPENAI_API_KEY;
      clearOpenAIClientCache();
      setError(null);
      onDone();
    } catch (saveError) {
      setError(
        `Unable to save model configuration: ${saveError instanceof Error ? saveError.message : String(saveError)}`,
      );
    }
  }

  return (
    <Box flexDirection="column" gap={1} paddingLeft={1}>
      <Text bold>Configure OpenAI-compatible API</Text>
      <Text dimColor>The default model will be saved to {getModelsConfigPath()}.</Text>

      {step === 'baseUrl' && (
        <>
          <Text>Base URL</Text>
          <TextInput
            value={baseUrl}
            onChange={setBaseUrl}
            onSubmit={submitBaseUrl}
            placeholder={DEFAULT_BASE_URL}
            columns={inputColumns}
            cursorOffset={baseUrlCursor}
            onChangeCursorOffset={setBaseUrlCursor}
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
              endpointRequiresKey(baseUrl)
                ? 'Required for api.openai.com'
                : 'Optional for local or compatible endpoints'
            }
            mask="*"
            columns={inputColumns}
            cursorOffset={apiKeyCursor}
            onChangeCursorOffset={setApiKeyCursor}
            focus
            showCursor
          />
        </>
      )}

      {step === 'model' && (
        <>
          <Text>Model ID</Text>
          <TextInput
            value={model}
            onChange={setModel}
            onSubmit={submitModel}
            placeholder="deepseek-chat or local model ID"
            columns={inputColumns}
            cursorOffset={modelCursor}
            onChangeCursorOffset={setModelCursor}
            focus
            showCursor
          />
        </>
      )}

      {error && <Text color="error">{error}</Text>}
      <Text dimColor>Enter to continue · edit models.json manually to add more models</Text>
    </Box>
  );
}
