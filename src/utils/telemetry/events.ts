/** Compatibility facade while event calls are removed from business code. */
export function redactIfDisabled(_content: string): string {
  return '<REDACTED>'
}

export async function logOTelEvent(
  _eventName: string,
  _metadata: { [key: string]: string | undefined } = {},
): Promise<void> {}
