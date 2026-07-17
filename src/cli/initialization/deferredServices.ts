import { getIsNonInteractiveSession } from '../../bootstrap/state.js'
import { getSystemContext, getUserContext } from '../../context.js'
import { initializeAnalyticsGates } from '../../services/analytics/sink.js'
import { getRelevantTips } from '../../services/tips/tipRegistry.js'
import { checkHasTrustDialogAccepted } from '../../utils/config.js'
import { getCwd } from '../../utils/cwd.js'
import { logForDiagnosticsNoPII } from '../../utils/diagLogs.js'
import { isBareMode, isEnvTruthy } from '../../utils/envUtils.js'
import { countFilesRoundedRg } from '../../utils/ripgrep.js'
import { settingsChangeDetector } from '../../utils/settings/changeDetector.js'
import { skillChangeDetector } from '../../utils/skills/skillChangeDetector.js'
import { initUser } from '../../utils/user.js'

function prefetchSystemContextIfSafe(): void {
  if (getIsNonInteractiveSession()) {
    logForDiagnosticsNoPII('info', 'prefetch_system_context_non_interactive')
    void getSystemContext()
    return
  }

  if (checkHasTrustDialogAccepted()) {
    logForDiagnosticsNoPII('info', 'prefetch_system_context_has_trust')
    void getSystemContext()
  } else {
    logForDiagnosticsNoPII('info', 'prefetch_system_context_skipped_no_trust')
  }
}

/** Start background work that is intentionally excluded from the first-render path. */
export function startDeferredPrefetches(): void {
  if (
    isEnvTruthy(process.env.CLAUDE_CODE_EXIT_AFTER_FIRST_RENDER) ||
    isBareMode()
  )
    return

  void initUser()
  void getUserContext()
  prefetchSystemContextIfSafe()
  void getRelevantTips()
  void countFilesRoundedRg(getCwd(), AbortSignal.timeout(3000), [])
  void initializeAnalyticsGates()
  void settingsChangeDetector.initialize()
  if (!isBareMode()) void skillChangeDetector.initialize()

  if (process.env.USER_TYPE === 'ant') {
    void import('../../utils/eventLoopStallDetector.js').then(module =>
      module.startEventLoopStallDetector(),
    )
  }
}
