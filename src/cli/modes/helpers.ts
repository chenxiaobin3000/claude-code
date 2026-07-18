import { SHOW_CURSOR } from '@anthropic/ink'
import { feature } from 'bun:bundle'

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
import { relative } from 'path'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from 'src/services/analytics/index.js'
import {
  isBareMode,
  isEnvTruthy,
  isInProtectedNamespace,
} from '../../utils/envUtils.js'
import { findGitRoot } from '../../utils/git.js'
import { logError } from '../../utils/log.js'
import { getInitialSettings } from '../../utils/settings/settings.js'
import { getCwd } from 'src/utils/cwd.js'
import { setUserMsgOptIn } from '../../bootstrap/state.js'

/* eslint-disable @typescript-eslint/no-require-imports */
const autoModeStateModule = feature('TRANSCRIPT_CLASSIFIER')
  ? (require('../../utils/permissions/autoModeState.js') as typeof import('../../utils/permissions/autoModeState.js'))
  : null

import { type ThinkingConfig } from '../../utils/thinking.js'

export async function logTenguInit({
  hasInitialPrompt,
  hasStdin,
  verbose,
  debug,
  debugToStderr,
  print,
  outputFormat,
  inputFormat,
  numAllowedTools,
  numDisallowedTools,
  mcpClientCount,
  worktreeEnabled,
  skipWebFetchPreflight,
  githubActionInputs,
  dangerouslySkipPermissionsPassed,
  permissionMode,
  modeIsBypass,
  allowDangerouslySkipPermissionsPassed,
  systemPromptFlag,
  appendSystemPromptFlag,
  thinkingConfig,
  assistantActivationPath,
}: {
  hasInitialPrompt: boolean
  hasStdin: boolean
  verbose: boolean
  debug: boolean
  debugToStderr: boolean
  print: boolean
  outputFormat: string
  inputFormat: string
  numAllowedTools: number
  numDisallowedTools: number
  mcpClientCount: number
  worktreeEnabled: boolean
  skipWebFetchPreflight: boolean | undefined
  githubActionInputs: string | undefined
  dangerouslySkipPermissionsPassed: boolean
  permissionMode: string
  modeIsBypass: boolean
  allowDangerouslySkipPermissionsPassed: boolean
  systemPromptFlag: 'file' | 'flag' | undefined
  appendSystemPromptFlag: 'file' | 'flag' | undefined
  thinkingConfig: ThinkingConfig
  assistantActivationPath: string | undefined
}): Promise<void> {
  try {
    logEvent('tengu_init', {
      entrypoint:
        'claude' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      hasInitialPrompt,
      hasStdin,
      verbose,
      debug,
      debugToStderr,
      print,
      outputFormat:
        outputFormat as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      inputFormat:
        inputFormat as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      numAllowedTools,
      numDisallowedTools,
      mcpClientCount,
      worktree: worktreeEnabled,
      skipWebFetchPreflight,
      ...(githubActionInputs && {
        githubActionInputs:
          githubActionInputs as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      }),
      dangerouslySkipPermissionsPassed,
      permissionMode:
        permissionMode as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      modeIsBypass,
      inProtectedNamespace: isInProtectedNamespace(),
      allowDangerouslySkipPermissionsPassed,
      thinkingType:
        thinkingConfig.type as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      ...(thinkingConfig.type === 'enabled' && {
        thinkingBudgetTokens: thinkingConfig.budgetTokens,
      }),
      ...(systemPromptFlag && {
        systemPromptFlag:
          systemPromptFlag as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      }),
      ...(appendSystemPromptFlag && {
        appendSystemPromptFlag:
          appendSystemPromptFlag as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      }),
      is_simple: isBareMode() || undefined,
      is_coordinator:
        feature('COORDINATOR_MODE') &&
        coordinatorModeModule?.isCoordinatorMode()
          ? true
          : undefined,
      ...(assistantActivationPath && {
        assistantActivationPath:
          assistantActivationPath as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      }),
      ...(process.env.USER_TYPE === 'ant'
        ? (() => {
            const cwd = getCwd()
            const gitRoot = findGitRoot(cwd)
            const rp = gitRoot ? relative(gitRoot, cwd) || '.' : undefined
            return rp
              ? {
                  relativeProjectPath:
                    rp as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                }
              : {}
          })()
        : {}),
    })
  } catch (error) {
    logError(error)
  }
}

