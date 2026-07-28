import type { HookInput } from 'src/entrypoints/agentSdkTypes.js'
import { findToolByName, type Tools } from '../../Tool.js'
import {
  normalizeLegacyToolName,
  permissionRuleValueFromString,
} from '../permissions/permissionRuleParser.js'

export type IfConditionMatcher = (ifCondition: string) => boolean

export async function prepareIfConditionMatcher(
  hookInput: HookInput,
  tools: Tools | undefined,
): Promise<IfConditionMatcher | undefined> {
  if (
    hookInput.hook_event_name !== 'PreToolUse' &&
    hookInput.hook_event_name !== 'PostToolUse' &&
    hookInput.hook_event_name !== 'PostToolUseFailure' &&
    hookInput.hook_event_name !== 'PermissionRequest'
  ) {
    return undefined
  }

  const toolName = normalizeLegacyToolName(hookInput.tool_name as string)
  const tool = tools && findToolByName(tools, hookInput.tool_name as string)
  const input = tool?.inputSchema.safeParse(hookInput.tool_input)
  const matchRule =
    input?.success && tool?.preparePermissionMatcher
      ? await tool.preparePermissionMatcher(input.data)
      : undefined

  return condition => {
    const parsed = permissionRuleValueFromString(condition)
    if (normalizeLegacyToolName(parsed.toolName) !== toolName) return false
    if (!parsed.ruleContent) return true
    return matchRule ? matchRule(parsed.ruleContent) : false
  }
}
