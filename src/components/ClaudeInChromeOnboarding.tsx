import React from 'react';
import { logEvent } from 'src/services/analytics/index.js';
// eslint-disable-next-line custom-rules/prefer-use-keybindings -- enter to continue
import { Box, Dialog, Newline, Text, useInput } from '@anthropic/ink';
import { isChromeExtensionInstalled } from '../utils/claudeInChrome/setup.js';
import { saveGlobalConfig } from '../utils/config.js';

type Props = {
  onDone(): void;
};

export function ClaudeInChromeOnboarding({ onDone }: Props): React.ReactNode {
  const [isExtensionInstalled, setIsExtensionInstalled] = React.useState(false);

  React.useEffect(() => {
    logEvent('tengu_claude_in_chrome_onboarding_shown', {});
    void isChromeExtensionInstalled().then(setIsExtensionInstalled);
    saveGlobalConfig(current => {
      return { ...current, hasCompletedClaudeInChromeOnboarding: true };
    });
  }, []);

  // Handle Enter to continue
  useInput((_input, key) => {
    if (key.return) {
      onDone();
    }
  });

  return (
    <Dialog title="Claude in Chrome (Beta)" onCancel={onDone} color="chromeYellow">
      <Box flexDirection="column" gap={1}>
        <Text>
          Claude in Chrome works with the Chrome extension to let you control your browser directly from Claude Code.
          You can navigate websites, fill forms, capture screenshots, record GIFs, and debug with console logs and
          network requests.
          {!isExtensionInstalled && (
            <>
              <Newline />
              <Newline />
              Install the local extension package and Native Messaging host before continuing.
            </>
          )}
        </Text>

        <Text dimColor>
          Site-level permissions are inherited from the Chrome extension. Manage permissions in the Chrome extension
          settings to control which sites Claude can browse, click, and type on
          .
        </Text>
        <Text dimColor>
          For more info, use{' '}
          <Text bold color="chromeYellow">
            /chrome
          </Text>{' '}
          to inspect the local connection.
        </Text>
      </Box>
    </Dialog>
  );
}