export function maybeActivateProactive(options: unknown): void {
  if (
    (feature('PROACTIVE') || feature('KAIROS')) &&
    ((options as { proactive?: boolean }).proactive ||
      isEnvTruthy(process.env.CLAUDE_CODE_PROACTIVE))
  ) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const proactiveModule = require('../../proactive/index.js')
    if (!proactiveModule.isProactiveActive()) {
      proactiveModule.activateProactive('command')
    }
  }
}

export function maybeActivateBrief(options: unknown): void {
  if (!(feature('KAIROS') || feature('KAIROS_BRIEF'))) return
  const briefFlag = (options as { brief?: boolean }).brief
  const briefEnv = isEnvTruthy(process.env.CLAUDE_CODE_BRIEF)
  if (!briefFlag && !briefEnv) return
  // --brief / CLAUDE_CODE_BRIEF are explicit opt-ins: check entitlement,
  // then set userMsgOptIn to activate the tool + prompt section. The env
  // var also grants entitlement (isBriefEntitled() reads it), so setting
  // CLAUDE_CODE_BRIEF=1 alone force-enables for dev/testing — no GB gate
  // needed. initialIsBriefOnly reads getUserMsgOptIn() directly.
  // Conditional require: static import would leak the tool name string
  // into external builds via BriefTool.ts → prompt.ts.
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { isBriefEntitled } =
    require('@claude-code-best/builtin-tools/tools/BriefTool/BriefTool.js') as typeof import('@claude-code-best/builtin-tools/tools/BriefTool/BriefTool.js')
  /* eslint-enable @typescript-eslint/no-require-imports */
  const entitled = isBriefEntitled()
  if (entitled) {
    setUserMsgOptIn(true)
  }
  // Fire unconditionally once intent is seen: enabled=false captures the
  // "user tried but was gated" failure mode in Datadog.
  logEvent('tengu_brief_mode_enabled', {
    enabled: entitled,
    gated: !entitled,
    source: (briefEnv
      ? 'env'
      : 'flag') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  })
}

export function resetCursor(): void {
  const terminal = process.stderr.isTTY
    ? process.stderr
    : process.stdout.isTTY
      ? process.stdout
      : undefined
  terminal?.write(SHOW_CURSOR)
}

type TeammateOptions = {
  agentId?: string
  agentName?: string
  teamName?: string
  agentColor?: string
  planModeRequired?: boolean
  parentSessionId?: string
  teammateMode?: 'auto' | 'tmux' | 'in-process'
  agentType?: string
}

export function extractTeammateOptions(options: unknown): TeammateOptions {
  if (typeof options !== 'object' || options === null) {
    return {}
  }
  const opts = options as Record<string, unknown>
  const teammateMode = opts.teammateMode
  return {
    agentId: typeof opts.agentId === 'string' ? opts.agentId : undefined,
    agentName: typeof opts.agentName === 'string' ? opts.agentName : undefined,
    teamName: typeof opts.teamName === 'string' ? opts.teamName : undefined,
    agentColor:
      typeof opts.agentColor === 'string' ? opts.agentColor : undefined,
    planModeRequired:
      typeof opts.planModeRequired === 'boolean'
        ? opts.planModeRequired
        : undefined,
    parentSessionId:
      typeof opts.parentSessionId === 'string'
        ? opts.parentSessionId
        : undefined,
    teammateMode:
      teammateMode === 'auto' ||
      teammateMode === 'tmux' ||
      teammateMode === 'in-process'
        ? teammateMode
        : undefined,
    agentType: typeof opts.agentType === 'string' ? opts.agentType : undefined,
  }
}
