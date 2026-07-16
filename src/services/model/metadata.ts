import { getSessionId } from '../../bootstrap/state.js'
import { getOrCreateUserID } from '../../utils/config.js'
import { logForDebugging } from '../../utils/debug.js'
import { safeParseJSON } from '../../utils/json.js'
import { jsonStringify } from '../../utils/slowOperations.js'

type JsonValue = string | number | boolean | null | JsonObject | JsonValue[]
type JsonObject = { [key: string]: JsonValue }

/** Provider-neutral local request metadata. No account or login state is read. */
export function getModelRequestMetadata(): { user_id: string } {
  let extra: JsonObject = {}
  const configured = process.env.CLAUDE_CODE_EXTRA_METADATA
  if (configured) {
    const parsed = safeParseJSON(configured, false)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      extra = parsed as JsonObject
    } else {
      logForDebugging(
        `CLAUDE_CODE_EXTRA_METADATA env var must be a JSON object, but was given ${configured}`,
        { level: 'error' },
      )
    }
  }

  return {
    user_id: jsonStringify({
      ...extra,
      device_id: getOrCreateUserID(),
      session_id: getSessionId(),
    }),
  }
}

/** Compatibility name for existing callers. */
export const getAPIMetadata = getModelRequestMetadata
