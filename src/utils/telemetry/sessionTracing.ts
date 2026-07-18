/**
 * Temporary local compatibility surface for former tracing hooks. It contains
 * no SDK, context propagation, buffering, exporter, or observable side effect.
 */
export interface Span {
  setAttribute(_name: string, _value: unknown): this
  addEvent(_name: string, _attributes?: Record<string, unknown>): this
  recordException(_error: Error): void
  end(): void
}

const NOOP_SPAN: Span = {
  setAttribute() {
    return this
  },
  addEvent() {
    return this
  },
  recordException() {},
  end() {},
}

export function isBetaTracingEnabled(): false {
  return false
}

export function isEnhancedTelemetryEnabled(): false {
  return false
}

export function startInteractionSpan(_userPrompt: string): Span {
  return NOOP_SPAN
}

export function endInteractionSpan(): void {}

export function startLLMRequestSpan(..._args: unknown[]): Span {
  return NOOP_SPAN
}

export function endLLMRequestSpan(..._args: unknown[]): void {}

export function startToolSpan(..._args: unknown[]): Span {
  return NOOP_SPAN
}

export function startToolBlockedOnUserSpan(): Span {
  return NOOP_SPAN
}

export function endToolBlockedOnUserSpan(..._args: unknown[]): void {}

export function startToolExecutionSpan(): Span {
  return NOOP_SPAN
}

export function endToolExecutionSpan(..._args: unknown[]): void {}

export function endToolSpan(..._args: unknown[]): void {}

export function addToolContentEvent(..._args: unknown[]): void {}

export function getCurrentSpan(): null {
  return null
}

export async function executeInSpan<T>(
  _spanName: string,
  fn: (span: Span) => Promise<T>,
  _attributes?: Record<string, string | number | boolean>,
): Promise<T> {
  return fn(NOOP_SPAN)
}

export function startHookSpan(..._args: unknown[]): Span {
  return NOOP_SPAN
}

export function endHookSpan(..._args: unknown[]): void {}
