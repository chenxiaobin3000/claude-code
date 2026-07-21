#!/usr/bin/env bun

import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { REMOVED_CLOUD_ARTIFACT_MARKERS } from './removed-cloud-markers.js'

const path = resolve(process.argv[2] ?? 'dist/claude-code.exe')
const bytes = await readFile(path)
const ascii = bytes.toString('latin1')
const utf16 = bytes.toString('utf16le')

// Bun's standalone runtime embeds a native-addon registry containing optional
// package names such as @sentry/profiling-node. This is compiler-owned metadata,
// not a dependency or import in the application payload. The Bun and Vite
// JavaScript bundle checks continue to reject this marker without an exception.
const BUN_RUNTIME_INTRINSIC_MARKERS = new Set(['@sentry/'])
const scannedMarkers = REMOVED_CLOUD_ARTIFACT_MARKERS.filter(
  marker => !BUN_RUNTIME_INTRINSIC_MARKERS.has(marker),
)
const findings = scannedMarkers.filter(
  marker => ascii.includes(marker) || utf16.includes(marker),
)

if (findings.length > 0) {
  console.error(`Standalone EXE contains removed cloud-interface markers:`)
  for (const marker of findings) console.error(`- ${marker}`)
  process.exit(1)
}

console.log(
  `[exe-integrity] PASS (${(bytes.byteLength / 1024 / 1024).toFixed(1)} MiB, ${scannedMarkers.length} markers, ${BUN_RUNTIME_INTRINSIC_MARKERS.size} Bun runtime intrinsic excluded)`,
)
