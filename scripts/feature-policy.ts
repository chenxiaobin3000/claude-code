export type FeatureTier = 'stable' | 'experimental' | 'internal'

export type FeatureDefinition = {
  tier: FeatureTier
  default?: boolean
  requires?: readonly string[]
  conflicts?: readonly string[]
  acceptance?: readonly string[]
}

const stable = (
  acceptance: readonly string[],
  enabled = true,
): FeatureDefinition => ({
  tier: 'stable',
  default: enabled,
  acceptance,
})
const experimental = (requires?: readonly string[]): FeatureDefinition => ({
  tier: 'experimental',
  requires,
})
const internal = (requires?: readonly string[]): FeatureDefinition => ({
  tier: 'internal',
  requires,
})

export const FEATURE_POLICY: Record<string, FeatureDefinition> = {
  ABLATION_BASELINE: experimental(),
  ACP: stable(['workspace-smoke', 'cli-startup']),
  AGENT_MEMORY_SNAPSHOT: experimental(),
  AGENT_TRIGGERS: stable(['tool-call']),
  AUTO_THEME: stable(['cli-startup'], false),
  AUTOFIX_PR: stable(['cli-startup']),
  AWAY_SUMMARY: stable(['model-request']),
  BASH_CLASSIFIER: experimental(),
  BG_SESSIONS: stable(['cli-startup']),
  BREAK_CACHE_COMMAND: experimental(),
  BUDDY: stable(['cli-startup']),
  BUILTIN_EXPLORE_PLAN_AGENTS: stable(['tool-call']),
  CACHED_MICROCOMPACT: experimental(),
  CHICAGO_MCP: internal(),
  COMMIT_ATTRIBUTION: stable(['shell-parsers']),
  COMPACTION_REMINDERS: experimental(),
  CONNECTOR_TEXT: stable(['message-conversion', 'sdk-compat']),
  CONTEXT_COLLAPSE: experimental(),
  COORDINATOR_MODE: internal(),
  COWORKER_TYPE_TELEMETRY: internal(),
  DAEMON: internal(),
  DIRECT_CONNECT: internal(),
  DUMP_SYSTEM_PROMPT: internal(),
  ENHANCED_TELEMETRY_BETA: experimental(),
  EXPERIMENTAL_SEARCH_EXTRA_TOOLS: experimental(['EXPERIMENTAL_SKILL_SEARCH']),
  EXPERIMENTAL_SKILL_SEARCH: experimental(),
  EXTRACT_MEMORIES: experimental(),
  FORK_SUBAGENT: experimental(),
  GOAL: stable(['session-transcript']),
  HARD_FAIL: internal(),
  HISTORY_PICKER: experimental(),
  HISTORY_SNIP: experimental(),
  HOOK_PROMPTS: experimental(),
  IS_LIBC_GLIBC: internal(),
  IS_LIBC_MUSL: internal(),
  KAIROS: internal(),
  KAIROS_BRIEF: internal(['KAIROS']),
  KAIROS_CHANNELS: internal(['KAIROS']),
  KAIROS_GITHUB_WEBHOOKS: internal(['KAIROS']),
  LAN_PIPES: internal(['UDS_INBOX']),
  LODESTONE: experimental(),
  MCP_RICH_OUTPUT: experimental(),
  MCP_SKILLS: experimental(),
  MEMORY_SHAPE_TELEMETRY: internal(),
  MESSAGE_ACTIONS: experimental(),
  MONITOR_TOOL: stable(['tool-call', 'shell-parsers']),
  NATIVE_CLIPBOARD_IMAGE: experimental(),
  NEW_INIT: experimental(),
  PERFETTO_TRACING: internal(),
  PIPE_IPC: internal(['UDS_INBOX']),
  POOR: {
    ...stable(['model-request']),
    conflicts: ['EXTRACT_MEMORIES', 'VERIFICATION_AGENT'],
  },
  POWERSHELL_AUTO_MODE: experimental(),
  PROACTIVE: experimental(),
  PROMPT_CACHE_BREAK_DETECTION: stable(['model-diagnostics']),
  QUICK_SEARCH: experimental(),
  REACTIVE_COMPACT: experimental(),
  RUN_SKILL_GENERATOR: experimental(),
  SHOT_STATS: internal(),
  SKILL_IMPROVEMENT: experimental(),
  SKILL_LEARNING: experimental(),
  SLOW_OPERATION_LOGGING: internal(),
  SSH_REMOTE: stable(['cli-startup']),
  STREAMLINED_OUTPUT: experimental(),
  TEAMMEM: experimental(['COORDINATOR_MODE']),
  TEMPLATES: stable(['cli-startup']),
  TERMINAL_PANEL: experimental(),
  TOKEN_BUDGET: stable(['model-usage']),
  TORCH: experimental(),
  TRANSCRIPT_CLASSIFIER: stable(['message-conversion']),
  TREE_SITTER_BASH: experimental(),
  TREE_SITTER_BASH_SHADOW: experimental(['TREE_SITTER_BASH']),
  UDS_INBOX: internal(),
  ULTRAPLAN: experimental(),
  ULTRATHINK: stable(['model-request']),
  UNATTENDED_RETRY: experimental(),
  VERIFICATION_AGENT: experimental(),
  WEB_BROWSER_TOOL: experimental(),
  WORKFLOW_SCRIPTS: stable(['workspace-smoke', 'tool-call']),
}

