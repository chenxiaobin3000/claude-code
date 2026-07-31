export const STABILITY_THRESHOLDS = Object.freeze({
  schemaVersion: 1,
  pressureWindows: 5,
  streamDeltasPerWindow: 1_000,
  maxStreamFlushRatio: 0.1,
  maxHeapGrowthBytes: 64 * 1024 * 1024,
  maxActiveHandleDrift: 2,
  maxBackgroundRestarts: 5,
  maxWindowsFileAttempts: 6,
  maxWindowsFileBackoffMs: 775,
})
