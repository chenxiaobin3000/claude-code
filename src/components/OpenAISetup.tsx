import React, { useState } from 'react';
import { Box, Text } from '@anthropic/ink';
import { useTerminalSize } from '../hooks/useTerminalSize.js';
import { clearModelRegistryCache, getModelRegistryError, getModelsConfigPath } from '../utils/model/modelRegistry.js';
import TextInput from './TextInput.js';

type Props = {
  onDone(): void;
};

export function OpenAISetup({ onDone }: Props): React.ReactNode {
  const [value, setValue] = useState('');
  const [cursorOffset, setCursorOffset] = useState(0);
  const [error, setError] = useState(() => getModelRegistryError());
  const { columns } = useTerminalSize();

  function retry(): void {
    clearModelRegistryCache();
    const nextError = getModelRegistryError();
    setError(nextError);
    if (!nextError) onDone();
  }

  return (
    <Box flexDirection="column" gap={1} paddingLeft={1}>
      <Text bold>Configure OpenAI-compatible models</Text>
      <Text>
        Create or update <Text bold>{getModelsConfigPath()}</Text>, then press Enter to reload.
      </Text>
      <Text dimColor>Each model entry must have a unique model ID and its OpenAI-compatible baseUrl.</Text>
      {error && <Text color="error">{error}</Text>}
      <TextInput
        value={value}
        onChange={setValue}
        onSubmit={retry}
        placeholder="Press Enter after saving models.json"
        columns={Math.max(24, Math.min(88, columns - 6))}
        cursorOffset={cursorOffset}
        onChangeCursorOffset={setCursorOffset}
        focus
        showCursor
      />
    </Box>
  );
}
