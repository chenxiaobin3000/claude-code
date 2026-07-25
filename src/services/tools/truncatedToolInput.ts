export const TRUNCATED_TOOL_INPUT_MARKER =
  '__claude_code_truncated_tool_input__'

export type TruncatedToolInput = {
  [TRUNCATED_TOOL_INPUT_MARKER]: true
  reason: 'max_tokens'
  receivedChars: number
  rawInput?: string
}

export function createTruncatedToolInput(
  receivedChars: number,
  rawInput?: string,
): TruncatedToolInput {
  return {
    [TRUNCATED_TOOL_INPUT_MARKER]: true,
    reason: 'max_tokens',
    receivedChars,
    ...(rawInput !== undefined && { rawInput }),
  }
}

export function createFromRaw(rawInput: string): TruncatedToolInput {
  return createTruncatedToolInput(rawInput.length, rawInput)
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

type ParsedJsonString = {
  value: string
  complete: boolean
  end: number
}

function parseJsonString(raw: string, start: number): ParsedJsonString {
  let value = ''
  for (let index = start + 1; index < raw.length; index++) {
    const char = raw[index]!
    if (char === '"') {
      return { value, complete: true, end: index + 1 }
    }
    if (char !== '\\') {
      value += char
      continue
    }

    const escaped = raw[++index]
    if (escaped === undefined) break
    const simpleEscapes: Record<string, string> = {
      '"': '"',
      '\\': '\\',
      '/': '/',
      b: '\b',
      f: '\f',
      n: '\n',
      r: '\r',
      t: '\t',
    }
    if (escaped in simpleEscapes) {
      value += simpleEscapes[escaped]
      continue
    }
    if (escaped === 'u') {
      const hex = raw.slice(index + 1, index + 5)
      if (!/^[0-9a-fA-F]{4}$/.test(hex)) break
      value += String.fromCharCode(Number.parseInt(hex, 16))
      index += 4
      continue
    }
    break
  }
  return { value, complete: false, end: raw.length }
}

/**
 * Extract a JSON string property even when the outer object or the property
 * value was cut off by max_tokens. Only complete escape sequences are kept.
 */
export function extractPartialJsonStringField(
  raw: string,
  field: string,
): { value: string; complete: boolean } | undefined {
  for (let index = 0; index < raw.length; index++) {
    if (raw[index] !== '"') continue
    const key = parseJsonString(raw, index)
    if (!key.complete) return undefined
    index = key.end - 1
    if (key.value !== field) continue

    let cursor = key.end
    while (/\s/.test(raw[cursor] ?? '')) cursor++
    if (raw[cursor] !== ':') continue
    cursor++
    while (/\s/.test(raw[cursor] ?? '')) cursor++
    if (raw[cursor] !== '"') return undefined
    const value = parseJsonString(raw, cursor)
    return { value: value.value, complete: value.complete }
  }
  return undefined
}
