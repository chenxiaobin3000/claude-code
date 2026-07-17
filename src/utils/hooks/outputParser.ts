import type { HookJSONOutput } from 'src/entrypoints/agentSdkTypes.js'
import { hookJSONOutputSchema } from '../../types/hooks.js'
import { logForDebugging } from '../debug.js'
import { jsonParse, jsonStringify } from '../slowOperations.js'

function validateHookJson(
  jsonString: string,
): { json: HookJSONOutput } | { validationError: string } {
  const parsed = jsonParse(jsonString)
  const validation = hookJSONOutputSchema().safeParse(parsed)
  if (validation.success) return { json: validation.data }
  const errors = validation.error.issues
    .map(error => `  - ${error.path.join('.')}: ${error.message}`)
    .join('\n')
  return {
    validationError: `Hook JSON output validation failed:\n${errors}\n\nThe hook's output was: ${jsonStringify(parsed, null, 2)}`,
  }
}

export type ParsedCommandHookOutput = {
  json?: HookJSONOutput
  plainText?: string
  validationError?: string
}

export function parseHookOutput(stdout: string): ParsedCommandHookOutput {
  const trimmed = stdout.trim()
  if (!trimmed.startsWith('{')) return { plainText: stdout }
  try {
    const result = validateHookJson(trimmed)
    if ('json' in result) return result
    const validationError = `${result.validationError}\n\nExpected schema:\n${jsonStringify(
      {
        continue: 'boolean (optional)',
        suppressOutput: 'boolean (optional)',
        stopReason: 'string (optional)',
        decision: '"approve" | "block" (optional)',
        reason: 'string (optional)',
        systemMessage: 'string (optional)',
        permissionDecision: '"allow" | "deny" | "ask" (optional)',
        hookSpecificOutput: {
          PreToolUse: {
            hookEventName: '"PreToolUse"',
            permissionDecision: '"allow" | "deny" | "ask" (optional)',
            permissionDecisionReason: 'string (optional)',
            updatedInput: 'object (optional)',
          },
          UserPromptSubmit: {
            hookEventName: '"UserPromptSubmit"',
            additionalContext: 'string (required)',
          },
          PostToolUse: {
            hookEventName: '"PostToolUse"',
            additionalContext: 'string (optional)',
          },
        },
      },
      null,
      2,
    )}`
    return { plainText: stdout, validationError }
  } catch (error) {
    logForDebugging(`Failed to parse hook output as JSON: ${error}`)
    return { plainText: stdout }
  }
}

export function parseHttpHookOutput(body: string): {
  json?: HookJSONOutput
  validationError?: string
} {
  const trimmed = body.trim()
  if (trimmed === '') {
    const validation = hookJSONOutputSchema().safeParse({})
    if (validation.success) return { json: validation.data }
  }
  if (!trimmed.startsWith('{')) {
    return {
      validationError: `HTTP hook must return JSON, but got non-JSON response body: ${trimmed.length > 200 ? `${trimmed.slice(0, 200)}…` : trimmed}`,
    }
  }
  try {
    return validateHookJson(trimmed)
  } catch (error) {
    return {
      validationError: `HTTP hook must return valid JSON, but parsing failed: ${error}`,
    }
  }
}
