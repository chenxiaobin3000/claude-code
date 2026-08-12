#!/usr/bin/env bun

import { readFile, readdir } from 'node:fs/promises'
import { extname, resolve } from 'node:path'
import { assert } from './assertions.js'

const root = resolve(import.meta.dir, '../..')
const dist = resolve(root, 'dist')

async function javascriptFiles(directory: string): Promise<string[]> {
  const files: string[] = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) files.push(...(await javascriptFiles(path)))
    else if (entry.isFile() && extname(entry.name) === '.js') files.push(path)
  }
  return files
}

const forbiddenRuntimeMarkers = [
  '--computer-use-mcp',
  'mcp__computer-use__',
  'computerUseMcpState',
  'runComputerUseMcpServer',
  'setupComputerUseMCP',
  'getComputerUseMCPToolOverrides',
]
const files = await javascriptFiles(dist)
assert(files.length > 0, 'default Bun bundle has no JavaScript files')
for (const path of files) {
  const contents = await readFile(path, 'utf8')
  for (const marker of forbiddenRuntimeMarkers) {
    assert(
      !contents.includes(marker),
      `default Bun bundle exposes Computer Use runtime marker ${marker}`,
    )
  }
}

console.log(
  `[computer-use-default-bundle] PASS (${files.length} JavaScript files; no runtime entry)`,
)
