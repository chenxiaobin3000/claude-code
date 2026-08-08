export const MAX_DOM_SELECTOR_LENGTH = 2_048

export function validateDomSelector(value: unknown): string {
  if (typeof value !== 'string') {
    throw new Error('DOM selector must be a string')
  }
  const selector = value.trim()
  if (selector.length === 0 || selector.length > MAX_DOM_SELECTOR_LENGTH) {
    throw new Error(
      `DOM selector must contain 1 to ${MAX_DOM_SELECTOR_LENGTH} characters`,
    )
  }
  if (/\p{Cc}/u.test(selector) || selector.includes('\0')) {
    throw new Error('DOM selector contains control characters')
  }
  if (/:has\s*\(|:host(?:-context)?\s*\(|::part\s*\(/i.test(selector)) {
    throw new Error('DOM selector uses an unsupported expensive boundary')
  }
  return selector
}
