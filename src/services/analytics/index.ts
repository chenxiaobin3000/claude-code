/** Compatibility surface for removed analytics calls. No events are queued or exported. */
export type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS = never
export type AnalyticsMetadata_I_VERIFIED_THIS_IS_PII_TAGGED = never
type LogEventMetadata = { [key: string]: boolean | number | undefined }
export type AnalyticsSink = {
  logEvent: (eventName: string, metadata: LogEventMetadata) => void
  logEventAsync: (eventName: string, metadata: LogEventMetadata) => Promise<void>
}
export function stripProtoFields<V>(metadata: Record<string, V>): Record<string, V> { return metadata }
export function attachAnalyticsSink(_sink: AnalyticsSink): void {}
export function logEvent(_eventName: string, _metadata: LogEventMetadata): void {}
export async function logEventAsync(_eventName: string, _metadata: LogEventMetadata): Promise<void> {}
export function _resetForTesting(): void {}
