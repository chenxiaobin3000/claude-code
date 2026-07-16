import { feature } from 'bun:bundle'
import { profileCheckpoint } from '../../utils/startupProfiler.js'
import { stopCapturingEarlyInput } from '../../utils/earlyInput.js'
import { initializeWarningHandler } from '../../utils/warningHandler.js'

// Lazy require to avoid circular dependency: teammate.ts -> AppState.tsx -> ... -> main.tsx
/* eslint-disable @typescript-eslint/no-require-imports */
const getTeammateUtils = () =>
  require('../../utils/teammate.js') as typeof import('../../utils/teammate.js')
const getTeammatePromptAddendum = () =>
  require('../../utils/swarm/teammatePromptAddendum.js') as typeof import('../../utils/swarm/teammatePromptAddendum.js')
const getTeammateModeSnapshot = () =>
  require('../../utils/swarm/backends/teammateModeSnapshot.js') as typeof import('../../utils/swarm/backends/teammateModeSnapshot.js')
/* eslint-enable @typescript-eslint/no-require-imports */
// Dead code elimination: conditional import for COORDINATOR_MODE
/* eslint-disable @typescript-eslint/no-require-imports */
const coordinatorModeModule = feature('COORDINATOR_MODE')
  ? (require('../../coordinator/coordinatorMode.js') as typeof import('../../coordinator/coordinatorMode.js'))
  : null
/* eslint-enable @typescript-eslint/no-require-imports */
// Dead code elimination: conditional import for KAIROS (assistant mode)
/* eslint-disable @typescript-eslint/no-require-imports */
const assistantModule = feature('KAIROS')
  ? (require('../../assistant/index.js') as typeof import('../../assistant/index.js'))
  : null
const kairosGate = feature('KAIROS')
  ? (require('../../assistant/gate.js') as typeof import('../../assistant/gate.js'))
  : null

import { isEnvTruthy } from '../../utils/envUtils.js'
import { gracefulShutdownSync } from 'src/utils/gracefulShutdown.js'
import {
  setClientType,
  setIsInteractive,
  setQuestionPreviewFormat,
  setSessionSource,
} from '../../bootstrap/state.js'

/* eslint-disable @typescript-eslint/no-require-imports */
const autoModeStateModule = feature('TRANSCRIPT_CLASSIFIER')
  ? (require('../../utils/permissions/autoModeState.js') as typeof import('../../utils/permissions/autoModeState.js'))
  : null

import { resetCursor } from '../../cli/modes/helpers.js'
import { initializeEntrypoint } from '../../cli/startup/entrypoint.js'
import { eagerLoadSettings } from '../../cli/startup/settings.js'

export type PendingConnect = {
  url: string | undefined
  authToken: string | undefined
  dangerouslySkipPermissions: boolean
}
const _pendingConnect: PendingConnect | undefined = feature('DIRECT_CONNECT')
  ? {
      url: undefined,
      authToken: undefined,
      dangerouslySkipPermissions: false,
    }
  : undefined

// Set by early argv processing when `claude assistant [sessionId]` is detected
export type PendingAssistantChat = { sessionId?: string; discover: boolean }
const _pendingAssistantChat: PendingAssistantChat | undefined = feature(
  'KAIROS',
)
  ? { sessionId: undefined, discover: false }
  : undefined

// `claude ssh <host> [dir]` — parsed from argv early (same pattern as
// DIRECT_CONNECT above) so the main command path can pick it up and hand
// the REPL an SSH-backed session instead of a local one.
export type PendingSSH = {
  host: string | undefined
  cwd: string | undefined
  permissionMode: string | undefined
  dangerouslySkipPermissions: boolean
  /** --local: spawn the child CLI directly, skip ssh/probe/deploy. e2e test mode. */
  local: boolean
  /** Extra CLI args to forward to the remote CLI on initial spawn (--resume, -c). */
  extraCliArgs: string[]
  remoteBin: string | undefined
}
export function isSshRemoteEnabled(): boolean {
  return false
}
const _pendingSSH: PendingSSH = {
  host: undefined,
  cwd: undefined,
  permissionMode: undefined,
  dangerouslySkipPermissions: false,
  local: false,
  extraCliArgs: [],
  remoteBin: undefined,
}

export const startupRuntimeState = {
  pendingConnect: _pendingConnect,
  pendingAssistantChat: _pendingAssistantChat,
  pendingSSH: _pendingSSH,
}

