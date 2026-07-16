import { feature } from 'bun:bundle';
import { spawnSync } from 'child_process';
import { useCallback, useState } from 'react';
import exit from '../../../commands/exit/index.js';
import { ExitFlow } from '../../../components/ExitFlow.js';
import { isBgSession } from '../../../utils/concurrentSessions.js';
import { getCurrentWorktreeSession } from '../../../utils/worktree.js';

export function useExitInteraction() {
  const [exitFlow, setExitFlow] = useState<React.ReactNode>(null);
  const [isExiting, setIsExiting] = useState(false);

  const handleExit = useCallback(async () => {
    setIsExiting(true);
    if (feature('BG_SESSIONS') && isBgSession()) {
      spawnSync('tmux', ['detach-client'], { stdio: 'ignore' });
      setIsExiting(false);
      return;
    }
    if (getCurrentWorktreeSession() !== null) {
      setExitFlow(
        <ExitFlow
          showWorktree
          onDone={() => {}}
          onCancel={() => {
            setExitFlow(null);
            setIsExiting(false);
          }}
        />,
      );
      return;
    }
    const exitModule = await exit.load();
    const result = await exitModule.call(() => {});
    setExitFlow(result);
    if (result === null) setIsExiting(false);
  }, []);

  return { exitFlow, isExiting, handleExit };
}
