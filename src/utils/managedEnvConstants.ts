/**
 * Environment variables that control inference routing: which provider to use,
 * which endpoint to hit, and which model IDs to send.
 *
 * When CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST is truthy in the spawn env, these
 * are stripped from settings-sourced env so the host's routing config isn't
 * overridden by a user's ~/.claude/settings.json.
 *
 * @[MODEL LAUNCH]: New models usually don't need changes here —
 * New providers or routing config vars (endpoint, project, region, auth) do.
 *
 * OpenAI-compatible endpoint and model routing is loaded from ~/.claude/models.json.
 * Only credentials and request-tuning variables remain environment based.
 */
const PROVIDER_MANAGED_ENV_VARS = new Set([
  // The flag itself — settings can't unset it once the host set it
  'CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST',
  // OpenAI provider specific
  'OPENAI_AUTH_MODE',
  'OPENAI_API_KEY',
  'CLAUDE_CODE_SUBAGENT_MODEL',
])

export function isProviderManagedEnvVar(key: string): boolean {
  const upper = key.toUpperCase()
  return PROVIDER_MANAGED_ENV_VARS.has(upper)
}

/**
 * Dangerous shell settings that can execute arbitrary shell code
 */
export const DANGEROUS_SHELL_SETTINGS = [
  'apiKeyHelper',
  'statusLine',
] as const

/**
 * Safe environment variables that can be applied before trust dialog.
 * These are Claude Code specific settings that don't pose security risks.
 *
 * IMPORTANT: This is the source of truth for which env vars are safe.
 * Any env var NOT in this list is considered dangerous and will trigger
 * a security dialog when set via remote managed settings.
 *
 * Dangerous env vars (NOT in this list):
 *
 * === REDIRECT TO ATTACKER-CONTROLLED SERVER ===
 * - provider base URL overrides
 * - HTTP_PROXY, HTTPS_PROXY, NO_PROXY, http_proxy, https_proxy, no_proxy
 *
 * === TRUST ATTACKER-CONTROLLED SERVER ===
 * - NODE_TLS_REJECT_UNAUTHORIZED
 * - NODE_EXTRA_CA_CERTS
 *
 * === CREDENTIAL OVERRIDE ===
 * - OPENAI_API_KEY
 */
export const SAFE_ENV_VARS = new Set([
  // OpenAI provider specific
  'OPENAI_API_KEY',
  'OPENAI_AUTH_MODE',
  'OPENAI_MAX_TOKENS',
  'OPENAI_ORG_ID',
  'OPENAI_PROJECT_ID',
  'AWS_DEFAULT_REGION',
  'AWS_PROFILE',
  'AWS_REGION',
  'BASH_DEFAULT_TIMEOUT_MS',
  'BASH_MAX_OUTPUT_LENGTH',
  'BASH_MAX_TIMEOUT_MS',
  'CLAUDE_BASH_MAINTAIN_PROJECT_WORKING_DIR',
  'CLAUDE_CODE_API_KEY_HELPER_TTL_MS',
  'CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS',
  'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC',
  'CLAUDE_CODE_DISABLE_TERMINAL_TITLE',
  'CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS',
  'CLAUDE_CODE_IDE_SKIP_AUTO_INSTALL',
  'CLAUDE_CODE_MAX_OUTPUT_TOKENS',
  'CLAUDE_CODE_SUBAGENT_MODEL',
  'DISABLE_BUG_COMMAND',
  'DISABLE_COST_WARNINGS',
  'DISABLE_ERROR_REPORTING',
  'DISABLE_FEEDBACK_COMMAND',
  'ENABLE_SEARCH_EXTRA_TOOLS',
  'MAX_MCP_OUTPUT_TOKENS',
  'MAX_THINKING_TOKENS',
  'MCP_TIMEOUT',
  'MCP_TOOL_TIMEOUT',
  'USE_BUILTIN_RIPGREP',
])