export async function executeStartup(runProgram: () => Promise<unknown>) {
  profileCheckpoint('main_function_start')

  // SECURITY: Prevent Windows from executing commands from current directory
  // This must be set before ANY command execution to prevent PATH hijacking attacks
  // See: https://docs.microsoft.com/en-us/windows/win32/api/processenv/nf-processenv-searchpathw
  process.env.NoDefaultCurrentDirectoryInExePath = '1'

  // Initialize warning handler early to catch warnings
  initializeWarningHandler()

  process.on('exit', () => {
    resetCursor()
    // 杀掉所有 running workflow，避免孤儿 task 留在 AppState 里
    try {
      const { peekWorkflowService } = require('../../workflow/service.js') as {
        peekWorkflowService: () => { shutdown: () => void } | null
      }
      peekWorkflowService()?.shutdown()
    } catch {
      // workflow 未启用或已卸载——忽略
    }
  })
  process.on('SIGINT', () => {
    // In print mode, print.ts registers its own SIGINT handler that aborts
    // the in-flight query and calls gracefulShutdown; skip here to avoid
    // preempting it with a synchronous process.exit().
    if (process.argv.includes('-p') || process.argv.includes('--print')) {
      return
    }
    process.exit(0)
  })
  profileCheckpoint('main_warning_handler_initialized')

  // Check for cc:// or cc+unix:// URL in argv — rewrite so the main command
  // handles it, giving the full interactive TUI instead of a stripped-down subcommand.
  // For headless (-p), we rewrite to the internal `open` subcommand.
  if (feature('DIRECT_CONNECT')) {
    const rawCliArgs = process.argv.slice(2)
    const ccIdx = rawCliArgs.findIndex(
      a => a.startsWith('cc://') || a.startsWith('cc+unix://'),
    )
    if (ccIdx !== -1 && _pendingConnect) {
      const ccUrl = rawCliArgs[ccIdx]!
      const { parseConnectUrl } = await import(
        '../../server/parseConnectUrl.js'
      )
      const parsed = parseConnectUrl(ccUrl)
      _pendingConnect.dangerouslySkipPermissions = rawCliArgs.includes(
        '--dangerously-skip-permissions',
      )

      if (rawCliArgs.includes('-p') || rawCliArgs.includes('--print')) {
        // Headless: rewrite to internal `open` subcommand
        const stripped = rawCliArgs.filter((_, i) => i !== ccIdx)
        const dspIdx = stripped.indexOf('--dangerously-skip-permissions')
        if (dspIdx !== -1) {
          stripped.splice(dspIdx, 1)
        }
        process.argv = [
          process.argv[0]!,
          process.argv[1]!,
          'open',
          ccUrl,
          ...stripped,
        ]
      } else {
        // Interactive: strip cc:// URL and flags, run main command
        _pendingConnect.url = parsed.serverUrl
        _pendingConnect.authToken = parsed.authToken
        const stripped = rawCliArgs.filter((_, i) => i !== ccIdx)
        const dspIdx = stripped.indexOf('--dangerously-skip-permissions')
        if (dspIdx !== -1) {
          stripped.splice(dspIdx, 1)
        }
        process.argv = [process.argv[0]!, process.argv[1]!, ...stripped]
      }
    }
  }

  // Handle deep link URIs early — this is invoked by the OS protocol handler
  // and should bail out before full init since it only needs to parse the URI
  // and open a terminal.
  if (feature('LODESTONE')) {
    const handleUriIdx = process.argv.indexOf('--handle-uri')
    if (handleUriIdx !== -1 && process.argv[handleUriIdx + 1]) {
      const { enableConfigs } = await import('../../utils/config.js')
      enableConfigs()
      const uri = process.argv[handleUriIdx + 1]!
      const { handleDeepLinkUri } = await import(
        '../../utils/deepLink/protocolHandler.js'
      )
      const exitCode = await handleDeepLinkUri(uri)
      process.exit(exitCode)
    }

    // macOS URL handler: when LaunchServices launches our .app bundle, the
    // URL arrives via Apple Event (not argv). LaunchServices overwrites
    // __CFBundleIdentifier to the launching bundle's ID, which is a precise
    // positive signal — cheaper than importing and guessing with heuristics.
    if (
      process.platform === 'darwin' &&
      process.env.__CFBundleIdentifier ===
        'com.anthropic.claude-code-url-handler'
    ) {
      const { enableConfigs } = await import('../../utils/config.js')
      enableConfigs()
      const { handleUrlSchemeLaunch } = await import(
        '../../utils/deepLink/protocolHandler.js'
      )
      const urlSchemeResult = await handleUrlSchemeLaunch()
      process.exit(urlSchemeResult ?? 1)
    }
  }

  // `claude assistant [sessionId]` — stash and strip so the main
  // command handles it, giving the full interactive TUI. Position-0 only
  // (matching the ssh pattern below) — indexOf would false-positive on
  // `claude -p "explain assistant"`. Root-flag-before-subcommand
  // (e.g. `--debug assistant`) falls through to the stub, which
  // prints usage.
  if (feature('KAIROS') && _pendingAssistantChat) {
    const rawArgs = process.argv.slice(2)
    if (rawArgs[0] === 'assistant') {
      const nextArg = rawArgs[1]
      if (nextArg && !nextArg.startsWith('-')) {
        _pendingAssistantChat.sessionId = nextArg
        rawArgs.splice(0, 2) // drop 'assistant' and sessionId
        process.argv = [process.argv[0]!, process.argv[1]!, ...rawArgs]
      } else if (!nextArg) {
        _pendingAssistantChat.discover = true
        rawArgs.splice(0, 1) // drop 'assistant'
        process.argv = [process.argv[0]!, process.argv[1]!, ...rawArgs]
      }
      // else: `claude assistant --help` → fall through to stub
    }
  }

  // `claude ssh <host> [dir]` — strip from argv so the main command handler
  // runs (full interactive TUI), stash the host/dir for the REPL branch at
  // ~line 3720 to pick up. Headless (-p) mode not supported in v1: SSH
  // sessions need the local REPL to drive them (interrupt, permissions).
  if (isSshRemoteEnabled() && _pendingSSH) {
    const rawCliArgs = process.argv.slice(2)
    // SSH-specific flags can appear before the host positional (e.g.
    // `ssh --permission-mode auto host /tmp` — standard POSIX flags-before-
    // positionals). Pull them all out BEFORE checking whether a host was
    // given, so `claude ssh --permission-mode auto host` and `claude ssh host
    // --permission-mode auto` are equivalent. The host check below only needs
    // to guard against `-h`/`--help` (which commander should handle).
    if (rawCliArgs[0] === 'ssh') {
      const localIdx = rawCliArgs.indexOf('--local')
      if (localIdx !== -1) {
        _pendingSSH.local = true
        rawCliArgs.splice(localIdx, 1)
      }
      const dspIdx = rawCliArgs.indexOf('--dangerously-skip-permissions')
      if (dspIdx !== -1) {
        _pendingSSH.dangerouslySkipPermissions = true
        rawCliArgs.splice(dspIdx, 1)
      }
      const pmIdx = rawCliArgs.indexOf('--permission-mode')
      if (
        pmIdx !== -1 &&
        rawCliArgs[pmIdx + 1] &&
        !rawCliArgs[pmIdx + 1]!.startsWith('-')
      ) {
        _pendingSSH.permissionMode = rawCliArgs[pmIdx + 1]
        rawCliArgs.splice(pmIdx, 2)
      }
      const pmEqIdx = rawCliArgs.findIndex(a =>
        a.startsWith('--permission-mode='),
      )
      if (pmEqIdx !== -1) {
        _pendingSSH.permissionMode = rawCliArgs[pmEqIdx]!.split('=')[1]
        rawCliArgs.splice(pmEqIdx, 1)
      }
      // Forward session-resume + model flags to the remote CLI's initial spawn.
      // --continue/-c and --resume <uuid> operate on the REMOTE session history
      // (which persists under the remote's ~/.claude/projects/<cwd>/).
      // --model controls which model the remote uses.
      const extractFlag = (
        flag: string,
        opts: { hasValue?: boolean; as?: string } = {},
      ) => {
        const i = rawCliArgs.indexOf(flag)
        if (i !== -1) {
          _pendingSSH.extraCliArgs.push(opts.as ?? flag)
          const val = rawCliArgs[i + 1]
          if (opts.hasValue && val && !val.startsWith('-')) {
            _pendingSSH.extraCliArgs.push(val)
            rawCliArgs.splice(i, 2)
          } else {
            rawCliArgs.splice(i, 1)
          }
        }
        const eqI = rawCliArgs.findIndex(a => a.startsWith(`${flag}=`))
        if (eqI !== -1) {
          _pendingSSH.extraCliArgs.push(
            opts.as ?? flag,
            rawCliArgs[eqI]!.slice(flag.length + 1),
          )
          rawCliArgs.splice(eqI, 1)
        }
      }
      const rbIdx = rawCliArgs.indexOf('--remote-bin')
      if (
        rbIdx !== -1 &&
        rawCliArgs[rbIdx + 1] &&
        !rawCliArgs[rbIdx + 1]!.startsWith('-')
      ) {
        _pendingSSH.remoteBin = rawCliArgs[rbIdx + 1]
        rawCliArgs.splice(rbIdx, 2)
      }
      const rbEqIdx = rawCliArgs.findIndex(a => a.startsWith('--remote-bin='))
      if (rbEqIdx !== -1) {
        _pendingSSH.remoteBin = rawCliArgs[rbEqIdx]!.split('=')
          .slice(1)
          .join('=')
        rawCliArgs.splice(rbEqIdx, 1)
      }

      extractFlag('-c', { as: '--continue' })
      extractFlag('--continue')
      extractFlag('--resume', { hasValue: true })
      extractFlag('--model', { hasValue: true })
    }
    // After pre-extraction, any remaining dash-arg at [1] is either -h/--help
    // (commander handles) or an unknown-to-ssh flag (fall through to commander
    // so it surfaces a proper error). Only a non-dash arg is the host.
    if (
      rawCliArgs[0] === 'ssh' &&
      rawCliArgs[1] &&
      !rawCliArgs[1].startsWith('-')
    ) {
      _pendingSSH.host = rawCliArgs[1]
      // Optional positional cwd.
      let consumed = 2
      if (rawCliArgs[2] && !rawCliArgs[2].startsWith('-')) {
        _pendingSSH.cwd = rawCliArgs[2]
        consumed = 3
      }
      const rest = rawCliArgs.slice(consumed)

      // Headless (-p) mode is not supported with SSH in v1 — reject early
      // so the flag doesn't silently cause local execution.
      if (rest.includes('-p') || rest.includes('--print')) {
        process.stderr.write(
          'Error: headless (-p/--print) mode is not supported with claude ssh\n',
        )
        gracefulShutdownSync(1)
        return
      }

      // Rewrite argv so the main command sees remaining flags but not `ssh`.
      process.argv = [process.argv[0]!, process.argv[1]!, ...rest]
    }
  }

  // Check for -p/--print and --init-only flags early to set isInteractiveSession before init()
  // This is needed because telemetry initialization calls auth functions that need this flag
  const cliArgs = process.argv.slice(2)
  const hasPrintFlag = cliArgs.includes('-p') || cliArgs.includes('--print')
  const hasInitOnlyFlag = cliArgs.includes('--init-only')
  const hasSdkUrl = cliArgs.some(arg => arg.startsWith('--sdk-url'))
  const forceInteractive = isEnvTruthy(
    process.env.CLAUDE_CODE_FORCE_INTERACTIVE,
  )
  const isNonInteractive =
    hasPrintFlag ||
    hasInitOnlyFlag ||
    hasSdkUrl ||
    (!forceInteractive && !process.stdout.isTTY)

  // Stop capturing early input for non-interactive modes
  if (isNonInteractive) {
    stopCapturingEarlyInput()
  }

  // Set simplified tracking fields
  const isInteractive = !isNonInteractive
  setIsInteractive(isInteractive)

  // Initialize entrypoint based on mode - needs to be set before any event is logged
  initializeEntrypoint(isNonInteractive)

  // Determine client type
  const clientType = (() => {
    if (isEnvTruthy(process.env.GITHUB_ACTIONS)) return 'github-action'
    if (process.env.CLAUDE_CODE_ENTRYPOINT === 'sdk-ts') return 'sdk-typescript'
    if (process.env.CLAUDE_CODE_ENTRYPOINT === 'sdk-py') return 'sdk-python'
    if (process.env.CLAUDE_CODE_ENTRYPOINT === 'sdk-cli') return 'sdk-cli'
    if (process.env.CLAUDE_CODE_ENTRYPOINT === 'claude-vscode')
      return 'claude-vscode'
    if (process.env.CLAUDE_CODE_ENTRYPOINT === 'local-agent')
      return 'local-agent'
    if (process.env.CLAUDE_CODE_ENTRYPOINT === 'claude-desktop')
      return 'claude-desktop'

    // Check if session-ingress token is provided (indicates remote session)
    const hasSessionIngressToken =
      process.env.CLAUDE_CODE_SESSION_ACCESS_TOKEN ||
      process.env.CLAUDE_CODE_WEBSOCKET_AUTH_FILE_DESCRIPTOR
    if (
      process.env.CLAUDE_CODE_ENTRYPOINT === 'remote' ||
      hasSessionIngressToken
    ) {
      return 'remote'
    }

    return 'cli'
  })()
  setClientType(clientType)

  const previewFormat = process.env.CLAUDE_CODE_QUESTION_PREVIEW_FORMAT
  if (previewFormat === 'markdown' || previewFormat === 'html') {
    setQuestionPreviewFormat(previewFormat)
  } else if (
    !clientType.startsWith('sdk-') &&
    // Desktop and CCR pass previewFormat via toolConfig; when the feature is
    // gated off they pass undefined — don't override that with markdown.
    clientType !== 'claude-desktop' &&
    clientType !== 'local-agent' &&
    clientType !== 'remote'
  ) {
    setQuestionPreviewFormat('markdown')
  }

  // Tag sessions created via `claude remote-control` so the backend can identify them
  if (process.env.CLAUDE_CODE_ENVIRONMENT_KIND === 'bridge') {
    setSessionSource('remote-control')
  }

  profileCheckpoint('main_client_type_determined')

  // Parse and load settings flags early, before init()
  eagerLoadSettings()

  profileCheckpoint('main_before_run')

  await runProgram()
  profileCheckpoint('main_after_run')
}
