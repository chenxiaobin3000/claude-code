import type { HookCallback } from '../../types/hooks.js'
import { ALLOWED_OFFICIAL_MARKETPLACE_NAMES } from '../plugins/schemas.js'
import type { HookCommand } from '../settings/types.js'
import { buildHookDedupKey } from './matcher.js'
import type { FunctionHook } from './sessionHooks.js'
import { DEFAULT_HOOK_SHELL } from '../shell/shellProvider.js'

/**
 * A hook paired with optional plugin context.
 * Used when returning matched hooks so we can apply plugin env vars at execution time.
 */
export type MatchedHook = {
  hook: HookCommand | HookCallback | FunctionHook
  pluginRoot?: string
  pluginId?: string
  skillRoot?: string
  hookSource?: string
}

export function isInternalHook(matched: MatchedHook): boolean {
  return matched.hook.type === 'callback' && matched.hook.internal === true
}

/**
 * Build a dedup key for a matched hook, namespaced by source context.
 *
 * Settings-file hooks (no pluginRoot/skillRoot) share the '' prefix so the
 * same command defined in user/project/local still collapses to one — the
 * original intent of the dedup. Plugin/skill hooks get their root as the
 * prefix, so two plugins sharing an unexpanded `${CLAUDE_PLUGIN_ROOT}/hook.sh`
 * template don't collapse: after expansion they point to different files.
 */
export function hookDedupKey(m: MatchedHook, payload: string): string {
  return buildHookDedupKey(m.pluginRoot ?? m.skillRoot, payload)
}

export function deduplicateMatchedHooks(hooks: MatchedHook[]): MatchedHook[] {
  if (
    hooks.every(h => h.hook.type === 'callback' || h.hook.type === 'function')
  ) {
    return hooks
  }
  const groups = ['command', 'prompt', 'agent', 'http', 'mcp'] as const
  const result: MatchedHook[] = []
  for (const type of groups) {
    const unique = new Map<string, MatchedHook>()
    for (const matched of hooks) {
      const hook = matched.hook
      if (hook.type !== type) continue
      const condition = 'if' in hook ? (hook.if ?? '') : ''
      let identity: string
      switch (hook.type) {
        case 'command':
          identity = `${hook.shell ?? DEFAULT_HOOK_SHELL}\0${hook.command}\0${JSON.stringify(hook.args ?? [])}\0${condition}`
          break
        case 'prompt':
        case 'agent':
          identity = `${hook.prompt}\0${condition}`
          break
        case 'http':
          identity = `${hook.url}\0${condition}`
          break
        case 'mcp':
          identity = `${hook.tool}\0${JSON.stringify(hook.input ?? {})}\0${condition}`
          break
      }
      unique.set(hookDedupKey(matched, identity), matched)
    }
    result.push(...unique.values())
  }
  result.push(
    ...hooks.filter(h => h.hook.type === 'callback'),
    ...hooks.filter(h => h.hook.type === 'function'),
  )
  return result
}

/**
 * Build a map of {sanitizedPluginName: hookCount} from matched hooks.
 * Only logs actual names for official marketplace plugins; others become 'third-party'.
 */
export function getPluginHookCounts(
  hooks: MatchedHook[],
): Record<string, number> | undefined {
  const pluginHooks = hooks.filter(h => h.pluginId)
  if (pluginHooks.length === 0) {
    return undefined
  }
  const counts: Record<string, number> = {}
  for (const h of pluginHooks) {
    const atIndex = h.pluginId!.lastIndexOf('@')
    const isOfficial =
      atIndex > 0 &&
      ALLOWED_OFFICIAL_MARKETPLACE_NAMES.has(h.pluginId!.slice(atIndex + 1))
    const key = isOfficial ? h.pluginId! : 'third-party'
    counts[key] = (counts[key] || 0) + 1
  }
  return counts
}

/**
 * Build a map of {hookType: count} from matched hooks.
 */
export function getHookTypeCounts(
  hooks: MatchedHook[],
): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const h of hooks) {
    counts[h.hook.type] = (counts[h.hook.type] || 0) + 1
  }
  return counts
}
