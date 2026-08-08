import { MAX_CHROME_DOM_MCP_OUTPUT_BYTES } from '../protocol/index.js'

export class ChromeDomOutputLimitError extends Error {
  readonly code = 'DOM_MCP_OUTPUT_TOO_LARGE'

  constructor(
    readonly actualBytes: number,
    readonly limitBytes: number,
  ) {
    super(
      `Chrome DOM MCP output requires ${actualBytes} bytes and exceeds the ${limitBytes}-byte limit`,
    )
    this.name = 'ChromeDomOutputLimitError'
  }
}

export function chromeDomJsonBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8')
}

export function assertChromeDomMcpOutputWithinLimit(
  value: unknown,
  limitBytes = MAX_CHROME_DOM_MCP_OUTPUT_BYTES,
): number {
  if (
    !Number.isInteger(limitBytes) ||
    limitBytes < 1 ||
    limitBytes > MAX_CHROME_DOM_MCP_OUTPUT_BYTES
  ) {
    throw new Error(
      `Chrome DOM MCP output limit must be between 1 and ${MAX_CHROME_DOM_MCP_OUTPUT_BYTES} bytes`,
    )
  }
  const actualBytes = chromeDomJsonBytes(value)
  if (actualBytes > limitBytes) {
    throw new ChromeDomOutputLimitError(actualBytes, limitBytes)
  }
  return actualBytes
}
