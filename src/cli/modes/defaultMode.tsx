import { feature } from 'bun:bundle';
import chalk from 'chalk';
import { readFileSync } from 'fs';
import mapValues from 'lodash-es/mapValues.js';
import pickBy from 'lodash-es/pickBy.js';
import uniqBy from 'lodash-es/uniqBy.js';
import { getSystemContext, getUserContext } from '../../context.js';
import { addToHistory } from '../../history.js';
import type { Root } from '@anthropic/ink';
import { launchRepl } from '../../replLauncher.js';
import { hasGrowthBookEnvOverride, initializeGrowthBook } from '../../services/analytics/growthbook.js';
import type { McpSdkServerConfig, McpServerConfig, ScopedMcpServerConfig } from '../../services/mcp/types.js';
import type { ToolInputJSONSchema } from '../../Tool.js';
import {
  createSyntheticOutputTool,
  isSyntheticOutputToolEnabled,
} from '@claude-code-best/builtin-tools/tools/SyntheticOutputTool/SyntheticOutputTool.js';
import { getTools } from '../../tools.js';
import {
  canUserConfigureAdvisor,
  getInitialAdvisorSetting,
  isAdvisorEnabled,
  isValidAdvisorModel,
  modelSupportsAdvisor,
} from '../../utils/advisor.js';
import { isAgentSwarmsEnabled } from '../../utils/agentSwarmsEnabled.js';
import { count, uniq } from '../../utils/array.js';
import { installAsciicastRecorder } from '../../utils/asciicast.js';
import {
  checkHasTrustDialogAccepted,
  getGlobalConfig,
  saveGlobalConfig,
} from '../../utils/config.js';
import { seedEarlyInput } from '../../utils/earlyInput.js';
import { getInitialEffortSetting, parseEffortValue } from '../../utils/effort.js';
import {
  getInitialFastModeSetting,
  isFastModeEnabled,
  prefetchFastModeStatus,
  resolveFastModeStatusFromCache,
} from '../../utils/fastMode.js';
import { applyConfigEnvironmentVariables } from '../../utils/managedEnv.js';
import { createSystemMessage, createUserMessage } from '../../utils/messages.js';
import { getPlatform } from '../../utils/platform.js';
import { jsonParse } from '../../utils/slowOperations.js';
import { computeInitialTeamContext } from '../../utils/swarm/reconnection.js';
import { isWorktreeModeEnabled } from '../../utils/worktreeModeEnabled.js';

// Lazy require to avoid circular dependency: teammate.ts -> AppState.tsx -> ... -> main.tsx
/* eslint-disable @typescript-eslint/no-require-imports */
const getTeammateUtils = () => require('../../utils/teammate.js') as typeof import('../../utils/teammate.js');
const getTeammatePromptAddendum = () =>
  require('../../utils/swarm/teammatePromptAddendum.js') as typeof import('../../utils/swarm/teammatePromptAddendum.js');
const getTeammateModeSnapshot = () =>
  require('../../utils/swarm/backends/teammateModeSnapshot.js') as typeof import('../../utils/swarm/backends/teammateModeSnapshot.js');
/* eslint-enable @typescript-eslint/no-require-imports */
// Dead code elimination: conditional import for COORDINATOR_MODE
/* eslint-disable @typescript-eslint/no-require-imports */
const coordinatorModeModule = feature('COORDINATOR_MODE')
  ? (require('../../coordinator/coordinatorMode.js') as typeof import('../../coordinator/coordinatorMode.js'))
  : null;
/* eslint-enable @typescript-eslint/no-require-imports */
import { resolve } from 'path';
import { getFeatureValue_CACHED_MAY_BE_STALE } from 'src/services/analytics/growthbook.js';
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from 'src/services/analytics/index.js';
import {
  getOriginalCwd,
  setAdditionalDirectoriesForClaudeMd,
  setMainLoopModelOverride,
  setMainThreadAgentType,
} from '../../bootstrap/state.js';
import { getCommands } from '../../commands.js';
import type { StatsStore } from '../../context/stats.js';
import {
  launchInvalidSettingsDialog,
  launchResumeChooser,
  launchSnapshotUpdateDialog,
} from '../../dialogLaunchers.js';
import {
  exitWithError,
  exitWithMessage,
  getRenderContext,
  renderAndRun,
  showSetupScreens,
} from '../../interactiveHelpers.js';
import { initBuiltinPlugins } from '../../plugins/bundled/index.js';
/* eslint-enable @typescript-eslint/no-require-imports */
import { getMcpToolsCommandsAndResources, prefetchAllMcpResources } from '../../services/mcp/client.js';
import { initBundledSkills } from '../../skills/bundled/index.js';
import type { AgentColorName } from '@claude-code-best/builtin-tools/tools/AgentTool/agentColorManager.js';
import {
  getActiveAgentsFromList,
  getAgentDefinitionsWithOverrides,
  isBuiltInAgent,
  isCustomAgent,
  parseAgentsFromJson,
} from '@claude-code-best/builtin-tools/tools/AgentTool/loadAgentsDir.js';
import type { LogOption } from '../../types/logs.js';
import type { Message as MessageType } from '../../types/message.js';
import {
  CLAUDE_IN_CHROME_SKILL_HINT,
  CLAUDE_IN_CHROME_SKILL_HINT_WITH_WEBBROWSER,
} from '../../utils/claudeInChrome/prompt.js';
import {
  setupClaudeInChrome,
  shouldAutoEnableClaudeInChrome,
  shouldEnableClaudeInChrome,
} from '../../utils/claudeInChrome/setup.js';
import { loadConversationForResume } from '../../utils/conversationRecovery.js';
import { buildDeepLinkBanner } from '../../utils/deepLink/banner.js';
import { isBareMode, isEnvTruthy } from '../../utils/envUtils.js';
import { refreshExampleCommands } from '../../utils/exampleCommands.js';
import type { FpsMetrics } from '../../utils/fpsTracker.js';
import { getWorktreePaths } from '../../utils/getWorktreePaths.js';
import { getBranch } from '../../utils/git.js';
import { safeParseJSON } from '../../utils/json.js';
import { logError } from '../../utils/log.js';
import { getModelDeprecationWarning } from '../../utils/model/deprecation.js';
import {
  getDefaultMainLoopModel,
  getUserSpecifiedModelSetting,
  normalizeModelStringForAPI,
  parseUserSpecifiedModel,
} from '../../utils/model/model.js';
import { getModelRegistryError, isModelRegistryMissing } from '../../utils/model/modelRegistry.js';
import { ensureModelStringsInitialized } from '../../utils/model/modelStrings.js';
import {
  initializeToolPermissionContext,
  initialPermissionModeFromCLI,
  isDefaultPermissionModeAuto,
  parseToolListFromCLI,
  removeDangerousPermissions,
  stripDangerousPermissionsForAutoMode,
  verifyAutoModeGateAccess,
} from '../../utils/permissions/permissionSetup.js';
import { processSessionStartHooks, processSetupHooks } from '../../utils/sessionStart.js';
import {
  cacheSessionTitle,
  getSessionIdFromLog,
  loadTranscriptFromFile,
  saveAgentSetting,
  saveMode,
  searchSessionsByCustomTitle,
  sessionIdExists,
} from '../../utils/sessionStorage.js';
import { getInitialSettings, getSettingsWithErrors } from '../../utils/settings/settings.js';
import type { ValidationError } from '../../utils/settings/validation.js';
import { DEFAULT_TASKS_MODE_TASK_LIST_ID } from '../../utils/tasks.js';
import { validateUuid } from '../../utils/uuid.js';
// Plugin startup checks are now handled non-blockingly in REPL.tsx

import { logPermissionContextForAnts } from 'src/services/internalLogging.js';
import { clearServerCache } from 'src/services/mcp/client.js';
import {
  areMcpConfigsAllowedWithEnterpriseMcpConfig,
  doesEnterpriseMcpConfigExist,
  filterMcpServersByPolicy,
  getClaudeCodeMcpConfigs,
  getMcpServerSignature,
  parseMcpConfig,
  parseMcpConfigFromFilePath,
} from 'src/services/mcp/config.js';
import { excludeCommandsByServer, excludeResourcesByServer } from 'src/services/mcp/utils.js';
import { CLAUDE_IN_CHROME_MCP_SERVER_NAME, isClaudeInChromeMCPServer } from 'src/utils/claudeInChrome/common.js';
import { registerCleanup } from 'src/utils/cleanupRegistry.js';
import { createEmptyAttributionState } from 'src/utils/commitAttribution.js';
import { countConcurrentSessions, registerSession, updateSessionName } from 'src/utils/concurrentSessions.js';
import { getCwd } from 'src/utils/cwd.js';
import { logForDebugging, setHasFormattedOutput } from 'src/utils/debug.js';
import { errorMessage, getErrnoCode, isENOENT, toError } from 'src/utils/errors.js';
import { gracefulShutdown, gracefulShutdownSync } from 'src/utils/gracefulShutdown.js';
import { setAllHookEventsEnabled } from 'src/utils/hooks/hookEvents.js';
import { writeToStderr } from 'src/utils/process.js';
import { setCwd } from 'src/utils/Shell.js';
import { type ProcessedResume, processResumedConversation } from 'src/utils/sessionRestore.js';
import { plural } from 'src/utils/stringUtils.js';
import {
  type ChannelEntry,
  getInitialMainLoopModel,
  getIsNonInteractiveSession,
  getSessionId,
  getUserMsgOptIn,
  setAllowedChannels,
  setChromeFlagOverride,
  setCwdState,
  setDirectConnectServerUrl,
  setInitialMainLoopModel,
  setOriginalCwd,
  setSdkBetas,
  setSessionBypassPermissionsMode,
  setSessionPersistenceDisabled,
  setUserMsgOptIn,
  switchSession,
} from '../../bootstrap/state.js';

/* eslint-disable @typescript-eslint/no-require-imports */
const autoModeStateModule = feature('TRANSCRIPT_CLASSIFIER')
  ? (require('../../utils/permissions/autoModeState.js') as typeof import('../../utils/permissions/autoModeState.js'))
  : null;

import { startDeferredPrefetches } from '../../cli/initialization/deferredServices.js';
/* eslint-enable @typescript-eslint/no-require-imports */
// teleportWithProgress dynamically imported at call site
import { createDirectConnectSession, DirectConnectError } from '../../server/createDirectConnectSession.js';
import { initializeLspServerManager } from '../../services/lsp/manager.js';
import { shouldEnablePromptSuggestion } from '../../services/PromptSuggestion/promptSuggestion.js';
import { type AppState, getDefaultAppState, IDLE_SPECULATION_STATE } from '../../state/AppStateStore.js';
import { onChangeAppState } from '../../state/onChangeAppState.js';
import { createStore } from '../../state/store.js';
import { asSessionId } from '../../types/ids.js';
import { filterAllowedSdkBetas } from '../../utils/betas.js';
import { isInBundledMode } from '../../utils/bundledMode.js';
import { logForDiagnosticsNoPII } from '../../utils/diagLogs.js';
import { filterExistingPaths, getKnownPathsForRepo } from '../../utils/githubRepoPathMapping.js';
import { shouldEnableThinkingByDefault, type ThinkingConfig } from '../../utils/thinking.js';
import { getTmuxInstallInstructions, isTmuxAvailable, parsePRReference } from '../../utils/worktree.js';
import { profileCheckpoint } from '../../utils/startupProfiler.js';

export interface DefaultModeDependencies {
  pendingConnect: any;
  pendingSSH: any;
  isSshRemoteEnabled: () => boolean;
  getInputPrompt: (...args: any[]) => Promise<string | AsyncIterable<string>>;
  logTenguInit: (...args: any[]) => Promise<void>;
  maybeActivateProactive: (...args: any[]) => void;
  maybeActivateBrief: (...args: any[]) => void;
  extractTeammateOptions: (...args: any[]) => any;
}

type TeammateOptions = {
  agentId?: string;
  agentName?: string;
  teamName?: string;
  agentColor?: string;
  planModeRequired?: boolean;
  parentSessionId?: string;
  teammateMode?: string;
  agentType?: string;
};

