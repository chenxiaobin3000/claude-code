// Error type constants for the model provider package.
// Error string constants extracted from src/services/api/errors.ts.
// The full error handling functions remain in the main project (Phase 4).

export const API_ERROR_MESSAGE_PREFIX = 'API Error'

export const PROMPT_TOO_LONG_ERROR_MESSAGE = 'Prompt is too long'

export const CREDIT_BALANCE_TOO_LOW_ERROR_MESSAGE = 'Credit balance is too low'
export const INVALID_API_KEY_ERROR_MESSAGE =
  'Provider API key is missing or invalid'
export const INVALID_API_KEY_ERROR_MESSAGE_EXTERNAL =
  'Invalid API key · Fix external API key'
export const CCR_AUTH_ERROR_MESSAGE =
  'Authentication error · This may be a temporary network issue, please try again'
export const REPEATED_529_ERROR_MESSAGE = 'Repeated 529 Overloaded errors'
export const CUSTOM_OFF_SWITCH_MESSAGE =
  'Opus is experiencing high load, please use /model to switch to Sonnet'
export const API_TIMEOUT_ERROR_MESSAGE = 'Request timed out'

/** Error classification types returned by classifyAPIError */
export type APIErrorClassification =
  | 'aborted'
  | 'api_timeout'
  | 'repeated_529'
  | 'capacity_off_switch'
  | 'rate_limit'
  | 'server_overload'
  | 'prompt_too_long'
  | 'pdf_too_large'
  | 'pdf_password_protected'
  | 'image_too_large'
  | 'tool_use_mismatch'
  | 'unexpected_tool_result'
  | 'duplicate_tool_use_id'
  | 'invalid_model'
  | 'credit_balance_low'
  | 'invalid_api_key'
  | 'token_revoked'
  | 'oauth_org_not_allowed'
  | 'auth_error'
  | 'server_error'
  | 'client_error'
  | 'ssl_cert_error'
  | 'connection_error'
  | 'unknown'
