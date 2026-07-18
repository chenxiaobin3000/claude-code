/** Anthropic account roles and billing access are not part of this build. */
export function hasConsoleBillingAccess(): boolean {
  return false
}

export function setMockBillingAccessOverride(_value: boolean | null): void {}

export function hasClaudeAiBillingAccess(): boolean {
  return false
}