export async function runDefaultMode(
  prompt: string | undefined,
  options: any,
  dependencies: DefaultModeDependencies,
): Promise<void> {
  const {
    pendingConnect: _pendingConnect,
    pendingSSH: _pendingSSH,
    isSshRemoteEnabled,
    getInputPrompt,
    logTenguInit,
    maybeActivateProactive,
    maybeActivateBrief,
    extractTeammateOptions,
  } = dependencies;
  profileCheckpoint('action_handler_start');

  // --bare = one-switch minimal mode. Sets SIMPLE so all the existing
  // gates fire (CLAUDE.md, skills, hooks inside executeHooks, agent
  // dir-walk). Must be set before setup() / any of the gated work runs.
  if ((options as { bare?: boolean }).bare) {
    process.env.CLAUDE_CODE_SIMPLE = '1';
  }

  // Ignore "code" as a prompt - treat it the same as no prompt
  if (prompt === 'code') {
    logEvent('tengu_code_prompt_ignored', {});
    console.warn(chalk.yellow('Tip: You can launch Claude Code with just `claude`'));
    prompt = undefined;
  }

  // Log event for any single-word prompt
  if (prompt && typeof prompt === 'string' && !/\s/.test(prompt) && prompt.length > 0) {
    logEvent('tengu_single_word_prompt', { length: prompt.length });
  }

  const {
    debug = false,
    debugToStderr = false,
    dangerouslySkipPermissions,
    allowDangerouslySkipPermissions = false,
    tools: baseTools = [],
    allowedTools = [],
    disallowedTools = [],
    mcpConfig = [],
    permissionMode: permissionModeCli,
    addDir = [],
    fallbackModel,
    betas = [],
    ide = false,
    sessionId,
    includeHookEvents,
    includePartialMessages,
  } = options;

  if (options.prefill) {
    seedEarlyInput(options.prefill);
  }

  const agentsJson = options.agents;
  const agentCli = options.agent;
  if (feature('BG_SESSIONS') && agentCli) {
    process.env.CLAUDE_CODE_AGENT = agentCli;
  }

  // NOTE: LSP manager initialization is intentionally deferred until after
  // the trust dialog is accepted. This prevents plugin LSP servers from
  // executing code in untrusted directories before user consent.

  // Extract these separately so they can be modified if needed
  let outputFormat = options.outputFormat;
  let inputFormat = options.inputFormat;
  let verbose = options.verbose ?? getGlobalConfig().verbose;
  let print = options.print;
  const init = options.init ?? false;
  const initOnly = options.initOnly ?? false;
  const maintenance = options.maintenance ?? false;

  // Extract disable slash commands flag
  const disableSlashCommands = options.disableSlashCommands || false;

  // Extract tasks mode options (ant-only)
  const tasksOption = process.env.USER_TYPE === 'ant' && (options as { tasks?: boolean | string }).tasks;
  const taskListId = tasksOption
    ? typeof tasksOption === 'string'
      ? tasksOption
      : DEFAULT_TASKS_MODE_TASK_LIST_ID
    : undefined;
  if (process.env.USER_TYPE === 'ant' && taskListId) {
    process.env.CLAUDE_CODE_TASK_LIST_ID = taskListId;
  }

  // Extract worktree option
  // worktree can be true (flag without value) or a string (custom name or PR reference)
  const worktreeOption = isWorktreeModeEnabled() ? (options as { worktree?: boolean | string }).worktree : undefined;
  let worktreeName = typeof worktreeOption === 'string' ? worktreeOption : undefined;
  const worktreeEnabled = worktreeOption !== undefined;

  // Check if worktree name is a PR reference (#N or GitHub PR URL)
  let worktreePRNumber: number | undefined;
  if (worktreeName) {
    const prNum = parsePRReference(worktreeName);
    if (prNum !== null) {
      worktreePRNumber = prNum;
      worktreeName = undefined; // slug will be generated in setup()
    }
  }

  // Extract tmux option (requires --worktree)
  const tmuxEnabled = isWorktreeModeEnabled() && (options as { tmux?: boolean }).tmux === true;

  // Validate tmux option
  if (tmuxEnabled) {
    if (!worktreeEnabled) {
      process.stderr.write(chalk.red('Error: --tmux requires --worktree\n'));
      process.exit(1);
    }
    if (getPlatform() === 'windows') {
      process.stderr.write(chalk.red('Error: --tmux is not supported on Windows\n'));
      process.exit(1);
    }
    if (!(await isTmuxAvailable())) {
      process.stderr.write(chalk.red(`Error: tmux is not installed.\n${getTmuxInstallInstructions()}\n`));
      process.exit(1);
    }
  }

  // Extract teammate options (for tmux-spawned agents)
  // Declared outside the if block so it's accessible later for system prompt addendum
  let storedTeammateOpts: TeammateOptions | undefined;
  if (isAgentSwarmsEnabled()) {
    // Extract agent identity options (for tmux-spawned agents)
    // These replace the CLAUDE_CODE_* environment variables
    const teammateOpts = extractTeammateOptions(options);
    storedTeammateOpts = teammateOpts;

    // If any teammate identity option is provided, all three required ones must be present
    const hasAnyTeammateOpt = teammateOpts.agentId || teammateOpts.agentName || teammateOpts.teamName;
    const hasAllRequiredTeammateOpts = teammateOpts.agentId && teammateOpts.agentName && teammateOpts.teamName;

    if (hasAnyTeammateOpt && !hasAllRequiredTeammateOpts) {
      process.stderr.write(
        chalk.red('Error: --agent-id, --agent-name, and --team-name must all be provided together\n'),
      );
      process.exit(1);
    }

    // If teammate identity is provided via CLI, set up dynamicTeamContext
    if (teammateOpts.agentId && teammateOpts.agentName && teammateOpts.teamName) {
      getTeammateUtils().setDynamicTeamContext?.({
        agentId: teammateOpts.agentId,
        agentName: teammateOpts.agentName,
        teamName: teammateOpts.teamName,
        color: teammateOpts.agentColor,
        planModeRequired: teammateOpts.planModeRequired ?? false,
        parentSessionId: teammateOpts.parentSessionId,
      });
    }

    // Set teammate mode CLI override if provided
    // This must be done before setup() captures the snapshot
    if (teammateOpts.teammateMode) {
      getTeammateModeSnapshot().setCliTeammateModeOverride?.(teammateOpts.teammateMode);
    }
  }

  // Extract remote sdk options
  const sdkUrl = (options as { sdkUrl?: string }).sdkUrl ?? undefined;

  // Allow env var to enable partial messages (used by sandbox gateway for baku)
  const effectiveIncludePartialMessages =
    includePartialMessages || isEnvTruthy(process.env.CLAUDE_CODE_INCLUDE_PARTIAL_MESSAGES);

  // Enable all hook event types when explicitly requested via SDK option
  // or when running in CLAUDE_CODE_REMOTE mode (CCR needs them).
  // Without this, only SessionStart and Setup events are emitted.
  if (includeHookEvents || isEnvTruthy(process.env.CLAUDE_CODE_REMOTE)) {
    setAllHookEventsEnabled(true);
  }

  // Auto-set input/output formats, verbose mode, and print mode when SDK URL is provided
  if (sdkUrl) {
    // If SDK URL is provided, automatically use stream-json formats unless explicitly set
    if (!inputFormat) {
      inputFormat = 'stream-json';
    }
    if (!outputFormat) {
      outputFormat = 'stream-json';
    }
    // Auto-enable verbose mode unless explicitly disabled or already set
    if (options.verbose === undefined) {
      verbose = true;
    }
    // Auto-enable print mode unless explicitly disabled
    if (!options.print) {
      print = true;
    }
  }

  // Validate session ID if provided
  if (sessionId) {
    // Check for conflicting flags
    // --session-id can be used with --continue or --resume when --fork-session is also provided
    // (to specify a custom ID for the forked session)
    if ((options.continue || options.resume) && !options.forkSession) {
      process.stderr.write(
        chalk.red(
          'Error: --session-id can only be used with --continue or --resume if --fork-session is also specified.\n',
        ),
      );
      process.exit(1);
    }

    // When --sdk-url is provided (bridge/remote mode), the session ID is a
    // server-assigned tagged ID (e.g. "session_local_01...") rather than a
    // UUID. Skip UUID validation and local existence checks in that case.
    if (!sdkUrl) {
      const validatedSessionId = validateUuid(sessionId);
      if (!validatedSessionId) {
        process.stderr.write(chalk.red('Error: Invalid session ID. Must be a valid UUID.\n'));
        process.exit(1);
      }

      // Check if session ID already exists
      if (sessionIdExists(validatedSessionId)) {
        process.stderr.write(chalk.red(`Error: Session ID ${validatedSessionId} is already in use.\n`));
        process.exit(1);
      }
    }
  }

  // Get isNonInteractiveSession from state (was set before init())
  const isNonInteractiveSession = getIsNonInteractiveSession();

  // Validate that fallback model is different from main model
  if (fallbackModel && options.model && fallbackModel === options.model) {
    process.stderr.write(
      chalk.red(
        'Error: Fallback model cannot be the same as the main model. Please specify a different model for --fallback-model.\n',
      ),
    );
    process.exit(1);
  }

  // Handle system prompt options
  let systemPrompt = options.systemPrompt;
  if (options.systemPromptFile) {
    if (options.systemPrompt) {
      process.stderr.write(
        chalk.red('Error: Cannot use both --system-prompt and --system-prompt-file. Please use only one.\n'),
      );
      process.exit(1);
    }

    try {
      const filePath = resolve(options.systemPromptFile);
      systemPrompt = readFileSync(filePath, 'utf8');
    } catch (error) {
      const code = getErrnoCode(error);
      if (code === 'ENOENT') {
        process.stderr.write(chalk.red(`Error: System prompt file not found: ${resolve(options.systemPromptFile)}\n`));
        process.exit(1);
      }
      process.stderr.write(chalk.red(`Error reading system prompt file: ${errorMessage(error)}\n`));
      process.exit(1);
    }
  }

  // Handle append system prompt options
  let appendSystemPrompt = options.appendSystemPrompt;
  if (options.appendSystemPromptFile) {
    if (options.appendSystemPrompt) {
      process.stderr.write(
        chalk.red(
          'Error: Cannot use both --append-system-prompt and --append-system-prompt-file. Please use only one.\n',
        ),
      );
      process.exit(1);
    }

    try {
      const filePath = resolve(options.appendSystemPromptFile);
      appendSystemPrompt = readFileSync(filePath, 'utf8');
    } catch (error) {
      const code = getErrnoCode(error);
      if (code === 'ENOENT') {
        process.stderr.write(
          chalk.red(`Error: Append system prompt file not found: ${resolve(options.appendSystemPromptFile)}\n`),
        );
        process.exit(1);
      }
      process.stderr.write(chalk.red(`Error reading append system prompt file: ${errorMessage(error)}\n`));
      process.exit(1);
    }
  }

  // Add teammate-specific system prompt addendum for tmux teammates
  if (
    isAgentSwarmsEnabled() &&
    storedTeammateOpts?.agentId &&
    storedTeammateOpts?.agentName &&
    storedTeammateOpts?.teamName
  ) {
    const addendum = getTeammatePromptAddendum().TEAMMATE_SYSTEM_PROMPT_ADDENDUM;
    appendSystemPrompt = appendSystemPrompt ? `${appendSystemPrompt}\n\n${addendum}` : addendum;
  }

  const { mode: permissionMode, notification: permissionModeNotification } = initialPermissionModeFromCLI({
    permissionModeCli,
    dangerouslySkipPermissions,
  });

  // Store session bypass permissions mode for trust dialog check
  setSessionBypassPermissionsMode(permissionMode === 'bypassPermissions');
  if (feature('TRANSCRIPT_CLASSIFIER')) {
    // autoModeFlagCli is the "did the user intend auto this session" signal.
    // Set when: --enable-auto-mode, --permission-mode auto, resolved mode
    // is auto, OR settings defaultMode is auto but the gate denied it
    // (permissionMode resolved to default with no explicit CLI override).
    // Used by verifyAutoModeGateAccess to decide whether to notify on
    // auto-unavailable, and by tengu_auto_mode_config opt-in carousel.
    if (
      (options as { enableAutoMode?: boolean }).enableAutoMode ||
      permissionModeCli === 'auto' ||
      permissionMode === 'auto' ||
      (!permissionModeCli && isDefaultPermissionModeAuto())
    ) {
      autoModeStateModule?.setAutoModeFlagCli(true);
    }
  }

  // Parse the MCP config files/strings if provided
  let dynamicMcpConfig: Record<string, ScopedMcpServerConfig> = {};

  if (mcpConfig && mcpConfig.length > 0) {
    // Process mcpConfig array
    const processedConfigs = mcpConfig
      .map((config: string) => config.trim())
      .filter((config: string) => config.length > 0);

    let allConfigs: Record<string, McpServerConfig> = {};
    const allErrors: ValidationError[] = [];

    for (const configItem of processedConfigs) {
      let configs: Record<string, McpServerConfig> | null = null;
      let errors: ValidationError[] = [];

      // First try to parse as JSON string
      const parsedJson = safeParseJSON(configItem);
      if (parsedJson) {
        const result = parseMcpConfig({
          configObject: parsedJson,
          filePath: 'command line',
          expandVars: true,
          scope: 'dynamic',
        });
        if (result.config) {
          configs = result.config.mcpServers;
        } else {
          errors = result.errors;
        }
      } else {
        // Try as file path
        const configPath = resolve(configItem);
        const result = parseMcpConfigFromFilePath({
          filePath: configPath,
          expandVars: true,
          scope: 'dynamic',
        });
        if (result.config) {
          configs = result.config.mcpServers;
        } else {
          errors = result.errors;
        }
      }

      if (errors.length > 0) {
        allErrors.push(...errors);
      } else if (configs) {
        // Merge configs, later ones override earlier ones
        allConfigs = { ...allConfigs, ...configs };
      }
    }

    if (allErrors.length > 0) {
      const formattedErrors = allErrors.map(err => `${err.path ? err.path + ': ' : ''}${err.message}`).join('\n');
      logForDebugging(`--mcp-config validation failed (${allErrors.length} errors): ${formattedErrors}`, {
        level: 'error',
      });
      process.stderr.write(`Error: Invalid MCP configuration:\n${formattedErrors}\n`);
      process.exit(1);
    }

    if (Object.keys(allConfigs).length > 0) {
      // SDK hosts (Nest/Desktop) own their server naming and may reuse
      // built-in names — skip reserved-name checks for type:'sdk'.
      const nonSdkConfigNames = Object.entries(allConfigs)
        .filter(([, config]) => config.type !== 'sdk')
        .map(([name]) => name);

      let reservedNameError: string | null = null;
      if (nonSdkConfigNames.some(isClaudeInChromeMCPServer)) {
        reservedNameError = `Invalid MCP configuration: "${CLAUDE_IN_CHROME_MCP_SERVER_NAME}" is a reserved MCP name.`;
      } else if (feature('CHICAGO_MCP')) {
        const { isComputerUseMCPServer, COMPUTER_USE_MCP_SERVER_NAME } = await import(
          'src/utils/computerUse/common.js'
        );
        if (nonSdkConfigNames.some(isComputerUseMCPServer)) {
          reservedNameError = `Invalid MCP configuration: "${COMPUTER_USE_MCP_SERVER_NAME}" is a reserved MCP name.`;
        }
      }
      if (reservedNameError) {
        // stderr+exit(1) — a throw here becomes a silent unhandled
        // rejection in stream-json mode (void main() in cli.tsx).
        process.stderr.write(`Error: ${reservedNameError}\n`);
        process.exit(1);
      }

      // Add dynamic scope to all configs. type:'sdk' entries pass through
      // unchanged — they're extracted into sdkMcpConfigs downstream and
      // passed to print.ts. The Python SDK relies on this path (it doesn't
      // send sdkMcpServers in the initialize message). Dropping them here
      // broke Coworker (inc-5122). The policy filter below already exempts
      // type:'sdk', and the entries are inert without an SDK transport on
      // stdin, so there's no bypass risk from letting them through.
      const scopedConfigs = mapValues(allConfigs, config => ({
        ...config,
        scope: 'dynamic' as const,
      }));

      // Enforce managed policy (allowedMcpServers / deniedMcpServers) on
      // --mcp-config servers. Without this, the CLI flag bypasses the
      // enterprise allowlist that user/project/local configs go through in
      // getClaudeCodeMcpConfigs — callers spread dynamicMcpConfig back on
      // top of filtered results. Filter here at the source so all
      // downstream consumers see the policy-filtered set.
      const { allowed, blocked } = filterMcpServersByPolicy(scopedConfigs);
      if (blocked.length > 0) {
        process.stderr.write(
          `Warning: MCP ${plural(blocked.length, 'server')} blocked by enterprise policy: ${blocked.join(', ')}\n`,
        );
      }
      dynamicMcpConfig = { ...dynamicMcpConfig, ...(allowed as Record<string, ScopedMcpServerConfig>) };
    }
  }

  // Extract the explicitly requested local Chrome integration option.
  const chromeOpts = options as { chrome?: boolean };
  // Store the explicit CLI flag so teammates can inherit it
  setChromeFlagOverride(chromeOpts.chrome);
  const enableClaudeInChrome = shouldEnableClaudeInChrome(chromeOpts.chrome);
  const autoEnableClaudeInChrome = !enableClaudeInChrome && shouldAutoEnableClaudeInChrome();

  if (enableClaudeInChrome) {
    const platform = getPlatform();
    try {
      logEvent('tengu_claude_in_chrome_setup', {
        platform: platform as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      });

      const {
        mcpConfig: chromeMcpConfig,
        allowedTools: chromeMcpTools,
        systemPrompt: chromeSystemPrompt,
      } = setupClaudeInChrome();
      dynamicMcpConfig = {
        ...dynamicMcpConfig,
        ...chromeMcpConfig,
      };
      allowedTools.push(...chromeMcpTools);
      if (chromeSystemPrompt) {
        appendSystemPrompt = appendSystemPrompt ? `${chromeSystemPrompt}\n\n${appendSystemPrompt}` : chromeSystemPrompt;
      }
    } catch (error) {
      logEvent('tengu_claude_in_chrome_setup_failed', {
        platform: platform as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      });
      logForDebugging(`[Claude in Chrome] Error: ${error}`);
      logError(error);
      console.error(`Error: Failed to run with Claude in Chrome.`);
      process.exit(1);
    }
  } else if (autoEnableClaudeInChrome) {
    try {
      const { mcpConfig: chromeMcpConfig } = setupClaudeInChrome();
      dynamicMcpConfig = {
        ...dynamicMcpConfig,
        ...chromeMcpConfig,
      };

      const hint =
        feature('WEB_BROWSER_TOOL') && typeof Bun !== 'undefined' && 'WebView' in Bun
          ? CLAUDE_IN_CHROME_SKILL_HINT_WITH_WEBBROWSER
          : CLAUDE_IN_CHROME_SKILL_HINT;
      appendSystemPrompt = appendSystemPrompt ? `${appendSystemPrompt}\n\n${hint}` : hint;
    } catch (error) {
      // Silently skip any errors for the auto-enable
      logForDebugging(`[Claude in Chrome] Error (auto-enable): ${error}`);
    }
  }

  // Extract strict MCP config flag
  const strictMcpConfig = options.strictMcpConfig || false;

  // Check if enterprise MCP configuration exists. When it does, only allow dynamic MCP
  // configs that contain special server types (sdk)
  if (doesEnterpriseMcpConfigExist()) {
    if (strictMcpConfig) {
      process.stderr.write(chalk.red('You cannot use --strict-mcp-config when an enterprise MCP config is present'));
      process.exit(1);
    }

    // For --mcp-config, allow if all servers are internal types (sdk)
    if (dynamicMcpConfig && !areMcpConfigsAllowedWithEnterpriseMcpConfig(dynamicMcpConfig)) {
      process.stderr.write(
        chalk.red('You cannot dynamically configure MCP servers when an enterprise MCP config is present'),
      );
      process.exit(1);
    }
  }

  // chicago MCP: guarded Computer Use (app allowlist + frontmost gate +
  // SCContentFilter screenshots). Ant-only, GrowthBook-gated — failures
  // are silent (this is dogfooding). Platform + interactive checks inline
  // so non-macOS / print-mode ants skip the heavy @ant/computer-use-mcp
  // import entirely. gates.js is light (type-only package import).
  //
  // Placed AFTER the enterprise-MCP-config check: that check rejects any
  // dynamicMcpConfig entry with `type !== 'sdk'`, and our config is
  // `type: 'stdio'`. An enterprise-config ant with the GB gate on would
  // otherwise process.exit(1). Chrome has the same latent issue but has
  // shipped without incident; chicago places itself correctly.
  if (feature('CHICAGO_MCP') && getPlatform() !== 'unknown' && !getIsNonInteractiveSession()) {
    try {
      const { getChicagoEnabled } = await import('src/utils/computerUse/gates.js');
      if (getChicagoEnabled()) {
        const { setupComputerUseMCP } = await import('src/utils/computerUse/setup.js');
        const { mcpConfig, allowedTools: cuTools } = setupComputerUseMCP();
        dynamicMcpConfig = {
          ...dynamicMcpConfig,
          ...mcpConfig,
        };
        allowedTools.push(...cuTools);
      }
    } catch (error) {
      logForDebugging(`[Computer Use MCP] Setup failed: ${errorMessage(error)}`);
    }
  }

  // Store additional directories for CLAUDE.md loading (controlled by env var)
  setAdditionalDirectoriesForClaudeMd(addDir);

  // Channel server allowlist from --channels flag — servers whose
  // inbound push notifications should register this session. The option
  // is added inside a feature() block so TS doesn't know about it
  // on the options type — same pattern as --assistant at main.tsx:1824.
  // devChannels is deferred: showSetupScreens shows a confirmation dialog
  // and only appends to allowedChannels on accept.
  let devChannels: ChannelEntry[] | undefined;
  // Parse plugin:name@marketplace / server:Y tags into typed entries.
  // Tag decides trust model downstream: plugin-kind hits marketplace
  // verification + GrowthBook allowlist, server-kind always fails
  // allowlist (schema is plugin-only) unless dev flag is set.
  // Untagged or marketplace-less plugin entries are hard errors —
  // silently not-matching in the gate would look like channels are
  // "on" but nothing ever fires.
  const parseChannelEntries = (raw: string[], flag: string): ChannelEntry[] => {
    const entries: ChannelEntry[] = [];
    const bad: string[] = [];
    for (const c of raw) {
      if (c.startsWith('plugin:')) {
        const rest = c.slice(7);
        const at = rest.indexOf('@');
        if (at <= 0 || at === rest.length - 1) {
          bad.push(c);
        } else {
          entries.push({
            kind: 'plugin',
            name: rest.slice(0, at),
            marketplace: rest.slice(at + 1),
          });
        }
      } else if (c.startsWith('server:') && c.length > 7) {
        entries.push({ kind: 'server', name: c.slice(7) });
      } else {
        bad.push(c);
      }
    }
    if (bad.length > 0) {
      process.stderr.write(
        chalk.red(
          `${flag} entries must be tagged: ${bad.join(', ')}\n` +
            `  plugin:<name>@<marketplace>  — plugin-provided channel (allowlist enforced)\n` +
            `  server:<name>                — manually configured MCP server\n`,
        ),
      );
      process.exit(1);
    }
    return entries;
  };

  const channelOpts = options as {
    channels?: string[];
    dangerouslyLoadDevelopmentChannels?: string[];
  };
  const rawChannels = channelOpts.channels;
  const rawDev = channelOpts.dangerouslyLoadDevelopmentChannels;
  // Always parse + set. ChannelsNotice reads getAllowedChannels() and
  // renders the appropriate branch (disabled/noAuth/policyBlocked/
  // listening) in the startup screen. gateChannelServer() enforces.
  // --channels works in both interactive and print/SDK modes; dev-channels
  // stays interactive-only (requires a confirmation dialog).
  let channelEntries: ChannelEntry[] = [];
  if (rawChannels && rawChannels.length > 0) {
    channelEntries = parseChannelEntries(rawChannels, '--channels');
    setAllowedChannels(channelEntries);
  }
  if (!isNonInteractiveSession) {
    if (rawDev && rawDev.length > 0) {
      devChannels = parseChannelEntries(rawDev, '--dangerously-load-development-channels');
    }
  }
  // Flag-usage telemetry. Plugin identifiers are logged (same tier as
  // tengu_plugin_installed — public-registry-style names); server-kind
  // names are not (MCP-server-name tier, opt-in-only elsewhere).
  // Per-server gate outcomes land in tengu_mcp_channel_gate once
  // servers connect. Dev entries go through a confirmation dialog after
  // this — dev_plugins captures what was typed, not what was accepted.
  if (channelEntries.length > 0 || (devChannels?.length ?? 0) > 0) {
    const joinPluginIds = (entries: ChannelEntry[]) => {
      const ids = entries.flatMap(e => (e.kind === 'plugin' ? [`${e.name}@${e.marketplace}`] : []));
      return ids.length > 0
        ? (ids.sort().join(',') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS)
        : undefined;
    };
    logEvent('tengu_mcp_channel_flags', {
      channels_count: channelEntries.length,
      dev_count: devChannels?.length ?? 0,
      plugins: joinPluginIds(channelEntries),
      dev_plugins: joinPluginIds(devChannels ?? []),
    });
  }

  // SDK opt-in for SendUserMessage via --tools. All sessions require
  // explicit opt-in; listing it in --tools signals intent. Runs BEFORE
  // initializeToolPermissionContext so getToolsForDefaultPreset() sees
  // the tool as enabled when computing the base-tools disallow filter.
  // Conditional require avoids leaking the tool-name string into
  // external builds.
  if ((feature('KAIROS') || feature('KAIROS_BRIEF')) && baseTools.length > 0) {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const { BRIEF_TOOL_NAME, LEGACY_BRIEF_TOOL_NAME } =
      require('@claude-code-best/builtin-tools/tools/BriefTool/prompt.js') as typeof import('@claude-code-best/builtin-tools/tools/BriefTool/prompt.js');
    const { isBriefEntitled } =
      require('@claude-code-best/builtin-tools/tools/BriefTool/BriefTool.js') as typeof import('@claude-code-best/builtin-tools/tools/BriefTool/BriefTool.js');
    /* eslint-enable @typescript-eslint/no-require-imports */
    const parsed = parseToolListFromCLI(baseTools);
    if ((parsed.includes(BRIEF_TOOL_NAME) || parsed.includes(LEGACY_BRIEF_TOOL_NAME)) && isBriefEntitled()) {
      setUserMsgOptIn(true);
    }
  }

  // This await replaces blocking existsSync/statSync calls that were already in
  // the startup path. Wall-clock time is unchanged; we just yield to the event
  // loop during the fs I/O instead of blocking it. See #19661.
  const initResult = await initializeToolPermissionContext({
    allowedToolsCli: allowedTools,
    disallowedToolsCli: disallowedTools,
    baseToolsCli: baseTools,
    permissionMode,
    allowDangerouslySkipPermissions,
    addDirs: addDir,
  });
  let toolPermissionContext = initResult.toolPermissionContext;
  const { warnings, dangerousPermissions, overlyBroadBashPermissions } = initResult;

  // Handle overly broad shell allow rules for ant users (Bash(*), PowerShell(*))
  if (process.env.USER_TYPE === 'ant' && overlyBroadBashPermissions.length > 0) {
    for (const permission of overlyBroadBashPermissions) {
      logForDebugging(
        `Ignoring overly broad shell permission ${permission.ruleDisplay} from ${permission.sourceDisplay}`,
      );
    }
    toolPermissionContext = removeDangerousPermissions(toolPermissionContext, overlyBroadBashPermissions);
  }

  if (feature('TRANSCRIPT_CLASSIFIER') && dangerousPermissions.length > 0) {
    toolPermissionContext = stripDangerousPermissionsForAutoMode(toolPermissionContext);
  }

  // Print any warnings from initialization
  warnings.forEach(warning => {
    console.error(warning);
  });

  // Kick off MCP config loading early (safe - just reads files, no execution).
  // Both interactive and -p use getClaudeCodeMcpConfigs (local file reads only).
  // The local promise is awaited later (before prefetchAllMcpResources) to
  // overlap config I/O with setup(), commands loading, and trust dialog.
  logForDebugging('[STARTUP] Loading MCP configs...');
  const mcpConfigStart = Date.now();
  let mcpConfigResolvedMs: number | undefined;
  // --bare skips auto-discovered MCP (.mcp.json, user settings, plugins) —
  // only explicit --mcp-config works. dynamicMcpConfig is spread onto
  // allMcpConfigs downstream so it survives this skip.
  const mcpConfigPromise = (
    strictMcpConfig || isBareMode()
      ? Promise.resolve({
          servers: {} as Record<string, ScopedMcpServerConfig>,
        })
      : getClaudeCodeMcpConfigs(dynamicMcpConfig)
  ).then(result => {
    mcpConfigResolvedMs = Date.now() - mcpConfigStart;
    return result;
  });

  // NOTE: We do NOT call prefetchAllMcpResources here - that's deferred until after trust dialog

  if (inputFormat && inputFormat !== 'text' && inputFormat !== 'stream-json') {
    console.error(`Error: Invalid input format "${inputFormat}".`);
    process.exit(1);
  }
  if (inputFormat === 'stream-json' && outputFormat !== 'stream-json') {
    console.error(`Error: --input-format=stream-json requires output-format=stream-json.`);
    process.exit(1);
  }

  // Validate sdkUrl is only used with appropriate formats (formats are auto-set above)
  if (sdkUrl) {
    if (inputFormat !== 'stream-json' || outputFormat !== 'stream-json') {
      console.error(`Error: --sdk-url requires both --input-format=stream-json and --output-format=stream-json.`);
      process.exit(1);
    }
  }

  // Validate replayUserMessages is only used with stream-json formats
  if (options.replayUserMessages) {
    if (inputFormat !== 'stream-json' || outputFormat !== 'stream-json') {
      console.error(
        `Error: --replay-user-messages requires both --input-format=stream-json and --output-format=stream-json.`,
      );
      process.exit(1);
    }
  }

  // Validate includePartialMessages is only used with print mode and stream-json output
  if (effectiveIncludePartialMessages) {
    if (!isNonInteractiveSession || outputFormat !== 'stream-json') {
      writeToStderr(`Error: --include-partial-messages requires --print and --output-format=stream-json.`);
      process.exit(1);
    }
  }

  // Validate --no-session-persistence is only used with print mode
  if (options.sessionPersistence === false && !isNonInteractiveSession) {
    writeToStderr(`Error: --no-session-persistence can only be used with --print mode.`);
    process.exit(1);
  }

  const effectivePrompt = prompt || '';
  let inputPrompt = await getInputPrompt(effectivePrompt, (inputFormat ?? 'text') as 'text' | 'stream-json');
  profileCheckpoint('action_after_input_prompt');

  // Activate proactive mode BEFORE getTools() so SleepTool.isEnabled()
  // (which returns isProactiveActive()) passes and Sleep is included.
  // The later REPL-path maybeActivateProactive() calls are idempotent.
  maybeActivateProactive(options);

  let tools = getTools(toolPermissionContext);

  // Apply coordinator mode tool filtering for headless path
  // (mirrors useMergedTools.ts filtering for REPL/interactive path)
  if (feature('COORDINATOR_MODE') && isEnvTruthy(process.env.CLAUDE_CODE_COORDINATOR_MODE)) {
    const { applyCoordinatorToolFilter } = await import('../../utils/toolPool.js');
    tools = applyCoordinatorToolFilter(tools);
  }

  profileCheckpoint('action_tools_loaded');

  let jsonSchema: ToolInputJSONSchema | undefined;
  if (isSyntheticOutputToolEnabled({ isNonInteractiveSession }) && options.jsonSchema) {
    jsonSchema = jsonParse(options.jsonSchema) as ToolInputJSONSchema;
  }

  if (jsonSchema) {
    const syntheticOutputResult = createSyntheticOutputTool(jsonSchema);
    if ('tool' in syntheticOutputResult) {
      // Add SyntheticOutputTool to the tools array AFTER getTools() filtering.
      // This tool is excluded from normal filtering (see tools.ts) because it's
      // an implementation detail for structured output, not a user-controlled tool.
      tools = [...tools, syntheticOutputResult.tool];

      logEvent('tengu_structured_output_enabled', {
        schema_property_count: Object.keys((jsonSchema.properties as Record<string, unknown>) || {})
          .length as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        has_required_fields: Boolean(jsonSchema.required) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      });
    } else {
      logEvent('tengu_structured_output_failure', {
        error: 'Invalid JSON schema' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      });
    }
  }

  // IMPORTANT: setup() must be called before any other code that depends on the cwd or worktree setup
  profileCheckpoint('action_before_setup');
  logForDebugging('[STARTUP] Running setup()...');
  const setupStart = Date.now();
  const { setup } = await import('../../setup.js');
  const messagingSocketPath = feature('UDS_INBOX')
    ? (options as { messagingSocketPath?: string }).messagingSocketPath
    : undefined;
  // Parallelize setup() with commands+agents loading. setup()'s ~28ms is
  // mostly startUdsMessaging (socket bind, ~20ms) — not disk-bound, so it
  // doesn't contend with getCommands' file reads. Gated on !worktreeEnabled
  // since --worktree makes setup() process.chdir() (setup.ts:203), and
  // commands/agents need the post-chdir cwd.
  const preSetupCwd = getCwd();
  // Register bundled skills/plugins before kicking getCommands() — they're
  // pure in-memory array pushes (<1ms, zero I/O) that getBundledSkills()
  // reads synchronously. Previously ran inside setup() after ~20ms of
  // await points, so the parallel getCommands() memoized an empty list.
  if (process.env.CLAUDE_CODE_ENTRYPOINT !== 'local-agent') {
    initBuiltinPlugins();
    initBundledSkills();
  }
  const setupPromise = setup(
    preSetupCwd,
    permissionMode,
    allowDangerouslySkipPermissions,
    worktreeEnabled,
    worktreeName,
    tmuxEnabled,
    sessionId ? validateUuid(sessionId) : undefined,
    worktreePRNumber,
    messagingSocketPath,
  );
  const commandsPromise = worktreeEnabled ? null : getCommands(preSetupCwd);
  const agentDefsPromise = worktreeEnabled ? null : getAgentDefinitionsWithOverrides(preSetupCwd);
  // Suppress transient unhandledRejection if these reject during the
  // ~28ms setupPromise await before Promise.all joins them below.
  commandsPromise?.catch(() => {});
  agentDefsPromise?.catch(() => {});
  await setupPromise;
  logForDebugging(`[STARTUP] setup() completed in ${Date.now() - setupStart}ms`);
  profileCheckpoint('action_after_setup');

  // Replay user messages into stream-json only when the socket was
  // explicitly requested. The auto-generated socket is passive — it
  // lets tools inject if they want to, but turning it on by default
  // shouldn't reshape stream-json for SDK consumers who never touch it.
  // Callers who inject and also want those injections visible in the
  // stream pass --messaging-socket-path explicitly (or --replay-user-messages).
  let effectiveReplayUserMessages = !!options.replayUserMessages;
  if (feature('UDS_INBOX')) {
    if (!effectiveReplayUserMessages && outputFormat === 'stream-json') {
      effectiveReplayUserMessages = !!(options as { messagingSocketPath?: string }).messagingSocketPath;
    }
  }

  if (getIsNonInteractiveSession()) {
    // Apply full merged settings env now (including project-scoped
    // .claude/settings.json PATH/GIT_DIR/GIT_WORK_TREE) so gitExe() and
    // the git spawn below see it. Trust is implicit in -p mode; the
    // docstring at managedEnv.ts:96-97 says this applies "potentially
    // dangerous environment variables such as LD_PRELOAD, PATH" from all
    // sources. The later call in the isNonInteractiveSession block below
    // is idempotent (Object.assign, configureGlobalAgents ejects prior
    // interceptor) and picks up any plugin-contributed env after plugin
    // init. Project settings are already loaded here:
    // applySafeConfigEnvironmentVariables in init() called
    // getSettings_DEPRECATED at managedEnv.ts:86 which merges all enabled
    // sources including projectSettings/localSettings.
    applyConfigEnvironmentVariables();

    // Spawn git status/log/branch now so the subprocess execution overlaps
    // with the getCommands await below and startDeferredPrefetches. After
    // setup() so cwd is final (setup.ts:254 may process.chdir(worktreePath)
    // for --worktree) and after the applyConfigEnvironmentVariables above
    // so PATH/GIT_DIR/GIT_WORK_TREE from all sources (trusted + project)
    // are applied. getSystemContext is memoized; the
    // prefetchSystemContextIfSafe call in startDeferredPrefetches becomes
    // a cache hit. The microtask from await getIsGit() drains at the
    // getCommands Promise.all await below. Trust is implicit in -p mode
    // (same gate as prefetchSystemContextIfSafe).
    void getSystemContext();
    // Kick getUserContext now too — its first await (fs.readFile in
    // getMemoryFiles) yields naturally, so the CLAUDE.md directory walk
    // runs during the ~280ms overlap window before the context
    // Promise.all join in print.ts. The void getUserContext() in
    // startDeferredPrefetches becomes a memoize cache-hit.
    void getUserContext();
    // Initialize provider-specific model strings before startup joins.
    void ensureModelStringsInitialized();
  }

  // Apply --name: cache-only so no orphan file is created before the
  // session ID is finalized by --continue/--resume. materializeSessionFile
  // persists it on the first user message; REPL's useTerminalTitle reads it
  // via getCurrentSessionTitle.
  const sessionNameArg = options.name?.trim();
  if (sessionNameArg) {
    cacheSessionTitle(sessionNameArg);
  }

  // Ant model aliases (capybara-fast etc.) resolve via the
  // tengu_ant_model_override GrowthBook flag. _CACHED_MAY_BE_STALE reads
  // disk synchronously; disk is populated by a fire-and-forget write. On a
  // cold cache, parseUserSpecifiedModel returns the unresolved alias, the
  // API 404s, and -p exits before the async write lands — crashloop on
  // fresh pods. Awaiting init here populates the in-memory payload map that
  // _CACHED_MAY_BE_STALE now checks first. Gated so the warm path stays
  // non-blocking:
  //  - explicit model via --model or ANTHROPIC_MODEL (both feed alias resolution)
  //  - no env override (which short-circuits _CACHED_MAY_BE_STALE before disk)
  //  - flag absent from disk (== null also catches pre-#22279 poisoned null)
  const explicitModel = options.model || process.env.ANTHROPIC_MODEL;
  if (
    process.env.USER_TYPE === 'ant' &&
    explicitModel &&
    explicitModel !== 'default' &&
    !hasGrowthBookEnvOverride('tengu_ant_model_override')
  ) {
    await initializeGrowthBook();
  }

  // Special case the default model with the null keyword
  // NOTE: Model resolution happens after setup() to ensure trust is established before AWS auth
  const userSpecifiedModel = options.model === 'default' ? getDefaultMainLoopModel() : options.model;
  const userSpecifiedFallbackModel = fallbackModel === 'default' ? getDefaultMainLoopModel() : fallbackModel;

  // Reuse preSetupCwd unless setup() chdir'd (worktreeEnabled). Saves a
  // getCwd() syscall in the common path.
  const currentCwd = worktreeEnabled ? getCwd() : preSetupCwd;
  logForDebugging('[STARTUP] Loading commands and agents...');
  const commandsStart = Date.now();
  // Join the promises kicked before setup() (or start fresh if
  // worktreeEnabled gated the early kick). Both memoized by cwd.
  const [commands, agentDefinitionsResult] = await Promise.all([
    commandsPromise ?? getCommands(currentCwd),
    agentDefsPromise ?? getAgentDefinitionsWithOverrides(currentCwd),
  ]);
  logForDebugging(`[STARTUP] Commands and agents loaded in ${Date.now() - commandsStart}ms`);
  profileCheckpoint('action_commands_loaded');

  // Parse CLI agents if provided via --agents flag
  let cliAgents: typeof agentDefinitionsResult.activeAgents = [];
  if (agentsJson) {
    try {
      const parsedAgents = safeParseJSON(agentsJson);
      if (parsedAgents) {
        cliAgents = parseAgentsFromJson(parsedAgents, 'flagSettings');
      }
    } catch (error) {
      logError(error);
    }
  }

  // Merge CLI agents with existing ones
  const allAgents = [...agentDefinitionsResult.allAgents, ...cliAgents];
  const agentDefinitions = {
    ...agentDefinitionsResult,
    allAgents,
    activeAgents: getActiveAgentsFromList(allAgents),
  };

  // Look up main thread agent from CLI flag or settings
  const agentSetting = agentCli ?? getInitialSettings().agent;
  let mainThreadAgentDefinition: (typeof agentDefinitions.activeAgents)[number] | undefined;
  if (agentSetting) {
    mainThreadAgentDefinition = agentDefinitions.activeAgents.find(agent => agent.agentType === agentSetting);
    if (!mainThreadAgentDefinition) {
      logForDebugging(
        `Warning: agent "${agentSetting}" not found. ` +
          `Available agents: ${agentDefinitions.activeAgents.map(a => a.agentType).join(', ')}. ` +
          `Using default behavior.`,
      );
    }
  }

  // Store the main thread agent type in bootstrap state so hooks can access it
  setMainThreadAgentType(mainThreadAgentDefinition?.agentType);

  // Log agent flag usage — only log agent name for built-in agents to avoid leaking custom agent names
  if (mainThreadAgentDefinition) {
    logEvent('tengu_agent_flag', {
      agentType: isBuiltInAgent(mainThreadAgentDefinition)
        ? (mainThreadAgentDefinition.agentType as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS)
        : ('custom' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS),
      ...(agentCli && {
        source: 'cli' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      }),
    });
  }

  // Persist agent setting to session transcript for resume view display and restoration
  if (mainThreadAgentDefinition?.agentType) {
    saveAgentSetting(mainThreadAgentDefinition.agentType);
  }

  // Apply the agent's system prompt for non-interactive sessions
  // (interactive mode uses buildEffectiveSystemPrompt instead)
  if (
    isNonInteractiveSession &&
    mainThreadAgentDefinition &&
    !systemPrompt &&
    !isBuiltInAgent(mainThreadAgentDefinition)
  ) {
    const agentSystemPrompt = mainThreadAgentDefinition.getSystemPrompt();
    if (agentSystemPrompt) {
      systemPrompt = agentSystemPrompt;
    }
  }

  // initialPrompt goes first so its slash command (if any) is processed;
  // user-provided text becomes trailing context.
  // Only concatenate when inputPrompt is a string. When it's an
  // AsyncIterable (SDK stream-json mode), template interpolation would
  // call .toString() producing "[object Object]". The AsyncIterable case
  // is handled in print.ts via structuredIO.prependUserMessage().
  if (mainThreadAgentDefinition?.initialPrompt) {
    if (typeof inputPrompt === 'string') {
      inputPrompt = inputPrompt
        ? `${mainThreadAgentDefinition.initialPrompt}\n\n${inputPrompt}`
        : mainThreadAgentDefinition.initialPrompt;
    } else if (!inputPrompt) {
      inputPrompt = mainThreadAgentDefinition.initialPrompt;
    }
  }

  // Compute effective model early so hooks can run in parallel with MCP
  // If user didn't specify a model but agent has one, use the agent's model
  let effectiveModel = userSpecifiedModel;
  if (!effectiveModel && mainThreadAgentDefinition?.model && mainThreadAgentDefinition.model !== 'inherit') {
    effectiveModel = parseUserSpecifiedModel(mainThreadAgentDefinition.model);
  }

  setMainLoopModelOverride(effectiveModel);

  // Compute resolved model for hooks (use user-specified model at launch)
  setInitialMainLoopModel(getUserSpecifiedModelSetting() || null);
  const initialMainLoopModel = getInitialMainLoopModel();
  const modelRegistryError = getModelRegistryError();
  const shouldConfigureModel = !isNonInteractiveSession && isModelRegistryMissing();
  if (modelRegistryError !== null && !shouldConfigureModel) {
    process.stderr.write(chalk.red(`Model configuration error: ${modelRegistryError}\n`));
    gracefulShutdownSync(1);
    return;
  }
  let resolvedInitialModel: string | null = shouldConfigureModel
    ? null
    : parseUserSpecifiedModel(initialMainLoopModel ?? getDefaultMainLoopModel());

  let advisorModel: string | undefined;
  if (isAdvisorEnabled() && resolvedInitialModel !== null) {
    const advisorOption = canUserConfigureAdvisor() ? (options as { advisor?: string }).advisor : undefined;
    if (advisorOption) {
      logForDebugging(`[AdvisorTool] --advisor ${advisorOption}`);
      if (!modelSupportsAdvisor(resolvedInitialModel)) {
        process.stderr.write(
          chalk.red(`Error: The model "${resolvedInitialModel}" does not support the advisor tool.\n`),
        );
        process.exit(1);
      }
      const normalizedAdvisorModel = normalizeModelStringForAPI(parseUserSpecifiedModel(advisorOption));
      if (!isValidAdvisorModel(normalizedAdvisorModel)) {
        process.stderr.write(chalk.red(`Error: The model "${advisorOption}" cannot be used as an advisor.\n`));
        process.exit(1);
      }
    }
    advisorModel = canUserConfigureAdvisor() ? (advisorOption ?? getInitialAdvisorSetting()) : advisorOption;
    if (advisorModel) {
      logForDebugging(`[AdvisorTool] Advisor model: ${advisorModel}`);
    }
  }

  // For tmux teammates with --agent-type, append the custom agent's prompt
  if (
    isAgentSwarmsEnabled() &&
    storedTeammateOpts?.agentId &&
    storedTeammateOpts?.agentName &&
    storedTeammateOpts?.teamName &&
    storedTeammateOpts?.agentType
  ) {
    // Look up the custom agent definition
    const customAgent = agentDefinitions.activeAgents.find(a => a.agentType === storedTeammateOpts.agentType);
    if (customAgent) {
      // Get the prompt - need to handle both built-in and custom agents
      let customPrompt: string | undefined;
      if (customAgent.source === 'built-in') {
        // Built-in agents have getSystemPrompt that takes toolUseContext
        // We can't access full toolUseContext here, so skip for now
        logForDebugging(
          `[teammate] Built-in agent ${storedTeammateOpts.agentType} - skipping custom prompt (not supported)`,
        );
      } else {
        // Custom agents have getSystemPrompt that takes no args
        customPrompt = customAgent.getSystemPrompt();
      }

      // Log agent memory loaded event for tmux teammates
      if (customAgent.memory) {
        logEvent('tengu_agent_memory_loaded', {
          ...(process.env.USER_TYPE === 'ant' && {
            agent_type: customAgent.agentType as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          }),
          scope: customAgent.memory as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          source: 'teammate' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        });
      }

      if (customPrompt) {
        const customInstructions = `\n# Custom Agent Instructions\n${customPrompt}`;
        appendSystemPrompt = appendSystemPrompt ? `${appendSystemPrompt}\n\n${customInstructions}` : customInstructions;
      }
    } else {
      logForDebugging(`[teammate] Custom agent ${storedTeammateOpts.agentType} not found in available agents`);
    }
  }

  maybeActivateBrief(options);
  // defaultView: 'chat' is a persisted opt-in — check entitlement and set
  // userMsgOptIn so the tool + prompt section activate. Interactive-only:
  // defaultView is a display preference; SDK sessions have no display, and
  // the assistant installer writes defaultView:'chat' to settings.local.json
  // which would otherwise leak into --print sessions in the same directory.
  // Runs right after maybeActivateBrief() so all startup opt-in paths fire
  // BEFORE any isBriefEnabled() read below (proactive prompt's
  // briefVisibility). A persisted 'chat' after a GB kill-switch falls
  // through (entitlement fails).
  if (
    (feature('KAIROS') || feature('KAIROS_BRIEF')) &&
    !getIsNonInteractiveSession() &&
    !getUserMsgOptIn() &&
    getInitialSettings().defaultView === 'chat'
  ) {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const { isBriefEntitled } =
      require('@claude-code-best/builtin-tools/tools/BriefTool/BriefTool.js') as typeof import('@claude-code-best/builtin-tools/tools/BriefTool/BriefTool.js');
    /* eslint-enable @typescript-eslint/no-require-imports */
    if (isBriefEntitled()) {
      setUserMsgOptIn(true);
    }
  }
  // Coordinator mode has its own system prompt and filters out Sleep, so
  // the generic proactive prompt would tell it to call a tool it can't
  // access and conflict with delegation instructions.
  if (
    (feature('PROACTIVE') || feature('KAIROS')) &&
    ((options as { proactive?: boolean }).proactive || isEnvTruthy(process.env.CLAUDE_CODE_PROACTIVE)) &&
    !coordinatorModeModule?.isCoordinatorMode()
  ) {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const briefVisibility =
      feature('KAIROS') || feature('KAIROS_BRIEF')
        ? (
            require('@claude-code-best/builtin-tools/tools/BriefTool/BriefTool.js') as typeof import('@claude-code-best/builtin-tools/tools/BriefTool/BriefTool.js')
          ).isBriefEnabled()
          ? 'Call SendUserMessage at checkpoints to mark where things stand.'
          : 'The user will see any text you output.'
        : 'The user will see any text you output.';
    /* eslint-enable @typescript-eslint/no-require-imports */
    const proactivePrompt = `\n# Proactive Mode\n\nYou are in proactive mode. Take initiative — explore, act, and make progress without waiting for instructions.\n\nStart by briefly greeting the user.\n\nYou will receive periodic <tick> prompts. These are check-ins. Do whatever seems most useful, or call Sleep if there's nothing to do. ${briefVisibility}`;
    appendSystemPrompt = appendSystemPrompt ? `${appendSystemPrompt}\n\n${proactivePrompt}` : proactivePrompt;
  }

  // Ink root is only needed for interactive sessions — patchConsole in the
  // Ink constructor would swallow console output in headless mode.
  let root!: Root;
  let getFpsMetrics!: () => FpsMetrics | undefined;
  let stats!: StatsStore;

  // Show setup screens after commands are loaded
  if (!isNonInteractiveSession) {
    const ctx = getRenderContext(false);
    getFpsMetrics = ctx.getFpsMetrics;
    stats = ctx.stats;
    // Install asciicast recorder before Ink mounts (ant-only, opt-in via CLAUDE_CODE_TERMINAL_RECORDING=1)
    if (process.env.USER_TYPE === 'ant') {
      installAsciicastRecorder();
    }

    const { createRoot } = await import('@anthropic/ink');
    root = await createRoot(ctx.renderOptions);

    // Log startup time now, before any blocking dialog renders. Logging
    // from REPL's first render (the old location) included however long
    // the user sat on trust/OAuth/onboarding/resume-picker — p99 was ~70s
    // dominated by dialog-wait time, not code-path startup.
    logEvent('tengu_timer', {
      event: 'startup' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      durationMs: Math.round(process.uptime() * 1000),
    });

    logForDebugging('[STARTUP] Running showSetupScreens()...');
    const setupScreensStart = Date.now();
    await showSetupScreens(
      root,
      permissionMode,
      allowDangerouslySkipPermissions,
      commands,
      enableClaudeInChrome,
      devChannels,
    );
    logForDebugging(`[STARTUP] showSetupScreens() completed in ${Date.now() - setupScreensStart}ms`);

    // Check for pending agent memory snapshot updates (only for --agent mode, ant-only)
    if (
      feature('AGENT_MEMORY_SNAPSHOT') &&
      mainThreadAgentDefinition &&
      isCustomAgent(mainThreadAgentDefinition) &&
      mainThreadAgentDefinition.memory &&
      mainThreadAgentDefinition.pendingSnapshotUpdate
    ) {
      const agentDef = mainThreadAgentDefinition;
      const choice = await launchSnapshotUpdateDialog(root, {
        agentType: agentDef.agentType,
        scope: agentDef.memory!,
        snapshotTimestamp: agentDef.pendingSnapshotUpdate!.snapshotTimestamp,
      });
      if (choice === 'merge') {
        const { buildMergePrompt } = await import('../../components/agents/SnapshotUpdateDialog.js');
        const mergePrompt = buildMergePrompt(agentDef.agentType, agentDef.memory!);
        inputPrompt = inputPrompt ? `${mergePrompt}\n\n${inputPrompt}` : mergePrompt;
      }
      agentDef.pendingSnapshotUpdate = undefined;
    }
  }

  // If gracefulShutdown was initiated (e.g., user rejected trust dialog),
  // process.exitCode will be set. Skip all subsequent operations that could
  // trigger code execution before the process exits (e.g. we don't want apiKeyHelper
  // to run if trust was not established).
  if (process.exitCode !== undefined) {
    logForDebugging('Graceful shutdown initiated, skipping further initialization');
    return;
  }

  // The first-run OpenAI setup screen creates models.json. Resolve the
  // default only after that dialog completes, otherwise a missing registry
  // prevents the setup UI from ever rendering.
  if (resolvedInitialModel === null) {
    resolvedInitialModel = parseUserSpecifiedModel(getDefaultMainLoopModel());
    logForDebugging(`[STARTUP] Default model resolved after setup: ${resolvedInitialModel}`);
  }

  // Initialize LSP manager AFTER trust is established (or in non-interactive mode
  // where trust is implicit). This prevents plugin LSP servers from executing
  // code in untrusted directories before user consent.
  // Must be after inline plugins are set (if any) so --plugin-dir LSP servers are included.
  initializeLspServerManager();

  // Show settings validation errors after trust is established
  // MCP config errors don't block settings from loading, so exclude them
  if (!isNonInteractiveSession) {
    const { errors } = getSettingsWithErrors();
    const nonMcpErrors = errors.filter(e => !e.mcpErrorMetadata);
    if (nonMcpErrors.length > 0) {
      await launchInvalidSettingsDialog(root, {
        settingsErrors: nonMcpErrors,
        onExit: () => gracefulShutdownSync(1),
      });
    }
  }

  if (!isNonInteractiveSession) {
    void refreshExampleCommands(); // Pre-fetch example commands (runs git log, no API call)
  }

  // Resolve MCP configs (started early, overlaps with setup/trust dialog work)
  const { servers: existingMcpConfigs } = await mcpConfigPromise;
  logForDebugging(
    `[STARTUP] MCP configs resolved in ${mcpConfigResolvedMs}ms (awaited at +${Date.now() - mcpConfigStart}ms)`,
  );
  // CLI flag (--mcp-config) should override file-based configs, matching settings precedence
  const allMcpConfigs = {
    ...existingMcpConfigs,
    ...dynamicMcpConfig,
  };

  // Separate SDK configs from regular MCP configs
  const sdkMcpConfigs: Record<string, McpSdkServerConfig> = {};
  const regularMcpConfigs: Record<string, ScopedMcpServerConfig> = {};

  for (const [name, config] of Object.entries(allMcpConfigs)) {
    const typedConfig = config as ScopedMcpServerConfig | McpSdkServerConfig;
    if (typedConfig.type === 'sdk') {
      sdkMcpConfigs[name] = typedConfig as McpSdkServerConfig;
    } else {
      regularMcpConfigs[name] = typedConfig as ScopedMcpServerConfig;
    }
  }

  profileCheckpoint('action_mcp_configs_loaded');

  // Prefetch MCP resources after trust dialog (this is where execution happens).
  // Interactive mode only: print mode defers connects until headlessStore exists
  // and pushes per-server (below), so SearchExtraTools's pending-client handling works
  // and one slow server doesn't block the batch.
  const localMcpPromise = isNonInteractiveSession
    ? Promise.resolve({ clients: [], tools: [], commands: [] })
    : prefetchAllMcpResources(regularMcpConfigs);
  const mcpPromise = localMcpPromise;

  // Start hooks early so they run in parallel with MCP connections.
  // Skip for initOnly/init/maintenance (handled separately), non-interactive
  // (handled via setupTrigger), and resume/continue (conversationRecovery.ts
  // fires 'resume' instead — without this guard, hooks fire TWICE on /resume
  // and the second systemMessage clobbers the first. gh-30825)
  const hooksPromise =
    initOnly || init || maintenance || isNonInteractiveSession || options.continue || options.resume
      ? null
      : processSessionStartHooks('startup', {
          agentType: mainThreadAgentDefinition?.agentType,
          model: resolvedInitialModel,
        });

  // MCP never blocks REPL render OR turn 1 TTFT. useManageMCPConnections
  // populates appState.mcp async as servers connect (connectToServer is
  // memoized — the prefetch calls above and the hook converge on the same
  // connections). getToolUseContext reads store.getState() fresh via
  // computeTools(), so turn 1 sees whatever's connected by query time.
  // Slow servers populate for turn 2+. Matches interactive-no-prompt
  // behavior. Print mode: per-server push into headlessStore (below).
  const hookMessages: Awaited<NonNullable<typeof hooksPromise>> = [];
  // Suppress transient unhandledRejection — the prefetch warms the
  // memoized connectToServer cache but nobody awaits it in interactive.
  mcpPromise.catch(() => {});

  const mcpClients: Awaited<typeof mcpPromise>['clients'] = [];
  const mcpTools: Awaited<typeof mcpPromise>['tools'] = [];
  const mcpCommands: Awaited<typeof mcpPromise>['commands'] = [];

  let thinkingEnabled = shouldEnableThinkingByDefault();
  let thinkingConfig: ThinkingConfig = thinkingEnabled !== false ? { type: 'adaptive' } : { type: 'disabled' };

  if (options.thinking === 'adaptive' || options.thinking === 'enabled') {
    thinkingEnabled = true;
    thinkingConfig = { type: 'adaptive' };
  } else if (options.thinking === 'disabled') {
    thinkingEnabled = false;
    thinkingConfig = { type: 'disabled' };
  } else {
    const maxThinkingTokens = process.env.MAX_THINKING_TOKENS
      ? parseInt(process.env.MAX_THINKING_TOKENS, 10)
      : options.maxThinkingTokens;
    if (maxThinkingTokens !== undefined) {
      if (maxThinkingTokens > 0) {
        thinkingEnabled = true;
        thinkingConfig = {
          type: 'enabled',
          budgetTokens: maxThinkingTokens,
        };
      } else if (maxThinkingTokens === 0) {
        thinkingEnabled = false;
        thinkingConfig = { type: 'disabled' };
      }
    }
  }

  logForDiagnosticsNoPII('info', 'started', {
    version: MACRO.VERSION,
    is_native_binary: isInBundledMode(),
  });

  registerCleanup(async () => {
    logForDiagnosticsNoPII('info', 'exited');
  });

  void logTenguInit({
    hasInitialPrompt: Boolean(prompt),
    hasStdin: Boolean(inputPrompt),
    verbose,
    debug,
    debugToStderr,
    print: print ?? false,
    outputFormat: outputFormat ?? 'text',
    inputFormat: inputFormat ?? 'text',
    numAllowedTools: allowedTools.length,
    numDisallowedTools: disallowedTools.length,
    mcpClientCount: Object.keys(allMcpConfigs).length,
    worktreeEnabled,
    skipWebFetchPreflight: getInitialSettings().skipWebFetchPreflight,
    githubActionInputs: process.env.GITHUB_ACTION_INPUTS,
    dangerouslySkipPermissionsPassed: dangerouslySkipPermissions ?? false,
    permissionMode,
    modeIsBypass: permissionMode === 'bypassPermissions',
    allowDangerouslySkipPermissionsPassed: allowDangerouslySkipPermissions,
    systemPromptFlag: systemPrompt ? (options.systemPromptFile ? 'file' : 'flag') : undefined,
    appendSystemPromptFlag: appendSystemPrompt ? (options.appendSystemPromptFile ? 'file' : 'flag') : undefined,
    thinkingConfig,
  });

  // Log context metrics once at initialization

  void logPermissionContextForAnts(null, 'initialization');


  // Register PID file for concurrent-session detection (~/.claude/sessions/)
  // and fire multi-clauding telemetry. Lives here (not init.ts) so only the
  // REPL path registers — not subcommands like `claude doctor`. Chained:
  // count must run after register's write completes or it misses our own file.
  void registerSession().then(registered => {
    if (!registered) return;
    if (sessionNameArg) {
      void updateSessionName(sessionNameArg);
    }
    void countConcurrentSessions().then(count => {
      if (count >= 2) {
        logEvent('tengu_concurrent_sessions', {
          num_sessions: count,
        });
      }
    });
  });

  // Initialize versioned plugins system (triggers V1→V2 migration if
  const setupTrigger = initOnly || init ? 'init' : maintenance ? 'maintenance' : null;
  if (initOnly) {
    applyConfigEnvironmentVariables();
    await processSetupHooks('init', { forceSyncExecution: true });
    await processSessionStartHooks('startup', {
      forceSyncExecution: true,
    });
    gracefulShutdownSync(0);
    return;
  }

  // --print mode
  if (isNonInteractiveSession) {
    if (outputFormat === 'stream-json' || outputFormat === 'json') {
      setHasFormattedOutput(true);
    }

    // Apply full environment variables in print mode since trust dialog is bypassed
    // This includes potentially dangerous environment variables from untrusted sources
    // but print mode is considered trusted (as documented in help text)
    applyConfigEnvironmentVariables();

    // Initialize telemetry after env vars are applied so OTEL endpoint env vars and
    // otelHeadersHelper (which requires trust to execute) are available.

    // Kick SessionStart hooks now so the subprocess spawn overlaps with
    // MCP connect + plugin init + print.ts import below. loadInitialMessages
    // joins this at print.ts:4397. Guarded same as loadInitialMessages —
    // continue/resume/teleport paths don't fire startup hooks (or fire them
    // conditionally inside the resume branch, where this promise is
    // undefined and the ?? fallback runs). Also skip when setupTrigger is
    // set — those paths run setup hooks first (print.ts:544), and session
    // start hooks must wait until setup completes.
    const sessionStartHooksPromise =
      options.continue || options.resume || setupTrigger ? undefined : processSessionStartHooks('startup');
    // Suppress transient unhandledRejection if this rejects before
    // loadInitialMessages awaits it. Downstream await still observes the
    // rejection — this just prevents the spurious global handler fire.
    sessionStartHooksPromise?.catch(() => {});

    // Headless mode supports all prompt commands and some local commands
    // If disableSlashCommands is true, return empty array
    const commandsHeadless = disableSlashCommands
      ? []
      : commands.filter(
          command =>
            (command.type === 'prompt' && !command.disableNonInteractive) ||
            (command.type === 'local' && command.supportsNonInteractive),
        );

    const defaultState = getDefaultAppState();
    const headlessInitialState: AppState = {
      ...defaultState,
      mcp: {
        ...defaultState.mcp,
        clients: mcpClients,
        commands: mcpCommands,
        tools: mcpTools,
      },
      toolPermissionContext,
      effortValue: parseEffortValue(options.effort) ?? getInitialEffortSetting(),
      ...(isFastModeEnabled() && {
        fastMode: getInitialFastModeSetting(effectiveModel ?? null),
      }),
      ...(isAdvisorEnabled() && advisorModel && { advisorModel }),
      kairosEnabled: false,
    };

    // Init app state
    const headlessStore = createStore(headlessInitialState, onChangeAppState);

    // Async check of auto mode gate — corrects state and disables auto if needed.
    if (feature('TRANSCRIPT_CLASSIFIER')) {
      void verifyAutoModeGateAccess(toolPermissionContext, headlessStore.getState().fastMode).then(
        ({ updateContext }) => {
          headlessStore.setState(prev => {
            const nextCtx = updateContext(prev.toolPermissionContext);
            if (nextCtx === prev.toolPermissionContext) return prev;
            return { ...prev, toolPermissionContext: nextCtx };
          });
        },
      );
    }

    // Set global state for session persistence
    if (options.sessionPersistence === false) {
      setSessionPersistenceDisabled(true);
    }

    // Store SDK betas in global state for context window calculation
    // Only store allowed betas (filters by allowlist and subscriber status)
    setSdkBetas(filterAllowedSdkBetas(betas));

    // Print-mode MCP: per-server incremental push into headlessStore.
    // Mirrors useManageMCPConnections — push pending first (so SearchExtraTools's
    // pending-check at SearchExtraToolsTool.ts:334 sees them), then replace with
    // connected/failed as each server settles.
    const connectMcpBatch = (configs: Record<string, ScopedMcpServerConfig>, label: string): Promise<void> => {
      if (Object.keys(configs).length === 0) return Promise.resolve();
      headlessStore.setState(prev => ({
        ...prev,
        mcp: {
          ...prev.mcp,
          clients: [
            ...prev.mcp.clients,
            ...Object.entries(configs).map(([name, config]) => ({
              name,
              type: 'pending' as const,
              config,
            })),
          ],
        },
      }));
      return getMcpToolsCommandsAndResources(({ client, tools, commands }) => {
        headlessStore.setState(prev => ({
          ...prev,
          mcp: {
            ...prev.mcp,
            clients: prev.mcp.clients.some(c => c.name === client.name)
              ? prev.mcp.clients.map(c => (c.name === client.name ? client : c))
              : [...prev.mcp.clients, client],
            tools: uniqBy([...prev.mcp.tools, ...tools], 'name'),
            commands: uniqBy([...prev.mcp.commands, ...commands], 'name'),
          },
        }));
      }, configs).catch(err => logForDebugging(`[MCP] ${label} connect error: ${err}`));
    };
    // Await all MCP configs — print mode is often single-turn, so
    // "late-connecting servers visible next turn" doesn't help. SDK init
    // message and turn-1 tool list both need configured MCP tools present.
    // Zero-server case is free via the early return in connectMcpBatch.
    // Connectors parallelize inside getMcpToolsCommandsAndResources
    // (processBatched with Promise.all). claude.ai is awaited too — its
    // fetch was kicked off early (line ~2558) so only residual time blocks
    // here. --bare skips claude.ai entirely for perf-sensitive scripts.
    profileCheckpoint('before_connectMcp');
    await connectMcpBatch(regularMcpConfigs, 'regular');
    profileCheckpoint('after_connectMcp');
    // In headless mode, start deferred prefetches immediately (no user typing delay)
    // --bare / SIMPLE: startDeferredPrefetches early-returns internally.
    // backgroundHousekeeping (initExtractMemories, pruneShellSnapshots,
    // cleanupOldMessageFiles) and sdkHeapDumpMonitor are all bookkeeping
    // that scripted calls don't need — the next interactive session reconciles.
    if (!isBareMode()) {
      startDeferredPrefetches();
      void import('../../utils/backgroundHousekeeping.js').then(m => m.startBackgroundHousekeeping());
      if (process.env.USER_TYPE === 'ant') {
        void import('../../utils/sdkHeapDumpMonitor.js').then(m => m.startSdkMemoryMonitor());
      }
    }

    profileCheckpoint('before_print_import');
    const { runHeadless } = await import('src/cli/print.js');
    profileCheckpoint('after_print_import');
    void runHeadless(
      inputPrompt,
      () => headlessStore.getState(),
      headlessStore.setState,
      commandsHeadless,
      tools,
      sdkMcpConfigs,
      agentDefinitions.activeAgents,
      {
        continue: options.continue,
        resume: options.resume,
        verbose: verbose,
        outputFormat: outputFormat,
        jsonSchema,
        permissionPromptToolName: options.permissionPromptTool,
        allowedTools,
        thinkingConfig,
        maxTurns: options.maxTurns,
        maxBudgetUsd: options.maxBudgetUsd,
        taskBudget: options.taskBudget ? { total: options.taskBudget } : undefined,
        systemPrompt,
        appendSystemPrompt,
        userSpecifiedModel: effectiveModel,
        fallbackModel: userSpecifiedFallbackModel,
        sdkUrl,
        replayUserMessages: effectiveReplayUserMessages,
        includePartialMessages: effectiveIncludePartialMessages,
        forkSession: options.forkSession || false,
        resumeSessionAt: options.resumeSessionAt || undefined,
        rewindFiles: options.rewindFiles,
        enableAuthStatus: options.enableAuthStatus,
        agent: agentCli,
        workload: options.workload,
        setupTrigger: setupTrigger ?? undefined,
        sessionStartHooksPromise,
      },
    );
    return;
  }

  // Log model config at startup
  logEvent('tengu_startup_manual_model_config', {
    cli_flag: options.model as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    env_var: process.env.ANTHROPIC_MODEL as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    settings_file: (getInitialSettings() || {}).model as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    agent: agentSetting as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  });

  // Get deprecation warning for the initial model (resolvedInitialModel computed earlier for hooks parallelization)
  const deprecationWarning = getModelDeprecationWarning(resolvedInitialModel);

  // Build initial notification queue
  const initialNotifications: Array<{
    key: string;
    text: string;
    color?: 'warning';
    priority: 'high';
  }> = [];
  if (permissionModeNotification) {
    initialNotifications.push({
      key: 'permission-mode-notification',
      text: permissionModeNotification,
      priority: 'high',
    });
  }
  if (deprecationWarning) {
    initialNotifications.push({
      key: 'model-deprecation-warning',
      text: deprecationWarning,
      color: 'warning',
      priority: 'high',
    });
  }
  if (overlyBroadBashPermissions.length > 0) {
    const displayList = uniq(overlyBroadBashPermissions.map(p => p.ruleDisplay));
    const displays = displayList.join(', ');
    const sources = uniq(overlyBroadBashPermissions.map(p => p.sourceDisplay)).join(', ');
    const n = displayList.length;
    initialNotifications.push({
      key: 'overly-broad-bash-notification',
      text: `${displays} allow ${plural(n, 'rule')} from ${sources} ${plural(n, 'was', 'were')} ignored \u2014 not available for Ants, please use auto-mode instead`,
      color: 'warning',
      priority: 'high',
    });
  }

  const teammateUtils = getTeammateUtils();
  const effectiveToolPermissionContext = {
    ...toolPermissionContext,
    mode:
      isAgentSwarmsEnabled() && teammateUtils?.isPlanModeRequired?.() ? ('plan' as const) : toolPermissionContext.mode,
  };
  // All startup opt-in paths (--tools, --brief, defaultView) have fired
  // above; initialIsBriefOnly just reads the resulting state.
  const initialIsBriefOnly = feature('KAIROS') || feature('KAIROS_BRIEF') ? getUserMsgOptIn() : false;
  const initialState: AppState = {
    settings: getInitialSettings(),
    tasks: {},
    agentNameRegistry: new Map(),
    verbose: verbose ?? getGlobalConfig().verbose ?? false,
    mainLoopModel: initialMainLoopModel,
    mainLoopModelForSession: null,
    isBriefOnly: initialIsBriefOnly,
    expandedView: getGlobalConfig().showSpinnerTree
      ? 'teammates'
      : getGlobalConfig().showExpandedTodos
        ? 'tasks'
        : 'none',
    showTeammateMessagePreview: isAgentSwarmsEnabled() ? false : undefined,
    selectedIPAgentIndex: -1,
    selectedBgAgentIndex: -1,
    coordinatorTaskIndex: -1,
    viewSelectionMode: 'none',
    footerSelection: null,
    toolPermissionContext: effectiveToolPermissionContext,
    agent: mainThreadAgentDefinition?.agentType,
    agentDefinitions,
    mcp: {
      clients: [],
      tools: [],
      commands: [],
      resources: {},
      pluginReconnectKey: 0,
    },
    plugins: {
      enabled: [],
      disabled: [],
      commands: [],
      errors: [],
      installationStatus: {
        marketplaces: [],
        plugins: [],
      },
      needsRefresh: false,
    },
    statusLineText: undefined,
    kairosEnabled: false,
    remoteSessionUrl: undefined,
    remoteConnectionStatus: 'connecting',
    remoteBackgroundTaskCount: 0,
    notifications: {
      current: null,
      queue: initialNotifications,
    },
    elicitation: {
      queue: [],
    },
    todos: {},
    remoteAgentTaskSuggestions: [],
    fileHistory: {
      snapshots: [],
      trackedFiles: new Set(),
      snapshotSequence: 0,
    },
    attribution: createEmptyAttributionState(),
    thinkingEnabled,
    promptSuggestionEnabled: shouldEnablePromptSuggestion(),
    sessionHooks: new Map(),
    inbox: {
      messages: [],
    },
    promptSuggestion: {
      text: null,
      promptId: null,
      shownAt: 0,
      acceptedAt: 0,
      generationRequestId: null,
    },
    speculation: IDLE_SPECULATION_STATE,
    speculationSessionTimeSavedMs: 0,
    skillImprovement: {
      suggestion: null,
    },
    workerSandboxPermissions: {
      queue: [],
      selectedIndex: 0,
    },
    pendingWorkerRequest: null,
    pendingSandboxRequest: null,
    authVersion: 0,
    initialMessage: inputPrompt
      ? {
          message: createUserMessage({
            content: String(inputPrompt),
          }),
        }
      : null,
    effortValue: parseEffortValue(options.effort) ?? getInitialEffortSetting(),
    activeOverlays: new Set<string>(),
    fastMode: getInitialFastModeSetting(resolvedInitialModel),
    ...(isAdvisorEnabled() && advisorModel && { advisorModel }),
    // Compute teamContext synchronously to avoid useEffect setState during render.
    teamContext: computeInitialTeamContext() as AppState['teamContext'],
  };

  // Add CLI initial prompt to history
  if (inputPrompt) {
    addToHistory(String(inputPrompt));
  }

  const initialTools = mcpTools;

  // Increment numStartups synchronously — first-render readers like
  // shouldShowEffortCallout (via useState initializer) need the updated
  // value before setImmediate fires. Defer only telemetry.
  saveGlobalConfig(current => ({
    ...current,
    numStartups: (current.numStartups ?? 0) + 1,
  }));
  setImmediate(() => {
  });

  // Set up per-turn session environment data uploader (ant-only build).
  // Default-enabled for all ant users when working in an Anthropic-owned
  // repo. Captures git/filesystem state (NOT transcripts) at each turn so
  // environments can be recreated at any user message index. Gating:
  //   - Build-time: this import is stubbed in external builds.
  //   - Runtime: uploader checks github.com/anthropics/* remote + gcloud auth.
  //   - Safety: CLAUDE_CODE_DISABLE_SESSION_DATA_UPLOAD=1 bypasses (tests set this).
  // Import is dynamic + async to avoid adding startup latency.
  const sessionUploaderPromise = process.env.USER_TYPE === 'ant' ? import('../../utils/sessionDataUploader.js') : null;

  // Defer session uploader resolution to the onTurnComplete callback to avoid
  // adding a new top-level await in main.tsx (performance-critical path).
  // The per-turn auth logic in sessionDataUploader.ts handles unauthenticated
  // state gracefully (re-checks each turn, so auth recovery mid-session works).
  const uploaderReady = sessionUploaderPromise
    ? sessionUploaderPromise.then(mod => mod.createSessionTurnUploader()).catch(() => null)
    : null;

  const sessionConfig = {
    debug: debug || debugToStderr,
    commands: [...commands, ...mcpCommands],
    initialTools,
    mcpClients,
    autoConnectIdeFlag: ide,
    mainThreadAgentDefinition,
    disableSlashCommands,
    dynamicMcpConfig,
    strictMcpConfig,
    systemPrompt,
    appendSystemPrompt,
    taskListId,
    thinkingConfig,
    ...(uploaderReady && {
      onTurnComplete: (messages: MessageType[]) => {
        void uploaderReady.then(uploader => (uploader as ((msgs: MessageType[]) => void) | null)?.(messages));
      },
    }),
  };

  // Shared context for processResumedConversation calls
  const resumeContext = {
    modeApi: coordinatorModeModule,
    mainThreadAgentDefinition,
    agentDefinitions,
    currentCwd,
    cliAgents,
    initialState,
  };

  if (options.continue) {
    // Continue the most recent conversation directly
    let resumeSucceeded = false;
    try {
      const resumeStart = performance.now();

      // Clear stale caches before resuming to ensure fresh file/skill discovery
      const { clearSessionCaches } = await import('../../commands/clear/caches.js');
      clearSessionCaches();

      const result = await loadConversationForResume(undefined /* sessionId */, undefined /* sourceFile */);
      if (!result) {
        logEvent('tengu_continue', {
          success: false,
        });
        return await exitWithError(root, 'No conversation found to continue');
      }

      const loaded = await processResumedConversation(
        result,
        {
          forkSession: !!options.forkSession,
          includeAttribution: true,
          transcriptPath: result.fullPath,
        },
        resumeContext,
      );

      if (loaded.restoredAgentDef) {
        mainThreadAgentDefinition = loaded.restoredAgentDef;
      }

      maybeActivateProactive(options);
      maybeActivateBrief(options);

      logEvent('tengu_continue', {
        success: true,
        resume_duration_ms: Math.round(performance.now() - resumeStart),
      });
      resumeSucceeded = true;

      await launchRepl(
        root,
        {
          getFpsMetrics,
          stats,
          initialState: loaded.initialState,
        },
        {
          ...sessionConfig,
          mainThreadAgentDefinition: loaded.restoredAgentDef ?? mainThreadAgentDefinition,
          initialMessages: loaded.messages,
          initialFileHistorySnapshots: loaded.fileHistorySnapshots,
          initialContentReplacements: loaded.contentReplacements,
          initialAgentName: loaded.agentName,
          initialAgentColor: loaded.agentColor,
        },
        renderAndRun,
      );
    } catch (error) {
      if (!resumeSucceeded) {
        logEvent('tengu_continue', {
          success: false,
        });
      }
      logError(error);
      process.exit(1);
    }
  } else if (feature('DIRECT_CONNECT') && _pendingConnect?.url) {
    // `claude connect <url>` — full interactive TUI connected to a remote server
    let directConnectConfig;
    try {
      const session = await createDirectConnectSession({
        serverUrl: _pendingConnect.url,
        authToken: _pendingConnect.authToken,
        cwd: getOriginalCwd(),
        dangerouslySkipPermissions: _pendingConnect.dangerouslySkipPermissions,
      });
      if (session.workDir) {
        setOriginalCwd(session.workDir);
        setCwdState(session.workDir);
      }
      setDirectConnectServerUrl(_pendingConnect.url);
      directConnectConfig = session.config;
    } catch (err) {
      return await exitWithError(root, err instanceof DirectConnectError ? err.message : String(err), () =>
        gracefulShutdown(1),
      );
    }

    const connectInfoMessage = createSystemMessage(
      `Connected to server at ${_pendingConnect.url}\nSession: ${directConnectConfig.sessionId}`,
      'info',
    );

    await launchRepl(
      root,
      { getFpsMetrics, stats, initialState },
      {
        debug: debug || debugToStderr,
        commands,
        initialTools: [],
        initialMessages: [connectInfoMessage],
        mcpClients: [],
        autoConnectIdeFlag: ide,
        mainThreadAgentDefinition,
        disableSlashCommands,
        directConnectConfig,
        thinkingConfig,
      },
      renderAndRun,
    );
    return;
  } else if (isSshRemoteEnabled() && _pendingSSH.host) {
    // `claude ssh <host> [dir]` — probe remote, deploy binary if needed,
    // spawn ssh with unix-socket -R forward to a local auth proxy, hand
    // the REPL an SSHSession. Tools run remotely, UI renders locally.
    // `--local` skips probe/deploy/ssh and spawns the current binary
    // directly with the same env — e2e test of the proxy/auth plumbing.
    const { createSSHSession, createLocalSSHSession, SSHSessionError } = await import('../../ssh/createSSHSession.js');
    let sshSession: import('../../ssh/createSSHSession.js').SSHSession | undefined;
    try {
      if (_pendingSSH.local) {
        process.stderr.write('Starting local ssh-proxy test session...\n');
        sshSession = await createLocalSSHSession({
          cwd: _pendingSSH.cwd,
          permissionMode: _pendingSSH.permissionMode,
          dangerouslySkipPermissions: _pendingSSH.dangerouslySkipPermissions,
        });
      } else {
        process.stderr.write(`Connecting to ${_pendingSSH.host}…\n`);
        // In-place progress: \r + EL0 (erase to end of line). Final \n on
        // success so the next message lands on a fresh line. No-op when
        // stderr isn't a TTY (piped/redirected) — \r would just emit noise.
        const isTTY = process.stderr.isTTY;
        let hadProgress = false;
        sshSession = await createSSHSession(
          {
            host: _pendingSSH.host,
            cwd: _pendingSSH.cwd,
            localVersion: MACRO.VERSION,
            permissionMode: _pendingSSH.permissionMode,
            dangerouslySkipPermissions: _pendingSSH.dangerouslySkipPermissions,
            extraCliArgs: _pendingSSH.extraCliArgs,
            remoteBin: _pendingSSH.remoteBin,
          },
          isTTY
            ? {
                onProgress: (msg: string) => {
                  hadProgress = true;
                  process.stderr.write(`\r  ${msg}\x1b[K`);
                },
              }
            : {},
        );
        if (hadProgress) process.stderr.write('\n');
      }
      setOriginalCwd(sshSession.remoteCwd);
      setCwdState(sshSession.remoteCwd);
      setDirectConnectServerUrl(_pendingSSH.local ? 'local' : _pendingSSH.host);
    } catch (err) {
      return await exitWithError(root, err instanceof SSHSessionError ? err.message : String(err), () =>
        gracefulShutdown(1),
      );
    }

    const sshInfoMessage = createSystemMessage(
      _pendingSSH.local
        ? `Local ssh-proxy test session\ncwd: ${sshSession.remoteCwd}\nAuth: unix socket → local proxy`
        : `SSH session to ${_pendingSSH.host}\nRemote cwd: ${sshSession.remoteCwd}\nAuth: unix socket -R → local proxy`,
      'info',
    );

    await launchRepl(
      root,
      { getFpsMetrics, stats, initialState },
      {
        debug: debug || debugToStderr,
        commands,
        initialTools: [],
        initialMessages: [sshInfoMessage],
        mcpClients: [],
        autoConnectIdeFlag: ide,
        mainThreadAgentDefinition,
        disableSlashCommands,
        sshSession,
        thinkingConfig,
      },
      renderAndRun,
    );
    return;
  } else if (options.resume || options.fromPr) {
    // Handle resume flow - from file (ant-only), session ID, or interactive selector

    // Clear stale caches before resuming to ensure fresh file/skill discovery
    const { clearSessionCaches } = await import('../../commands/clear/caches.js');
    clearSessionCaches();

    let messages: MessageType[] | null = null;
    let processedResume: ProcessedResume | undefined;

    let maybeSessionId = validateUuid(options.resume);
    let searchTerm: string | undefined;
    // Store full LogOption when found by custom title (for cross-worktree resume)
    let matchedLog: LogOption | null = null;
    // PR filter for --from-pr flag
    let filterByPr: boolean | number | string | undefined;

    // Handle --from-pr flag
    if (options.fromPr) {
      if (options.fromPr === true) {
        // Show all sessions with linked PRs
        filterByPr = true;
      } else if (typeof options.fromPr === 'string') {
        // Could be a PR number or URL
        filterByPr = options.fromPr;
      }
    }

    // If resume value is not a UUID, try exact match by custom title first
    if (options.resume && typeof options.resume === 'string' && !maybeSessionId) {
      const trimmedValue = options.resume.trim();
      if (trimmedValue) {
        const matches = await searchSessionsByCustomTitle(trimmedValue, {
          exact: true,
        });

        if (matches.length === 1) {
          // Exact match found - store full LogOption for cross-worktree resume
          matchedLog = matches[0]!;
          maybeSessionId = getSessionIdFromLog(matchedLog) ?? null;
        } else {
          // No match or multiple matches - use as search term for picker
          searchTerm = trimmedValue;
        }
      }
    }

    if (process.env.USER_TYPE === 'ant') {
      if (options.resume && typeof options.resume === 'string' && !maybeSessionId) {
        const resolvedPath = resolve(options.resume);
        try {
          const resumeStart = performance.now();
          let logOption;
          try {
            // Attempt to load as a transcript file; ENOENT falls through to session-ID handling
            logOption = await loadTranscriptFromFile(resolvedPath);
          } catch (error) {
            if (!isENOENT(error)) throw error;
            // ENOENT: not a file path — fall through to session-ID handling
          }
          if (logOption) {
            const result = await loadConversationForResume(logOption, undefined /* sourceFile */);
            if (result) {
              processedResume = await processResumedConversation(
                result,
                {
                  forkSession: !!options.forkSession,
                  transcriptPath: result.fullPath,
                },
                resumeContext,
              );
              if (processedResume.restoredAgentDef) {
                mainThreadAgentDefinition = processedResume.restoredAgentDef;
              }
              logEvent('tengu_session_resumed', {
                entrypoint: 'file' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                success: true,
                resume_duration_ms: Math.round(performance.now() - resumeStart),
              });
            } else {
              logEvent('tengu_session_resumed', {
                entrypoint: 'file' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                success: false,
              });
            }
          }
        } catch (error) {
          logEvent('tengu_session_resumed', {
            entrypoint: 'file' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
            success: false,
          });
          logError(error);
          await exitWithError(root, `Unable to load transcript from file: ${options.resume}`, () =>
            gracefulShutdown(1),
          );
        }
      }
    }

    // If not loaded as a file, try as session ID
    if (maybeSessionId) {
      // Resume specific session by ID
      const sessionId = maybeSessionId;
      try {
        const resumeStart = performance.now();
        // Use matchedLog if available (for cross-worktree resume by custom title)
        // Otherwise fall back to sessionId string (for direct UUID resume)
        const result = await loadConversationForResume(matchedLog ?? sessionId, undefined);

        if (!result) {
          logEvent('tengu_session_resumed', {
            entrypoint: 'cli_flag' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
            success: false,
          });
          return await exitWithError(root, `No conversation found with session ID: ${sessionId}`);
        }

        const fullPath = matchedLog?.fullPath ?? result.fullPath;
        processedResume = await processResumedConversation(
          result,
          {
            forkSession: !!options.forkSession,
            sessionIdOverride: sessionId,
            transcriptPath: fullPath,
          },
          resumeContext,
        );

        if (processedResume.restoredAgentDef) {
          mainThreadAgentDefinition = processedResume.restoredAgentDef;
        }
        logEvent('tengu_session_resumed', {
          entrypoint: 'cli_flag' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          success: true,
          resume_duration_ms: Math.round(performance.now() - resumeStart),
        });
      } catch (error) {
        logEvent('tengu_session_resumed', {
          entrypoint: 'cli_flag' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          success: false,
        });
        logError(error);
        await exitWithError(root, `Failed to resume session ${sessionId}`);
      }
    }

    // If we have a processed resume or teleport messages, render the REPL
    const resumeData =
      processedResume ??
      (Array.isArray(messages)
        ? {
            messages,
            fileHistorySnapshots: undefined,
            agentName: undefined,
            agentColor: undefined as AgentColorName | undefined,
            restoredAgentDef: mainThreadAgentDefinition,
            initialState,
            contentReplacements: undefined,
          }
        : undefined);
    if (resumeData) {
      maybeActivateProactive(options);
      maybeActivateBrief(options);

      await launchRepl(
        root,
        {
          getFpsMetrics,
          stats,
          initialState: resumeData.initialState,
        },
        {
          ...sessionConfig,
          mainThreadAgentDefinition: resumeData.restoredAgentDef ?? mainThreadAgentDefinition,
          initialMessages: resumeData.messages,
          initialFileHistorySnapshots: resumeData.fileHistorySnapshots,
          initialContentReplacements: resumeData.contentReplacements,
          initialAgentName: resumeData.agentName,
          initialAgentColor: resumeData.agentColor,
        },
        renderAndRun,
      );
    } else {
      // Show interactive selector (includes same-repo worktrees)
      // Note: ResumeConversation loads logs internally to ensure proper GC after selection
      await launchResumeChooser(root, { getFpsMetrics, stats, initialState }, getWorktreePaths(getOriginalCwd()), {
        ...sessionConfig,
        initialSearchQuery: searchTerm,
        forkSession: options.forkSession,
        filterByPr,
      });
    }
  } else {
    // Pass unresolved hooks promise to REPL so it can render immediately
    // instead of blocking ~500ms waiting for SessionStart hooks to finish.
    // REPL will inject hook messages when they resolve and await them before
    // the first API call so the model always sees hook context.
    const pendingHookMessages = hooksPromise && hookMessages.length === 0 ? hooksPromise : undefined;

    profileCheckpoint('action_after_hooks');
    maybeActivateProactive(options);
    maybeActivateBrief(options);
    // Persist the current mode for fresh sessions so future resumes know what mode was used
    if (feature('COORDINATOR_MODE')) {
      saveMode(coordinatorModeModule?.isCoordinatorMode() ? 'coordinator' : 'normal');
    }

    // If launched via a deep link, show a provenance banner so the user
    // knows the session originated externally. Linux xdg-open and
    // browsers with "always allow" set dispatch the link with no OS-level
    // confirmation, so this is the only signal the user gets that the
    // prompt — and the working directory / CLAUDE.md it implies — came
    // from an external source rather than something they typed.
    let deepLinkBanner: ReturnType<typeof createSystemMessage> | null = null;
    if (feature('LODESTONE')) {
      if (options.deepLinkOrigin) {
        logEvent('tengu_deep_link_opened', {
          has_prefill: Boolean(options.prefill),
          has_repo: Boolean(options.deepLinkRepo),
        });
        deepLinkBanner = createSystemMessage(
          buildDeepLinkBanner({
            cwd: getCwd(),
            prefillLength: options.prefill?.length,
            repo: options.deepLinkRepo,
            lastFetch: options.deepLinkLastFetch !== undefined ? new Date(options.deepLinkLastFetch) : undefined,
          }),
          'warning',
        );
      } else if (options.prefill) {
        deepLinkBanner = createSystemMessage(
          'Launched with a pre-filled prompt — review it before pressing Enter.',
          'warning',
        );
      }
    }
    const initialMessages = deepLinkBanner
      ? [deepLinkBanner, ...hookMessages]
      : hookMessages.length > 0
        ? hookMessages
        : undefined;

    await launchRepl(
      root,
      { getFpsMetrics, stats, initialState },
      {
        ...sessionConfig,
        initialMessages,
        pendingHookMessages,
      },
      renderAndRun,
    );
  }
}
