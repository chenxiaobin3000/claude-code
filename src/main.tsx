// These side-effects must run before all other imports:
// 1. profileCheckpoint marks entry before heavy module evaluation begins
// 2. startMdmRawRead fires MDM subprocesses (plutil/reg query) so they run in
//    parallel with the remaining ~135ms of imports below
// 3. startKeychainPrefetch fires both macOS keychain reads (OAuth + legacy API
//    key) in parallel — isRemoteManagedSettingsEligible() otherwise reads them
//    sequentially via sync spawn inside applySafeConfigEnvironmentVariables()
//    (~65ms on every macOS startup)
import { profileCheckpoint, profileReport } from './utils/startupProfiler.js';

// eslint-disable-next-line custom-rules/no-top-level-side-effects
profileCheckpoint('main_tsx_entry');

import { startMdmRawRead } from './utils/settings/mdm/rawRead.js';

// eslint-disable-next-line custom-rules/no-top-level-side-effects
startMdmRawRead();

import { Command as CommanderCommand } from '@commander-js/extra-typings';

import { registerCommandServiceInitialization } from './cli/initialization/commandServices.js';
import { createProgram } from './cli/arguments/createProgram.js';
import { registerRootCommand } from './cli/arguments/registerRootCommand.js';
import { registerFeatureOptions } from './cli/arguments/registerFeatureOptions.js';
import { shouldUsePrintFastPath } from './cli/modes/startupMode.js';
import { runDefaultMode } from './cli/modes/defaultMode.js';
import {
  extractTeammateOptions,
  logTenguInit,
  maybeActivateBrief,
  maybeActivateProactive,
} from './cli/modes/helpers.js';
import { getInputPrompt } from './cli/startup/input.js';
import { executeStartup, isSshRemoteEnabled, startupRuntimeState } from './cli/startup/prepareStartup.js';
import { logManagedSettings, logSessionTelemetry, logStartupTelemetry } from './cli/startup/telemetry.js';

// eslint-disable-next-line custom-rules/no-top-level-side-effects
profileCheckpoint('main_tsx_imports_loaded');

export async function main() {
  await executeStartup(run);
}
async function run(): Promise<CommanderCommand> {
  profileCheckpoint('run_function_start');

  const program = createProgram();
  profileCheckpoint('run_commander_initialized');

  registerCommandServiceInitialization(program);

  registerRootCommand(program, async (prompt, options) =>
    runDefaultMode(prompt, options, {
      pendingConnect: startupRuntimeState.pendingConnect,
      pendingAssistantChat: startupRuntimeState.pendingAssistantChat,
      pendingSSH: startupRuntimeState.pendingSSH,
      isSshRemoteEnabled,
      getInputPrompt,
      logManagedSettings,
      logSessionTelemetry,
      logStartupTelemetry,
      logTenguInit,
      maybeActivateProactive,
      maybeActivateBrief,
      extractTeammateOptions,
    }),
  );

  registerFeatureOptions(program);
  profileCheckpoint('run_main_options_built');

  // -p/--print mode: skip subcommand registration. The 52 subcommands
  // (mcp, auth, plugin, skill, task, config, doctor, update, etc.) are
  // never dispatched in print mode — commander routes the prompt to the
  // default action. The subcommand registration path was measured at ~65ms
  // on baseline — mostly the isBridgeEnabled() call (25ms settings Zod parse
  // + 40ms sync keychain subprocess), both hidden by the try/catch that
  // always returns false before enableConfigs(). cc:// URLs are rewritten to
  // `open` at main() line ~851 BEFORE this runs, so argv check is safe here.
  if (shouldUsePrintFastPath(process.argv)) {
    profileCheckpoint('run_before_parse');
    await program.parseAsync(process.argv);
    profileCheckpoint('run_after_parse');
    return program;
  }

  const { registerSubcommands } = await import('./cli/arguments/registerSubcommands.js');
  registerSubcommands(program, {
    isSshRemoteEnabled,
    pendingConnect: startupRuntimeState.pendingConnect,
  });
  profileCheckpoint('run_before_parse');
  await program.parseAsync(process.argv);
  profileCheckpoint('run_after_parse');

  // Record final checkpoint for total_time calculation
  profileCheckpoint('main_after_run');

  // Log startup perf to Statsig (sampled) and output detailed report if enabled
  profileReport();

  return program;
}
