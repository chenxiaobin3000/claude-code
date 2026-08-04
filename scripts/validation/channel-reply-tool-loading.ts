#!/usr/bin/env bun

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { assert } from './assertions.js'

const root = join(import.meta.dir, '..', '..')
for (const path of [
  'plugins/weixin/src/server.ts',
  'plugins/wxwork/src/server.ts',
  'plugins/qq/src/server.ts',
  'plugins/telegram/src/server.ts',
  'plugins/telegram-user/src/server.ts',
]) {
  const source = readFileSync(join(root, path), 'utf8')
  const reply = source.indexOf("name: 'reply'")
  assert(reply >= 0, `${path} declares a reply tool`)
  assert(
    source
      .slice(reply, reply + 300)
      .includes("_meta: { 'anthropic/alwaysLoad': true }"),
    `${path} keeps reply visible without deferred tool discovery`,
  )
}

console.log('channel reply tool loading validation passed')