export const DEFAULT_BUILD_FEATURES = Object.freeze(
  Object.entries(FEATURE_POLICY)
    .filter(
      ([, definition]) => definition.tier === 'stable' && definition.default,
    )
    .map(([name]) => name),
)

/** Source-controlled runtime values formerly supplied by remote Feature Flags. */
export const RUNTIME_FEATURE_DEFAULTS: Readonly<Record<string, unknown>> = Object.freeze({
  tengu_keybinding_customization_release: true,
  tengu_streaming_tool_execution2: true,
  tengu_kairos_cron: true,
  tengu_amber_json_tools: true,
  tengu_immediate_model_command: true,
  tengu_basalt_3kr: true,
  tengu_pebble_leaf_prune: true,
  tengu_chair_sermon: true,
  tengu_lodestone_enabled: true,
  tengu_auto_background_agents: true,
  tengu_fgts: true,
  tengu_session_memory: true,
  tengu_passport_quail: true,
  tengu_moth_copse: true,
  tengu_coral_fern: true,
  tengu_chomp_inflection: true,
  tengu_hive_evidence: true,
  tengu_kairos_brief: true,
  tengu_kairos_brief_config: { enable_slash_command: true },
  tengu_sedge_lantern: true,
  tengu_onyx_plover: { enabled: true },
  tengu_willow_mode: 'dialog',
  tengu_turtle_carbon: true,
  tengu_amber_stoat: true,
  tengu_amber_flint: true,
  tengu_slim_subagent_claudemd: true,
  tengu_birch_trellis: true,
  tengu_collage_kaleidoscope: true,
  tengu_compact_cache_prefix: true,
  tengu_kairos_assistant: true,
  tengu_kairos_cron_durable: true,
  tengu_attribution_header: true,
  tengu_slate_prism: true,
  tengu_review_bughunter_config: { enabled: true },
  tengu_ccr_bundle_seed_enabled: true,
})

function environmentFeatureOverrides(env: NodeJS.ProcessEnv): {
  enabled: string[]
  disabled: string[]
} {
  const enabled: string[] = []
  const disabled: string[] = []
  for (const [key, value] of Object.entries(env)) {
    if (!key.startsWith('FEATURE_')) continue
    const name = key.slice('FEATURE_'.length)
    if (!FEATURE_POLICY[name]) {
      throw new Error(`Unknown feature flag: ${name}`)
    }
    if (value === '0') {
      disabled.push(name)
      continue
    }
    if (value !== '1') {
      throw new Error(`${key} must be 0 or 1`)
    }
    enabled.push(name)
  }
  return { enabled, disabled }
}

export function resolveBuildFeatures(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const overrides = environmentFeatureOverrides(env)
  const enabled = new Set(DEFAULT_BUILD_FEATURES)
  for (const name of overrides.disabled) enabled.delete(name)
  for (const name of overrides.enabled) enabled.add(name)

  for (const name of overrides.enabled) {
    const definition = FEATURE_POLICY[name]!
    if (
      definition.tier === 'experimental' &&
      env.ALLOW_EXPERIMENTAL_FEATURES !== '1'
    ) {
      throw new Error(
        `FEATURE_${name}=1 requires ALLOW_EXPERIMENTAL_FEATURES=1`,
      )
    }
    if (definition.tier === 'internal' && env.ALLOW_INTERNAL_FEATURES !== '1') {
      throw new Error(`FEATURE_${name}=1 requires ALLOW_INTERNAL_FEATURES=1`)
    }
  }

  for (const name of enabled) {
    const definition = FEATURE_POLICY[name]!
    for (const dependency of definition.requires ?? []) {
      if (!enabled.has(dependency)) {
        throw new Error(`${name} requires feature ${dependency}`)
      }
    }
    for (const conflict of definition.conflicts ?? []) {
      if (enabled.has(conflict)) {
        throw new Error(`${name} conflicts with feature ${conflict}`)
      }
    }
  }

  return [...enabled]
}
