#!/usr/bin/env bun

import { readFile, readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dir, '../..')
const source = (path: string) => readFile(join(root, path), 'utf8')
const lineCount = (text: string) => text.split(/\r?\n/).length

for (const path of [
  'src/utils/messages.ts',
  'src/utils/sessionStorage.ts',
  'src/utils/hooks.ts',
]) {
  const text = await source(path)
  if (lineCount(text) > 20) {
    throw new Error(`[utility-modules-boundary] ${path} must remain a thin facade`)
  }
  if (!/^export \* from /m.test(text)) {
    throw new Error(`[utility-modules-boundary] ${path} must only expose focused modules`)
  }
}

const runtimeCaps: Record<string, number> = {
  'src/utils/messagesRuntime.ts': 5810,
  'src/utils/sessionStorageRuntime.ts': 5200,
  'src/utils/hooksRuntime.ts': 5030,
}
for (const [path, cap] of Object.entries(runtimeCaps)) {
  const lines = lineCount(await source(path))
  if (lines > cap) {
    throw new Error(`[utility-modules-boundary] ${path} grew to ${lines} lines (cap ${cap})`)
  }
}

const pureModules = [
  'src/utils/messages/ids.ts',
  'src/utils/messages/text.ts',
  'src/utils/messages/predicates.ts',
  'src/utils/sessionStorage/entries.ts',
  'src/utils/sessionStorage/agentTranscripts.ts',
  'src/utils/sessionStorage/conversationChain.ts',
  'src/utils/hooks/matcher.ts',
  'src/utils/hooks/blockingMessages.ts',
]
const forbidden = [
  /bootstrap\/state/,
  /services\/analytics/,
  /from ['"](?:fs|fs\/promises|child_process)['"]/,
  /from ['"]\.\.\/(?:messages|sessionStorage|hooks)\.js['"]/,
  /@anthropic\/ink/,
]
for (const path of pureModules) {
  const text = await source(path)
  for (const pattern of forbidden) {
    if (pattern.test(text)) {
      throw new Error(`[utility-modules-boundary] ${path} contains forbidden dependency ${pattern}`)
    }
  }
}

for (const directory of ['src/utils/messages', 'src/utils/sessionStorage', 'src/utils/hooks']) {
  for (const entry of await readdir(join(root, directory), { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.ts')) continue
    const path = join(directory, entry.name)
    const lines = lineCount(await source(path))
    if (lines > 800) {
      throw new Error(`[utility-modules-boundary] ${path} has ${lines} lines (max 800)`)
    }
  }
}

const attachments = await source('src/utils/attachments.ts')
if (/from ['"]\.\/messages\.js['"]/.test(attachments)) {
  throw new Error('[utility-modules-boundary] attachments.ts must not import the messages facade')
}
const sessionRuntime = await source('src/utils/sessionStorageRuntime.ts')
if (/from ['"]\.\/messages\.js['"]/.test(sessionRuntime)) {
  throw new Error('[utility-modules-boundary] session storage must import focused message modules')
}

console.log('[utility-modules-boundary] PASS')
