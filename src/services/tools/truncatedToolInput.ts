export const TRUNCATED_TOOL_INPUT_MARKER =
  '__claude_code_truncated_tool_input__'

export type TruncatedToolInput = {
  [TRUNCATED_TOOL_INPUT_MARKER]: true
  reason: 'max_tokens'
  receivedChars: number
}

export function createTruncatedToolInput(
  receivedChars: number,
): TruncatedToolInput {
  return {
    [TRUNCATED_TOOL_INPUT_MARKER]: true,
    reason: 'max_tokens',
    receivedChars,
  }
}

export function isTruncatedToolInput(
  value: unknown,
): value is TruncatedToolInput {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<string, unknown>)[TRUNCATED_TOOL_INPUT_MARKER] === true
  )
}
