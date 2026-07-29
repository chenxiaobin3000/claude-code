import React from 'react'
import { getOriginalCwd } from '../../bootstrap/state.js'
import type {
  LocalJSXCommandContext,
  LocalJSXCommandOnDone,
} from '../../types/command.js'
import { createNamedSessionFork } from '../branch/branch.js'

export async function call(
  onDone: LocalJSXCommandOnDone,
  _context: LocalJSXCommandContext,
  args: string,
): Promise<React.ReactNode> {
  const directive = args.trim()
  if (!directive) {
    onDone('Usage: /fork <directive>', { display: 'system' })
    return null
  }

  try {
    const fork = await createNamedSessionFork(directive.slice(0, 80))
    const { startBackgroundSession } = await import('../../cli/bg.js')
    const background = await startBackgroundSession(
      [
        directive,
        '--print',
        '--resume',
        fork.sessionId,
        '--name',
        fork.effectiveTitle,
      ],
      {
        cwd: getOriginalCwd(),
        sessionName: `claude-fork-${fork.sessionId.slice(0, 8)}`,
      },
    )

    onDone(
      [
        `Forked background session started: ${fork.effectiveTitle}`,
        `Session ID: ${fork.sessionId}`,
        `Process: ${background.sessionName}`,
        `Log: ${background.logPath}`,
        `Status: claude daemon status`,
        `Attach: claude daemon attach ${fork.sessionId}`,
        `Stop: claude daemon kill ${fork.sessionId}`,
      ].join('\n'),
      { display: 'system' },
    )
  } catch (error) {
    onDone(
      `Fork failed: ${error instanceof Error ? error.message : String(error)}`,
      { display: 'system' },
    )
  }
  return null
}
