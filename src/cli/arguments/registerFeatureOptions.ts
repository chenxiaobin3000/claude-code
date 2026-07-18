import { Option } from '@commander-js/extra-typings'
import { feature } from 'bun:bundle'
import { canUserConfigureAdvisor } from '../../utils/advisor.js'

export function registerFeatureOptions(program: any): void {
  // Worktree flags
  program.option(
    '-w, --worktree [name]',
    'Create a new git worktree for this session (optionally specify a name)',
  )
  program.option(
    '--tmux',
    'Create a tmux session for the worktree (requires --worktree). Uses iTerm2 native panes when available; use --tmux=classic for traditional tmux.',
  )

  if (canUserConfigureAdvisor()) {
    program.addOption(
      new Option(
        '--advisor <model>',
        'Enable the server-side advisor tool with the specified model (alias or full ID).',
      ).hideHelp(),
    )
  }

  if (process.env.USER_TYPE === 'ant') {
    program.addOption(
      new Option(
        '--delegate-permissions',
        '[ANT-ONLY] Alias for --permission-mode auto.',
      ).implies({
        permissionMode: 'auto',
      }),
    )
    program.addOption(
      new Option(
        '--dangerously-skip-permissions-with-classifiers',
        '[ANT-ONLY] Deprecated alias for --permission-mode auto.',
      )
        .hideHelp()
        .implies({ permissionMode: 'auto' }),
    )
    program.addOption(
      new Option(
        '--afk',
        '[ANT-ONLY] Deprecated alias for --permission-mode auto.',
      )
        .hideHelp()
        .implies({ permissionMode: 'auto' }),
    )
    program.addOption(
      new Option(
        '--tasks [id]',
        '[ANT-ONLY] Tasks mode: watch for tasks and auto-process them. Optional id is used as both the task list ID and agent ID (defaults to "tasklist").',
      )
        .argParser(String)
        .hideHelp(),
    )
    program.option(
      '--agent-teams',
      '[ANT-ONLY] Force Claude to use multi-agent mode for solving problems',
      () => true,
    )
  }

  if (feature('TRANSCRIPT_CLASSIFIER')) {
    program.addOption(
      new Option('--enable-auto-mode', 'Opt in to auto mode').hideHelp(),
    )
  }

  if (feature('PROACTIVE') || feature('KAIROS')) {
    program.addOption(
      new Option('--proactive', 'Start in proactive autonomous mode'),
    )
  }

  if (feature('UDS_INBOX')) {
    program.addOption(
      new Option(
        '--messaging-socket-path <path>',
        'Unix domain socket path for the UDS messaging server (defaults to a tmp path)',
      ),
    )
  }

  if (feature('KAIROS') || feature('KAIROS_BRIEF')) {
    program.addOption(
      new Option(
        '--brief',
        'Enable SendUserMessage tool for agent-to-user communication',
      ),
    )
  }
  program.addOption(
    new Option(
      '--channels <servers...>',
      'MCP servers whose channel notifications (inbound push) should register this session. Space-separated server names.',
    ).hideHelp(),
  )
  program.addOption(
    new Option(
      '--dangerously-load-development-channels <servers...>',
      'Load channel servers not on the approved allowlist. For local channel development only. Shows a confirmation dialog at startup.',
    ).hideHelp(),
  )

  // Teammate identity options (set by leader when spawning tmux teammates)
  // These replace the CLAUDE_CODE_* environment variables
  program.addOption(
    new Option('--agent-id <id>', 'Teammate agent ID').hideHelp(),
  )
  program.addOption(
    new Option('--agent-name <name>', 'Teammate display name').hideHelp(),
  )
  program.addOption(
    new Option(
      '--team-name <name>',
      'Team name for swarm coordination',
    ).hideHelp(),
  )
  program.addOption(
    new Option('--agent-color <color>', 'Teammate UI color').hideHelp(),
  )
  program.addOption(
    new Option(
      '--plan-mode-required',
      'Require plan mode before implementation',
    ).hideHelp(),
  )
  program.addOption(
    new Option(
      '--parent-session-id <id>',
      'Parent session ID for analytics correlation',
    ).hideHelp(),
  )
  program.addOption(
    new Option(
      '--teammate-mode <mode>',
      'How to spawn teammates: "tmux", "in-process", or "auto"',
    )
      .choices(['auto', 'tmux', 'in-process'])
      .hideHelp(),
  )
  program.addOption(
    new Option(
      '--agent-type <type>',
      'Custom agent type for this teammate',
    ).hideHelp(),
  )

  // Enable SDK URL for all builds but hide from help
  program.addOption(
    new Option(
      '--sdk-url <url>',
      'Use remote WebSocket endpoint for SDK I/O streaming (only with -p and stream-json format)',
    ).hideHelp(),
  )

  if (feature('HARD_FAIL')) {
    program.addOption(
      new Option(
        '--hard-fail',
        'Crash on logError calls instead of silently logging',
      ).hideHelp(),
    )
  }
}
