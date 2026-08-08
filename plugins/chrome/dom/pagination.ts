import { createHmac, timingSafeEqual } from 'node:crypto'

export const CHROME_DOM_CURSOR_VERSION = 1 as const

export interface ChromeDomCursorBinding {
  profileId: string
  tabId: number
  documentId: string
  contentHash: string
}

export interface ChromeDomCursorPayload extends ChromeDomCursorBinding {
  version: typeof CHROME_DOM_CURSOR_VERSION
  offset: number
}

function validateBinding(binding: ChromeDomCursorBinding): void {
  if (
    !binding.profileId ||
    !Number.isSafeInteger(binding.tabId) ||
    binding.tabId < 0 ||
    !binding.documentId ||
    !binding.contentHash
  ) {
    throw new Error('Invalid Chrome DOM cursor binding')
  }
}

function signature(payload: string, secret: string): Buffer {
  if (secret.length < 16) {
    throw new Error('Chrome DOM cursor secret must contain at least 16 characters')
  }
  return createHmac('sha256', secret).update(payload).digest()
}

export function createChromeDomCursor(
  binding: ChromeDomCursorBinding,
  offset: number,
  secret: string,
): string {
  validateBinding(binding)
  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw new Error('Chrome DOM cursor offset must be a non-negative integer')
  }
  const payload = Buffer.from(
    JSON.stringify({
      version: CHROME_DOM_CURSOR_VERSION,
      ...binding,
      offset,
    } satisfies ChromeDomCursorPayload),
    'utf8',
  ).toString('base64url')
  return `${payload}.${signature(payload, secret).toString('base64url')}`
}

export function parseChromeDomCursor(
  cursor: string,
  expected: ChromeDomCursorBinding,
  secret: string,
): ChromeDomCursorPayload {
  validateBinding(expected)
  const [payload, encodedSignature, extra] = cursor.split('.')
  if (!payload || !encodedSignature || extra !== undefined) {
    throw new Error('Invalid Chrome DOM cursor format')
  }
  const supplied = Buffer.from(encodedSignature, 'base64url')
  const expectedSignature = signature(payload, secret)
  if (
    supplied.length !== expectedSignature.length ||
    !timingSafeEqual(supplied, expectedSignature)
  ) {
    throw new Error('Invalid Chrome DOM cursor signature')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
  } catch {
    throw new Error('Invalid Chrome DOM cursor payload')
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    (parsed as ChromeDomCursorPayload).version !==
      CHROME_DOM_CURSOR_VERSION ||
    !Number.isSafeInteger((parsed as ChromeDomCursorPayload).offset) ||
    (parsed as ChromeDomCursorPayload).offset < 0
  ) {
    throw new Error('Invalid Chrome DOM cursor payload')
  }
  const cursorPayload = parsed as ChromeDomCursorPayload
  if (
    cursorPayload.profileId !== expected.profileId ||
    cursorPayload.tabId !== expected.tabId ||
    cursorPayload.documentId !== expected.documentId ||
    cursorPayload.contentHash !== expected.contentHash
  ) {
    throw new Error('Chrome DOM cursor does not match the current page version')
  }
  return cursorPayload
}
