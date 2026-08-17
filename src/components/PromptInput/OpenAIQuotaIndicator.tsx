import * as React from 'react';
import { Text } from '@anthropic/ink';
import { useOpenAIProxyUsage } from '../../hooks/useOpenAIProxyUsage.js';
import { useTerminalSize } from '../../hooks/useTerminalSize.js';
import { formatOpenAIProxyQuota } from '../../services/providerUsage/openaiProxy.js';

export function OpenAIQuotaIndicator(): React.ReactNode {
  const usage = useOpenAIProxyUsage();
  const { columns } = useTerminalSize();
  if (!usage || columns < 80) return null;

  const remaining = Math.min(
    ...(usage.primary ? [usage.primary.remainingPercent] : []),
    ...(usage.secondary ? [usage.secondary.remainingPercent] : []),
  );
  const color = remaining <= 5 ? 'error' : remaining <= 20 ? 'warning' : undefined;

  return (
    <Text color={color} dimColor={color === undefined} wrap="truncate">
      {formatOpenAIProxyQuota(usage)}
    </Text>
  );
}
